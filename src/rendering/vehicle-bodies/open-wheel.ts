import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { KartSheet, OpenWheelSheet } from './body-sheet.ts';
import { addDriver, type BuiltLod, type CarMaterials } from './common.ts';
import type { BodyFrame } from './frame.ts';
import {
  aerofoil,
  loftRings,
  rodGeometry,
  roundedBox,
  sampleProfile,
  Track,
  tubeGeometry,
  type Pt,
  type Ring,
} from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Open-wheel single-seaters (modern feeder formula with halo, sidepods and
 * wings; 1960s cigar-tube car with exposed engine and exhausts) and karts.
 * One mirrored loft carries the monocoque and its sidepods: in sections
 * without pods the pod control points collapse onto the tub, so the surface
 * stays continuous. Suspension links are rebuilt per frame by the manager
 * from the hub poses (see `links`). */
const COUNTS: Record<Detail, readonly number[]> = {
  0: [3, 2, 3, 2, 2, 3, 3, 4],
  1: [2, 1, 2, 1, 1, 2, 2, 2],
  2: [1, 1, 1, 1, 1, 1, 1, 1],
};
export interface Link {
  /** Inboard chassis point (car frame) and the wheel it reaches. */
  inboard: T.Vector3;
  wheel: number;
  /** Outboard offset from the hub (car frame, before steer). */
  offset: T.Vector3;
}
export function buildOpenWheel(
  f: BodyFrame,
  s: OpenWheelSheet,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
): Link[] {
  const modern = s.era === 'modern';
  const zNose = f.frontAxle + s.overhang[0],
    zTail = f.rearAxle - s.overhang[1] + (modern ? 0.25 : 0.1),
    zCockpit = f.z(s.cockpit),
    y = f.y;
  const [tubW, tubTop] = s.tub;
  const width = new Track([
    [zTail, modern ? 0.1 : 0.12],
    [f.rearAxle, modern ? 0.14 : 0.2],
    [zCockpit - 0.6, modern ? 0.26 : tubW * 0.95],
    [zCockpit, tubW],
    [zCockpit + 0.5, tubW * 0.9],
    [f.frontAxle, modern ? 0.13 : 0.22],
    [zNose - 0.2, modern ? 0.09 : 0.17],
    [zNose, modern ? 0.07 : 0.14],
  ]);
  const top = new Track([
    [zTail, y(modern ? 0.48 : 0.5)],
    [f.rearAxle, y(modern ? 0.55 : 0.58)],
    [zCockpit - 0.7, y(modern ? 0.92 : 0.66)],
    [zCockpit - 0.25, y(modern ? 1.0 : tubTop + 0.04)],
    [zCockpit - 0.05, y(tubTop - 0.04)],
    [zCockpit + 0.35, y(tubTop - 0.06)],
    [zCockpit + 0.75, y(modern ? tubTop - 0.04 : tubTop - 0.02)],
    [f.frontAxle, y(modern ? 0.5 : 0.48)],
    [zNose - 0.15, y(s.noseHeight + 0.06)],
    [zNose, y(s.noseHeight)],
  ]);
  const bottom = new Track([
    [zTail, y(modern ? 0.2 : 0.16)],
    [f.rearAxle, y(0.06)],
    [f.frontAxle, y(modern ? 0.12 : 0.1)],
    [zNose, y(s.noseHeight - (modern ? 0.1 : 0.12))],
  ]);
  const pod = (z: number) => {
    if (!modern || s.sidepod <= 0) return 0;
    const a = f.frontAxle - 0.85,
      b = f.rearAxle + 0.5;
    if (z > a || z < b) return 0;
    const u = (z - b) / (a - b);
    return (
      Math.sin(clamp(u * 1.25, 0, 1) * Math.PI * 0.5) * (1 - Math.max(0, (u - 0.85) / 0.15) ** 2)
    );
  };
  const ring = (z: number): Ring => {
    const hw = width.at(z),
      t = top.at(z),
      b = Math.min(bottom.at(z), t - 0.08),
      p = pod(z),
      podW = hw + (s.sidepod - hw) * p,
      podTop = b + 0.08 + p * 0.3,
      round = modern ? 0.04 : (t - b) * 0.32;
    const ctrl: Pt[] = [
      [0, b],
      [Math.max(hw * 0.6, podW * 0.9 - 0.02), b],
      [podW, b + Math.min(0.06, (podTop - b) * 0.4)],
      [podW, podTop - Math.min(0.08, (podTop - b) * 0.4)],
      [podW * 0.9 + hw * 0.1, podTop],
      [hw + 0.01, podTop + 0.004],
      [hw, t - round],
      [hw * 0.7, t - round * 0.12],
      [0, t],
    ];
    return { z, half: sampleProfile(ctrl, COUNTS[detail]) };
  };
  const n = Math.ceil((zNose - zTail) / (detail === 0 ? 0.03 : detail === 1 ? 0.07 : 0.18));
  const rings = Array.from({ length: n + 1 }, (_, i) => ring(zTail + ((zNose - zTail) * i) / n));
  const counts = COUNTS[detail];
  const topStart = counts.slice(0, 7).reduce((a, b) => a + b, 0);
  const tub = loftRings(rings, {
    capStart: true,
    capEnd: true,
    material: (zMid, j) => {
      // Cockpit opening: interior on the top between the halo/screen and the headrest.
      if (j >= topStart && zMid < zCockpit + 0.42 && zMid > zCockpit - 0.32) return 1;
      if (s.stripe === 'centre' && j >= topStart + counts[7] - 1) return 2;
      if (j < counts[0]) return 3;
      return 0;
    },
  });
  const parts = new Parts();
  parts.addGrouped(
    tub,
    [mats.paint, sharedMaterials.interior(), mats.accent, sharedMaterials.carbonSatin()],
    'Monocoque (lofted)',
  );
  const carbon = sharedMaterials.carbon(),
    satin = sharedMaterials.carbonSatin();
  // Driver.
  const seatY = y(0.12),
    seatZ = zCockpit - 0.1;
  addDriver(parts, mats, 0, seatY, seatZ, 0.92, zCockpit + 0.36, !modern);
  if (detail < 2) {
    // Headrest / roll structure.
    if (modern)
      parts.add(
        roundedBox(0.36, 0.14, 0.2, 0.05, 2),
        mats.paint,
        placed(0, y(tubTop + 0.06), zCockpit - 0.3),
      );
    else {
      parts.add(
        tubeGeometry(
          [
            [-0.2, y(tubTop - 0.04), zCockpit - 0.32],
            [-0.17, y(tubTop + 0.32), zCockpit - 0.36],
            [0.17, y(tubTop + 0.32), zCockpit - 0.36],
            [0.2, y(tubTop - 0.04), zCockpit - 0.32],
          ],
          0.02,
          20,
          8,
        ),
        sharedMaterials.chrome(),
      );
      // Wrap-around screen.
      const screen = new T.CylinderGeometry(
        0.26,
        0.28,
        0.14,
        detail === 0 ? 24 : 12,
        1,
        true,
        -1.1,
        2.2,
      );
      parts.add(
        screen,
        sharedMaterials.glass(),
        placed(0, y(tubTop + 0.02), zCockpit + 0.18, -0.3),
      );
    }
  }
  if (modern && s.halo && detail < 2) {
    const yh = y(tubTop + 0.2),
      zh = zCockpit + 0.05;
    parts.add(
      tubeGeometry(
        [
          [-0.26, y(tubTop - 0.02), zh - 0.4],
          [-0.27, yh, zh - 0.15],
          [-0.2, yh + 0.02, zh + 0.2],
          [0, yh + 0.03, zh + 0.32],
          [0.2, yh + 0.02, zh + 0.2],
          [0.27, yh, zh - 0.15],
          [0.26, y(tubTop - 0.02), zh - 0.4],
        ],
        0.026,
        30,
        10,
      ),
      mats.paint,
    );
    parts.add(
      rodGeometry(
        new T.Vector3(0, yh + 0.03, zh + 0.32),
        new T.Vector3(0, y(tubTop - 0.06), zh + 0.6),
        0.022,
        10,
      ),
      mats.paint,
    );
  }
  if (modern && s.airbox && detail < 2) {
    parts.add(
      roundedBox(0.18, 0.12, 0.08, 0.05, 2),
      sharedMaterials.grille(),
      placed(0, y(1.0) - 0.06, zCockpit - 0.36),
    );
    const fin = new T.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(-(zCockpit - 0.5 - (f.rearAxle + 0.1)), 0);
    fin.lineTo(-(zCockpit - 0.5 - (f.rearAxle + 0.1)), 0.1);
    fin.lineTo(0, 0.42);
    const g = new T.ExtrudeGeometry(fin, { depth: 0.01, bevelEnabled: false });
    g.rotateY(Math.PI / 2).translate(-0.005, y(0.55), zCockpit - 0.5);
    parts.add(g, mats.paint);
  }
  if (modern && s.frontWing) {
    const zw = zNose - 0.05,
      yw = y(0.1),
      span = 1.75;
    const front = new Parts();
    front.add(
      aerofoil(0.32, 0.1, 0.06, span, detail === 0 ? 14 : 6),
      carbon,
      placed(0, yw, zw, 0.05),
    );
    if (detail < 2) {
      for (const side of [-1, 1]) {
        front.add(
          aerofoil(0.18, 0.1, 0.05, 0.55, 8),
          carbon,
          placed(side * 0.58, yw + 0.06, zw - 0.25, 0.35),
        );
        front.add(
          roundedBox(0.012, 0.22, 0.5, 0.004, 1),
          carbon,
          placed(side * (span / 2), yw + 0.06, zw - 0.2),
        );
      }
      front.add(
        roundedBox(0.04, y(s.noseHeight) - yw, 0.12, 0.01, 1),
        carbon,
        placed(0.12, (y(s.noseHeight) + yw) / 2, zw - 0.1),
      );
      front.add(
        roundedBox(0.04, y(s.noseHeight) - yw, 0.12, 0.01, 1),
        carbon,
        placed(-0.12, (y(s.noseHeight) + yw) / 2, zw - 0.1),
      );
    }
    const g = new T.Group();
    g.name = 'Front wing (detachable)';
    front.build(g, detail === 0);
    lod.group.add(g);
    lod.front.push(g);
  }
  if (modern && s.rearWing) {
    const zw = f.rearAxle - 0.42,
      yw = y(0.92),
      span = 1.0;
    const rear = new Parts();
    rear.add(
      aerofoil(0.36, 0.12, 0.07, span, detail === 0 ? 14 : 6),
      carbon,
      placed(0, yw, zw, 0.15),
    );
    if (detail < 2) {
      rear.add(
        aerofoil(0.2, 0.1, 0.05, span * 0.98, 8),
        carbon,
        placed(0, yw + 0.09, zw - 0.3, 0.55),
      );
      for (const side of [-1, 1])
        rear.add(
          roundedBox(0.012, 0.62, 0.62, 0.006, 1),
          carbon,
          placed(side * (span / 2 + 0.006), yw - 0.18, zw - 0.2),
        );
      rear.add(aerofoil(0.2, 0.1, 0.04, span * 0.9, 8), carbon, placed(0, y(0.42), zw + 0.05, 0.1));
      rear.add(
        roundedBox(0.03, yw - y(0.48), 0.1, 0.01, 1),
        carbon,
        placed(0, (yw + y(0.48)) / 2, zw - 0.05),
      );
    }
    const g = new T.Group();
    g.name = 'Rear wing (detachable)';
    rear.build(g, detail === 0);
    lod.group.add(g);
    lod.rear.push(g);
  }
  if (modern && detail < 2) {
    // Floor plate with edges, and the diffuser.
    const len = f.frontAxle - f.rearAxle - 0.6;
    parts.add(
      roundedBox(1.36, 0.012, len, 0.004, 1),
      satin,
      placed(0, y(0.035), (f.frontAxle + f.rearAxle) / 2),
    );
    for (let k = -2; k <= 2; k++)
      parts.add(
        roundedBox(0.01, 0.16, 0.4, 0.003, 1),
        satin,
        placed(k * 0.16, y(0.12), f.rearAxle - 0.35, -0.3),
      );
    for (const side of [-1, 1]) {
      // Mirrors on stalks from the pods.
      const xm = side * 0.5,
        zm = zCockpit + 0.42;
      parts.add(roundedBox(0.16, 0.06, 0.06, 0.02, 2), mats.paint, placed(xm, y(0.68), zm));
      parts.add(
        rodGeometry(
          new T.Vector3(xm * 0.75, y(0.5), zm + 0.02),
          new T.Vector3(xm, y(0.66), zm),
          0.008,
          6,
        ),
        carbon,
      );
    }
    parts.add(roundedBox(0.18, 0.05, 0.03, 0.01, 1), mats.tail, placed(0, y(0.32), zTail - 0.02));
  }
  if (!modern && detail < 2) {
    // Exposed engine, gearbox and swept exhausts.
    const ze = f.rearAxle + 0.45;
    parts.add(roundedBox(0.44, 0.3, 0.62, 0.05, 2), sharedMaterials.steel(), placed(0, y(0.3), ze));
    parts.add(
      roundedBox(0.2, 0.22, 0.4, 0.04, 2),
      sharedMaterials.plastic(),
      placed(0, y(0.28), f.rearAxle - 0.1),
    );
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const z0 = ze + 0.22 - k * 0.12;
        parts.add(
          tubeGeometry(
            [
              [side * 0.12, y(0.46), z0],
              [side * (0.2 + k * 0.012), y(0.5), z0 - 0.08],
              [side * 0.24, y(0.48), f.rearAxle - 0.1],
              [side * 0.22, y(0.44), zTail - 0.05],
            ],
            0.016,
            16,
            6,
          ),
          sharedMaterials.exhaust(),
        );
      }
    for (const side of [-1, 1])
      parts.add(
        new T.CylinderGeometry(0.045, 0.03, 0.14, 12).rotateX(Math.PI / 2),
        sharedMaterials.exhaust(),
        placed(side * 0.22, y(0.44), zTail - 0.1),
      );
    // Nose intake.
    parts.add(
      new T.CircleGeometry(0.1, detail === 0 ? 24 : 12),
      sharedMaterials.grille(),
      placed(0, y(s.noseHeight) - 0.04, zNose + 0.003),
    );
    for (const side of [-1, 1]) {
      parts.add(
        roundedBox(0.1, 0.05, 0.05, 0.015, 2),
        sharedMaterials.chrome(),
        placed(side * 0.3, y(tubTop + 0.04), zCockpit + 0.3),
      );
    }
  }
  parts.build(lod.group, detail === 0);
  // Suspension links: wishbone legs and push rods from tub to hubs.
  const links: Link[] = [];
  if (detail < 2)
    for (let w = 0; w < 4; w++) {
      const front = w < 2,
        side = w % 2 === 0 ? -1 : 1,
        za = front ? f.frontAxle : f.rearAxle,
        inner = (front ? width.at(za) : Math.max(0.16, width.at(za))) * side;
      for (const dz of [0.2, -0.2])
        for (const [dy, oy] of [
          [0.04, 0.09],
          [0.2, -0.07],
        ] as const)
          links.push({
            inboard: new T.Vector3(
              inner,
              (front ? f.hubFront : f.hubRear) + dy * (front ? 1 : 0.8),
              za + dz,
            ),
            wheel: w,
            offset: new T.Vector3(-side * 0.08, oy, 0),
          });
    }
  return links;
}
export function buildKart(
  f: BodyFrame,
  s: KartSheet,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
) {
  void s;
  const parts = new Parts(),
    y = f.y,
    steel = sharedMaterials.steel(),
    plastic = sharedMaterials.plastic();
  const zF = f.frontAxle,
    zR = f.rearAxle,
    tw = f.trackRear / 2;
  const sides = detail === 0 ? 8 : 5;
  // Chassis rails, crossmembers and bumpers.
  const rail = (a: [number, number, number], b: [number, number, number], r = 0.014) =>
    parts.add(rodGeometry(new T.Vector3(...a), new T.Vector3(...b), r, sides), steel);
  for (const side of [-1, 1]) {
    rail([side * 0.18, y(0.05), zF + 0.15], [side * 0.3, y(0.05), zF - 0.35]);
    rail([side * 0.3, y(0.05), zF - 0.35], [side * 0.3, y(0.05), zR + 0.1]);
    rail([side * 0.3, y(0.05), zR + 0.1], [side * 0.22, y(0.06), zR - 0.25]);
  }
  rail([-0.3, y(0.05), zR + 0.1], [0.3, y(0.05), zR + 0.1]);
  rail([-0.3, y(0.05), zF - 0.35], [0.3, y(0.05), zF - 0.35]);
  rail([-tw * 0.9, y(0.12), zR - 0.05], [tw * 0.9, y(0.12), zR - 0.05], 0.018);
  if (detail < 2) {
    // Nose fairing and front panel (number board).
    parts.add(
      roundedBox(0.95, 0.12, 0.3, 0.05, 3),
      mats.paint,
      placed(0, y(0.12), zF + 0.28, 0.12),
    );
    parts.add(
      roundedBox(0.4, 0.3, 0.02, 0.03, 2),
      mats.paint,
      placed(0, y(0.32), zF + 0.04, -0.45),
    );
    parts.add(new T.PlaneGeometry(0.3, 0.24), mats.board, placed(0, y(0.325), zF + 0.055, -0.45));
    // Side pods between the wheels.
    for (const side of [-1, 1])
      parts.add(
        roundedBox(0.2, 0.16, 0.62, 0.06, 3),
        mats.paint,
        placed(side * (tw - 0.06), y(0.14), (zF + zR) / 2 - 0.05),
      );
    // Rear bumper.
    parts.add(roundedBox(1.25, 0.1, 0.12, 0.04, 2), plastic, placed(0, y(0.16), zR - 0.32));
    // Floor tray.
    parts.add(roundedBox(0.5, 0.01, 0.85, 0.004, 1), plastic, placed(0, y(0.06), zF - 0.35));
    // Engine, cylinder and exhaust.
    parts.add(roundedBox(0.2, 0.22, 0.24, 0.03, 2), steel, placed(0.26, y(0.22), zR + 0.15));
    parts.add(
      new T.CylinderGeometry(0.06, 0.07, 0.16, 14),
      sharedMaterials.chrome(),
      placed(0.26, y(0.4), zR + 0.17),
    );
    parts.add(
      tubeGeometry(
        [
          [0.3, y(0.38), zR + 0.25],
          [0.42, y(0.26), zR + 0.1],
          [0.42, y(0.2), zR - 0.2],
          [0.34, y(0.22), zR - 0.38],
        ],
        0.035,
        16,
        10,
      ),
      sharedMaterials.exhaust(),
    );
    parts.add(
      roundedBox(0.04, 0.24, 0.3, 0.01, 1),
      sharedMaterials.grille(),
      placed(-0.28, y(0.3), zR + 0.2),
    );
  }
  // Seat and driver.
  const seatZ = zR + 0.3,
    seatY = y(0.06);
  parts.add(roundedBox(0.4, 0.42, 0.36, 0.08, 2), plastic, placed(0, seatY + 0.2, seatZ, -0.25));
  addDriver(parts, mats, 0, seatY, seatZ + 0.1, 0.92, zF - 0.08, false);
  parts.add(
    rodGeometry(
      new T.Vector3(0, y(0.12), zF + 0.02),
      new T.Vector3(0, y(0.5), zF - 0.12),
      0.012,
      sides,
    ),
    steel,
  );
  parts.build(lod.group, detail === 0);
}
