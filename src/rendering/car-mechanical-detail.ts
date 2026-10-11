import {
  rivalVisorMaterial,
  teamHelmetMaterial,
  type DriverDesign,
} from './studio/helmet-livery.ts';
import { helmetTetherPost } from './driver-restraints.ts';
import {
  helmetShell,
  helmetPatch,
  helmetPoint,
  helmetSpoilerGeometry,
  visorBounds,
  visorGeometry,
} from './helmet-shell.ts';
import * as T from 'three';
import { bodySurface, POD_SECTIONS, POD_UNDERCUT, POD_FLATTEN } from './car-surfaces.ts';
import { sculptedLoft } from './bodywork.ts';
import { mesh, mergeStatic, rod } from './geometry.ts';

export interface MechanicalMaterials {
  carbon: T.Material;
  dark: T.Material;
  metal: T.Material;
  paint: T.Material;
}

/** Rigid parts are attached to their actual carrier: the brake duct/upright
 * steer and heave, while the centre lock rotates and leaves with the wheel.
 * None is parented to the deformable tyre, and none changes vehicle forces. */
export function addWheelMechanicalDetail(
  carrier: T.Group,
  rotatingWheel: T.Group,
  side: number,
  halfWidth: number,
  m: MechanicalMaterials,
) {
  if ((side !== -1 && side !== 1) || !Number.isFinite(halfWidth) || halfWidth <= 0)
    throw new Error('Invalid wheel-detail dimensions');
  const upright = new T.Group();
  upright.name = 'Steering upright and brake cooling duct';
  const x = -side * (halfWidth + 0.014);
  rod(upright, m.metal, new T.Vector3(x, -0.077, -0.005), new T.Vector3(x, 0.069, 0.014), 0.019);
  for (const y of [-0.077, 0.069]) {
    mesh(upright, new T.SphereGeometry(0.022, 12, 8), m.dark, x, y, y < 0 ? -0.005 : 0.014);
    const pin = mesh(upright, new T.CylinderGeometry(0.008, 0.008, 0.048, 8), m.metal, x, y, 0.006);
    pin.rotation.z = Math.PI / 2;
  }
  const duct = mesh(upright, new T.TorusGeometry(0.047, 0.008, 8, 20), m.carbon, x, 0.015, 0.137);
  duct.scale.set(0.48, 1, 0.6);
  const mouth = mesh(upright, new T.CircleGeometry(0.044, 20), m.dark, x, 0.015, 0.132);
  mouth.scale.x = 0.48;
  rod(upright, m.carbon, new T.Vector3(x, 0.01, 0.105), new T.Vector3(x, -0.011, 0.012), 0.018);
  mergeStatic(upright);
  carrier.add(upright);

  const lock = new T.Group();
  lock.name = 'Rotating centre lock';
  const nut = mesh(
    lock,
    new T.CylinderGeometry(0.029, 0.031, 0.02, 6),
    m.metal,
    side * (halfWidth + 0.029),
    0,
    0,
  );
  nut.rotation.z = Math.PI / 2;
  const bore = mesh(lock, new T.CircleGeometry(0.013, 16), m.dark, side * (halfWidth + 0.04), 0, 0);
  bore.rotation.y = (side * Math.PI) / 2;
  mergeStatic(lock);
  rotatingWheel.add(lock);
  return { upright, lock };
}

/** Original tail hardware fits inside the existing car silhouette. Exhaust
 * colour is an authored material, not an invented temperature/engine state. */
export function addTailMechanicalDetail(parent: T.Group, m: MechanicalMaterials) {
  const tail = new T.Group();
  tail.name = 'Rear crash structure and exhaust outlet';
  mesh(
    tail,
    sculptedLoft(
      [
        [-2.27, -0.205, 0.047, 0.039],
        [-2.1, -0.195, 0.074, 0.052],
        [-1.83, -0.18, 0.095, 0.065],
      ],
      0.6,
      0.6,
    ),
    m.carbon,
  );
  const outlet = mesh(
    tail,
    new T.CylinderGeometry(0.038, 0.035, 0.15, 24, 1, true),
    m.metal,
    0,
    -0.015,
    -2.117,
  );
  outlet.rotation.x = Math.PI / 2;
  mesh(tail, new T.TorusGeometry(0.037, 0.003, 6, 24), m.metal, 0, -0.015, -2.193);
  const interior = mesh(tail, new T.CircleGeometry(0.034, 24), m.dark, 0, -0.015, -2.1);
  interior.rotation.y = Math.PI;
  mergeStatic(tail);
  parent.add(tail);
  return tail;
}

/** The neck pivot is independent from the shell centre, so load-induced nods
 * rotate about the neck instead of swinging the head around the car origin. */
export function buildHelmet(parent: T.Group, m: MechanicalMaterials, design?: DriverDesign) {
  parent.name = 'Original helmet with neck-centred articulation';
  parent.position.set(0, 0.17, -0.4);
  const shellGeometry = helmetShell();
  if (design) {
    // D16: the team's own helmet (with its rear crown spoiler in the same
    // paint submission) and a smoked, sky-reflecting visor with tear-offs.
    // The shell is merged into the helmet group: its livery frame is offset.
    const paint = teamHelmetMaterial(design, new T.Vector3(0, 0.12, 0.02)).material;
    mesh(parent, shellGeometry, paint, 0, 0.12, 0.02);
    mesh(parent, helmetSpoilerGeometry(), paint, 0, 0.12, 0.02);
    buildHelmetDetail(parent, m, rivalVisorMaterial(), true);
    return;
  }
  const helmetPaint = m.paint.clone();
  helmetPaint.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 vHelmetLocal;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvHelmetLocal = position - vec3(0.0,0.12,0.02);',
      );
    shader.fragmentShader =
      'varying vec3 vHelmetLocal;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float edge = abs(vHelmetLocal.x);
      float aa = max(fwidth(edge), 0.00012);
      float crown = smoothstep(0.008, 0.025, vHelmetLocal.y) + step(vHelmetLocal.z, 0.0);
      float stripe = (1.0 - smoothstep(0.027-aa,0.027+aa,edge)) * min(crown,1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.014,0.045,0.057), stripe);
      vec2 ventUV = vec2((abs(vHelmetLocal.x)-0.032)/0.014, (vHelmetLocal.y+0.057)/0.0032);
      float vent = (1.0-smoothstep(0.85,1.10,length(ventUV))) * step(0.085,vHelmetLocal.z);
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.007,0.011,0.014),vent);
      `,
      );
  };
  helmetPaint.customProgramCacheKey = () => 'original-helmet-crown-v2';
  mesh(parent, shellGeometry, helmetPaint, 0, 0.12, 0.02);
  buildHelmetDetail(
    parent,
    m,
    new T.MeshPhysicalMaterial({
      name: 'Original smoked visor',
      color: 0x253b45,
      metalness: 0.35,
      roughness: 0.13,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
    }),
  );
}
/** Visor, gaskets, hinges and tether sockets around a helmet shell. */
function buildHelmetDetail(
  parent: T.Group,
  m: MechanicalMaterials,
  visorMaterial: T.Material,
  eyePort = false,
) {
  // Raised brow and a tapered visor follow the same shell rather than a
  // circular band. Gaskets remain separated by only millimetres at the cheeks.
  // A team helmet's shield follows the eye-port outline (full height at the
  // front, narrowing to the pivot arms) and its gaskets follow both edges.
  mesh(
    parent,
    eyePort ? visorGeometry(0.003) : helmetPatch(-0.033, 0.043, 0.095, Math.PI - 0.095, 0.003),
    visorMaterial,
    0,
    0.12,
    0.02,
  );
  for (const edge of [0, 1]) {
    const points = Array.from({ length: 33 }, (_, j) => {
      const phi = 0.095 + (j / 32) * (Math.PI - 0.19);
      const y = eyePort ? visorBounds(phi)[edge] : edge ? 0.043 : -0.033;
      return helmetPoint(y, phi, 0.0038).add(new T.Vector3(0, 0.12, 0.02));
    });
    mesh(parent, new T.TubeGeometry(new T.CatmullRomCurve3(points), 32, 0.0018, 6, false), m.dark);
  }
  // A team helmet paints its brow strip; the plain helmet keeps a raised seal.
  if (!eyePort)
    mesh(
      parent,
      helmetPatch(0.046, 0.053, 0.1, Math.PI - 0.1, 0.0012, 2, 32),
      m.dark,
      0,
      0.12,
      0.02,
    );
  for (const side of [-1, 1]) {
    const hinge = mesh(
      parent,
      new T.CylinderGeometry(0.011, 0.011, 0.006, 12),
      m.metal,
      side * 0.142,
      0.124,
      0.025,
    );
    hinge.rotation.z = Math.PI / 2;
  }
  for (const side of [-1, 1]) {
    const p = helmetTetherPost(side);
    const socket = mesh(
      parent,
      new T.CylinderGeometry(0.007, 0.009, 0.006, 16),
      m.metal,
      p.x,
      p.y,
      p.z,
    );
    socket.rotation.z = Math.PI / 2;
    const button = mesh(
      parent,
      new T.SphereGeometry(0.004, 12, 8),
      m.dark,
      p.x + side * 0.003,
      p.y,
      p.z,
    );
    button.scale.x = 0.6;
    const tab = mesh(
      parent,
      new T.CapsuleGeometry(0.003, 0.012, 3, 8),
      m.metal,
      side * 0.129,
      0.089,
      0.067,
    );
    tab.rotation.z = side * 0.4;
    tab.scale.z = 0.4;
  }
  const seal = mesh(parent, new T.TorusGeometry(0.073, 0.012, 8, 24), m.dark, 0, 0.005, 0.006);
  seal.rotation.x = Math.PI / 2;
  mergeStatic(parent);
}

/** Remove only the terminal cap from a closed loft. The UV seam and all skin
 * vertices/normals remain unchanged; a separately modelled duct closes the inlet. */
export function openFrontCap(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    index = geometry.getIndex();
  if (!position || !index) throw new Error('Expected indexed sidepod geometry');
  geometry.computeBoundingBox();
  const front = geometry.boundingBox!.max.z,
    next: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (
      Math.abs(position.getZ(a) - front) < 1e-6 &&
      Math.abs(position.getZ(b) - front) < 1e-6 &&
      Math.abs(position.getZ(c) - front) < 1e-6
    )
      continue;
    next.push(a, b, c);
  }
  geometry.setIndex(next);
  return geometry;
}

/** An annular, manufactured lip follows the exact terminal sidepod section.
 * Its inset wall terminates at a real recessed cooling matrix, not at a black
 * cap flush with the body. This geometry is shared by all vehicle LODs. */
export function sidepodDuctGeometry(segments = 40) {
  if (!Number.isInteger(segments) || segments < 8 || segments > 80 || segments % 4 !== 0)
    throw new Error('Invalid inlet tessellation');
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let ring = 0; ring < 3; ring++) {
    for (let j = 0; j <= segments; j++) {
      const p = bodySurface(POD_SECTIONS, 0.39, j / segments, POD_UNDERCUT, POD_FLATTEN);
      if (ring > 0) {
        p.x *= ring === 1 ? 0.95 : 0.85;
        p.y = 0.025 + (p.y - 0.025) * (ring === 1 ? 0.8 : 0.7);
      }
      positions.push(p.x, p.y, ring < 2 ? 0.391 : 0.224);
      uv.push(j / segments, ring / 2);
    }
  }
  for (let ring = 0; ring < 2; ring++)
    for (let j = 0; j < segments; j++) {
      const a = ring * (segments + 1) + j,
        b = a + segments + 1;
      // Looking from the front, the lip faces +Z and the duct normals face inward.
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
export function addSidepodDuct(
  parent: T.Group,
  side: number,
  m: MechanicalMaterials,
  detail: 'high' | 'mid' | 'far' = 'high',
) {
  if ((side !== -1 && side !== 1) || !['high', 'mid', 'far'].includes(detail))
    throw new Error('Invalid inlet assembly');
  const root = new T.Group();
  root.name = 'Conformal lip and recessed cooling matrix';
  root.position.set(side * 0.53, 0, 0);
  root.rotation.z = side * -0.08;
  const segments = detail === 'high' ? 40 : detail === 'mid' ? 12 : 8;
  mesh(root, sidepodDuctGeometry(segments), m.carbon);
  const outline = new T.Shape();
  for (let j = 0; j <= segments; j++) {
    const p = bodySurface(POD_SECTIONS, 0.39, j / segments, POD_UNDERCUT, POD_FLATTEN);
    const x = p.x * 0.85,
      y = 0.025 + (p.y - 0.025) * 0.7;
    if (j === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  mesh(root, new T.ShapeGeometry(outline), m.dark, 0, 0, 0.2235);
  if (detail !== 'far')
    for (let i = -2; i <= 2; i++) {
      const extent = 0.31 * Math.sqrt(1 - (i / 3.2) ** 2);
      mesh(root, new T.BoxGeometry(extent, 0.0018, 0.003), m.metal, 0, 0.025 + i * 0.014, 0.227);
    }
  mesh(root, new T.BoxGeometry(0.34, 0.005, 0.11), m.carbon, 0, 0.025, 0.327);
  mergeStatic(root);
  parent.add(root);
  return root;
}
