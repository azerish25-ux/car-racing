import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { helmetPatch, helmetShell } from '../helmet-shell.ts';
import type { RiderDetail } from '../rider.ts';
import { mouldedPanel } from './motocross-detail.ts';

function part(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Small authored folds interrupt the perfect tubes at the waist and elbows.
 * They are baked once and inherit the existing contact-preserving rider IK. */
export function drapeMotocrossFabric(g: T.BufferGeometry, amplitude = 0.003) {
  const p = g.getAttribute('position');
  g.computeBoundingBox();
  const box = g.boundingBox!,
    height = Math.max(0.01, box.max.y - box.min.y);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      r = Math.hypot(x, z);
    if (r < 0.012) continue;
    const t = (y - box.min.y) / height,
      angle = Math.atan2(z, x);
    const folds =
      amplitude * (0.35 + 0.65 * Math.sin(t * Math.PI) ** 2) * Math.sin(t * 31 + angle * 3.5);
    p.setXYZ(i, x * (1 + folds / r), y, z * (1 + folds / r));
  }
  g.computeVertexNormals();
  return g;
}

/** Extend the cheek/chin profile while retaining a smoothly closed shell. */
export function motocrossHelmetShell() {
  const g = helmetShell(),
    p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i),
      z = p.getZ(i);
    if (z <= 0) continue;
    const jaw = T.MathUtils.smoothstep(-y, 0.015, 0.1);
    p.setZ(i, z + 0.027 * jaw * T.MathUtils.smoothstep(z, 0.055, 0.15));
  }
  g.computeVertexNormals();
  return g;
}

function peakGeometry(detail: RiderDetail) {
  const rows = detail === 'high' ? 9 : 5,
    columns = detail === 'high' ? 14 : 8;
  const pos: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const under of [false, true]) {
    const base = pos.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const v = j / rows,
          u = (i / columns) * 2 - 1;
        const width = 0.096 + Math.sin(v * Math.PI) * 0.035;
        const y = 0.26 - v * v * 0.027 + 0.008 * (1 - u * u) - (under ? 0.0045 : 0);
        pos.push(u * width, y, 0.038 + v * (0.257 - 0.015 * Math.abs(u)));
        uv.push(i / columns, 1 - v);
        if (j < rows && i < columns) {
          const a = base + j * (columns + 1) + i,
            b = a + columns + 1;
          if (under) index.push(a, a + 1, b, a + 1, b + 1, b);
          else index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
  }
  // Close the front lip. Side edges are only 4.5 mm thick and remain smooth.
  const stride = (rows + 1) * (columns + 1);
  for (let i = 0; i < columns; i++) {
    const a = rows * (columns + 1) + i,
      b = a + stride;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function gogglePoint(u: number, v: number) {
  const x = (u * 2 - 1) * 0.108,
    edge = Math.abs(u * 2 - 1);
  const bottom = 0.137 + Math.exp(-(((u - 0.5) * 12) ** 2)) * 0.008;
  const top = 0.201 - edge * 0.008;
  return new T.Vector3(x, T.MathUtils.lerp(bottom, top, v), 0.19 - edge * edge * 0.026);
}

/** Peaked shell, curved mirrored goggles, foam gasket, real ribbon strap and
 * vented chin protector. All meshes are merged by the caller per material. */
export function addMotocrossHelmet(
  head: T.Group,
  detail: RiderDetail,
  shell: T.Material,
  lens: T.Material,
  trim: T.Material,
  accent: T.Material,
) {
  part(head, peakGeometry(detail), shell).name = 'Motocross swept helmet peak';
  if (detail === 'far') {
    // Preserve the two defining off-road helmet features at distance without
    // retaining the close curved gasket, vents and fasteners.
    part(head, new T.BoxGeometry(0.198, 0.067, 0.024), trim, 0, 0.167, 0.166);
    part(head, new T.PlaneGeometry(0.17, 0.046), lens, 0, 0.171, 0.179);
    return;
  }
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    columns = detail === 'high' ? 24 : 12,
    rows = 5;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      const p = gogglePoint(i / columns, j / rows);
      positions.push(p.x, p.y, p.z);
      uv.push(i / columns, j / rows);
      if (j < rows && i < columns) {
        const a = j * (columns + 1) + i,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const lensGeometry = new T.BufferGeometry();
  lensGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  lensGeometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  lensGeometry.setIndex(indices);
  lensGeometry.computeVertexNormals();
  part(head, lensGeometry, lens).name = 'Motocross curved goggle lens';
  const outline: T.Vector3[] = [];
  for (const edge of [1, 0])
    for (let i = 0; i <= 24; i++) outline.push(gogglePoint(edge ? i / 24 : 1 - i / 24, edge));
  part(
    head,
    new T.TubeGeometry(new T.CatmullRomCurve3(outline, true), 60, 0.008, 6, true),
    trim,
  ).name = 'Motocross goggle foam gasket';
  const rim = part(
    head,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(
        outline.map((p) => p.clone().add(new T.Vector3(0, 0, 0.003))),
        true,
      ),
      60,
      0.0034,
      5,
      true,
    ),
    accent,
  );
  rim.name = 'Motocross goggle frame';
  const strap = part(
    head,
    helmetPatch(0.003, 0.034, Math.PI - 0.11, Math.PI * 2 + 0.11, 0.006, 2, 32),
    trim,
    0,
    0.15,
    0.02,
  );
  strap.name = 'Motocross woven goggle strap';
  const chin = part(
    head,
    mouldedPanel(
      [
        [-0.056, 0.033],
        [-0.044, -0.014],
        [0, -0.03],
        [0.044, -0.014],
        [0.056, 0.033],
        [0.033, 0.047],
        [-0.033, 0.047],
      ],
      0.012,
      0.004,
    ),
    shell,
    0,
    0.045,
    0.173,
  );
  chin.rotation.x = 0.18;
  for (let i = 0; i < 3; i++)
    part(
      head,
      new RoundedBoxGeometry(0.048 - i * 0.007, 0.006, 0.005, 2, 0.002),
      trim,
      0,
      0.051 + i * 0.012,
      0.186 + i * 0.001,
    );
  for (const side of [-1, 1]) {
    const fastener = part(
      head,
      new T.CylinderGeometry(0.007, 0.007, 0.006, 8),
      accent,
      side * 0.12,
      0.24,
      0.065,
    );
    fastener.rotation.z = Math.PI / 2;
    const vent = part(
      head,
      new RoundedBoxGeometry(0.024, 0.009, 0.062, 2, 0.004),
      trim,
      side * 0.081,
      0.275,
      0.055,
    );
    vent.rotation.z = side * 0.3;
    const cheek = part(
      head,
      new RoundedBoxGeometry(0.055, 0.012, 0.008, 2, 0.004),
      trim,
      side * 0.086,
      0.086,
      0.13,
    );
    cheek.rotation.y = side * 0.54;
  }
}

/** Off-road boots have a distinct calf, shin protector, ankle hinge, toe box,
 * rubber sole and four buckles. Coordinates match the existing ankle group. */
export function addMotocrossBoot(
  foot: T.Group,
  detail: RiderDetail,
  side: number,
  boot: T.Material,
  flex: T.Material,
  metal: T.Material,
) {
  const sides = detail === 'high' ? 16 : detail === 'mid' ? 10 : 6;
  const shaft = new T.LatheGeometry(
    [
      new T.Vector2(0.045, -0.325),
      new T.Vector2(0.057, -0.3),
      new T.Vector2(0.061, -0.23),
      new T.Vector2(0.054, -0.14),
      new T.Vector2(0.043, -0.052),
      new T.Vector2(0.044, -0.004),
    ],
    sides,
  );
  part(foot, shaft, boot).scale.set(0.93, 1, 0.9);
  part(
    foot,
    new RoundedBoxGeometry(0.089, 0.074, 0.234, detail === 'far' ? 1 : 3, 0.026),
    boot,
    0,
    -0.016,
    0.045,
  );
  part(foot, new RoundedBoxGeometry(0.096, 0.017, 0.251, 2, 0.007), flex, 0, 0.025, 0.052);
  if (detail === 'far') return;
  const protector = part(
    foot,
    mouldedPanel(
      [
        [-0.035, 0.1],
        [-0.043, 0.062],
        [-0.031, -0.084],
        [0.03, -0.084],
        [0.043, 0.062],
        [0.035, 0.1],
      ],
      0.007,
      0.003,
    ),
    boot,
    0,
    -0.204,
    0.052,
  );
  protector.name = 'Motocross moulded shin protector';
  const inset = part(
    foot,
    new RoundedBoxGeometry(0.044, 0.09, 0.008, 2, 0.006),
    flex,
    0,
    -0.208,
    0.059,
  );
  inset.rotation.z = side * 0.13;
  for (let i = 0; i < 4; i++) {
    const y = -0.061 - i * 0.064;
    const strap = part(foot, new T.TorusGeometry(0.052, 0.004, 5, sides), flex, 0, y, 0);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 0.91, 1);
    const buckle = part(
      foot,
      new RoundedBoxGeometry(0.019, 0.014, 0.03, 2, 0.004),
      metal,
      side * 0.052,
      y,
      0.018,
    );
    buckle.name = 'Motocross boot buckle';
  }
  const hinge = part(
    foot,
    new T.CylinderGeometry(0.018, 0.018, 0.008, 12),
    flex,
    side * 0.046,
    -0.059,
    -0.004,
  );
  hinge.rotation.z = Math.PI / 2;
  part(foot, new RoundedBoxGeometry(0.073, 0.02, 0.055, 2, 0.005), flex, 0, -0.054, 0.07);
  if (detail === 'high')
    for (let rib = 0; rib < 4; rib++)
      part(
        foot,
        new RoundedBoxGeometry(0.068, 0.005, 0.01, 2, 0.002),
        boot,
        0,
        -0.066,
        0.033 + rib * 0.021,
      );
}
