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
import type { CabinLayout } from './cabin.ts';
import { buildFrameCabin, buildOpenWheelCabin } from './interior.ts';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';

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
  cabin?: { layout: CabinLayout; def: VehicleDefinition },
): Link[] {
  const near = detail === 0 && cabin ? cabin : null;
  const modern = s.era === 'modern',
    historic = s.era === 'historic',
    seventies = s.era === 'seventies',
    eighties = s.era === 'eighties';
  /** Value by era: 1970s cars default to the historic shape, 1980s cars to
   * the modern one (so the original two eras keep their exact geometry). */
  const pick = (m: number, h: number, s70 = h, s80 = m) =>
    modern ? m : historic ? h : seventies ? s70 : s80;
  const zNose = f.frontAxle + s.overhang[0],
    zTail = f.rearAxle - s.overhang[1] + pick(0.25, 0.1, 0.12, 0.2),
    zCockpit = f.z(s.cockpit),
    y = f.y;
  const [tubW, tubTop] = s.tub;
  // The 1970s wedge carries a broad, thin chisel nose; the 1980s car a
  // narrow pointed one.
  const width = new Track([
    [zTail, pick(0.1, 0.12, 0.14, 0.12)],
    [f.rearAxle, pick(0.14, 0.2, 0.22, 0.18)],
    [zCockpit - 0.6, pick(0.26, tubW * 0.95, tubW * 0.95, 0.3)],
    [zCockpit, tubW],
    [zCockpit + 0.5, tubW * 0.9],
    [f.frontAxle, pick(0.13, 0.22, 0.3, 0.14)],
    [zNose - 0.2, pick(0.09, 0.17, 0.32, 0.1)],
    [zNose, pick(0.07, 0.14, 0.3, 0.08)],
  ]);
  const top = new Track([
    [zTail, y(pick(0.48, 0.5, 0.55, 0.5))],
    [f.rearAxle, y(pick(0.55, 0.58, 0.62, 0.6))],
    [zCockpit - 0.7, y(pick(0.92, 0.66, 0.78, 0.72))],
    [zCockpit - 0.25, y(pick(1.0, tubTop + 0.04, tubTop + 0.06, 0.8))],
    [zCockpit - 0.05, y(tubTop - 0.04)],
    [zCockpit + 0.35, y(tubTop - 0.06)],
    [zCockpit + 0.75, y(pick(tubTop - 0.04, tubTop - 0.02))],
    [f.frontAxle, y(pick(0.5, 0.48, 0.42, 0.46))],
    [zNose - 0.15, y(s.noseHeight + 0.06)],
    [zNose, y(s.noseHeight)],
  ]);
  const bottom = new Track([
    [zTail, y(pick(0.2, 0.16, 0.16, 0.18))],
    [f.rearAxle, y(0.06)],
    [f.frontAxle, y(pick(0.12, 0.1, 0.1, 0.1))],
    [zNose, y(s.noseHeight - pick(0.1, 0.12, 0.06, 0.1))],
  ]);
  const pod = (z: number) => {
    if (historic || s.sidepod <= 0) return 0;
    // 1980s pods run almost to the rear axle; 1970s radiator pods are wedges.
    const a = f.frontAxle - pick(0.85, 0.85, 1.0, 0.95),
      b = f.rearAxle + pick(0.5, 0.5, 0.55, 0.15);
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
      podTop = b + 0.08 + p * pick(0.3, 0.3, 0.24, 0.22),
      round = pick(0.04, (t - b) * 0.32, (t - b) * 0.25, 0.05);
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
      // Cockpit opening between the halo/screen and the headrest: open on the
      // near LOD (the cabin fills it), a dark lid on the others.
      if (j >= topStart && zMid < zCockpit + 0.42 && zMid > zCockpit - 0.32) return near ? -1 : 1;
      if (s.stripe === 'centre' && j >= topStart + counts[7] - 1) return 2;
      if (j < counts[0]) return 3;
      return 0;
    },
  });
  const parts = new Parts();
  parts.addGrouped(
    tub,
    [mats.paint, sharedMaterials.cabinLid(), mats.accent, sharedMaterials.carbonSatin()],
    'Monocoque (lofted)',
  );
  const carbon = sharedMaterials.carbon(),
    satin = sharedMaterials.carbonSatin();
  // Driver (the near cabin seats its own, with legs and a turning wheel).
  const seatY = y(0.12),
    seatZ = zCockpit - 0.1;
  if (!near) addDriver(parts, mats, 0, seatY, seatZ, 0.92, zCockpit + 0.36, historic);
  else {
    const rear = zCockpit - 0.32,
      front = zCockpit + 0.42,
      edge = (z: number) => ring(Math.max(rear, Math.min(front, z))).half[topStart];
    const mirrorAt: (readonly [number, number, number])[] =
      modern || eighties
        ? [-1, 1].map((side) => [side * 0.5, y(0.68), zCockpit + 0.42 - 0.034] as const)
        : [-1, 1].map((side) => [side * 0.3, y(tubTop + 0.04), zCockpit + 0.3 - 0.029] as const);
    lod.cabin = buildOpenWheelCabin({
      layout: near.layout,
      def: near.def,
      mats,
      shell: parts,
      lod,
      opening: {
        rear,
        front,
        floor: Math.min(seatY - 0.01, Math.max(bottom.at(rear), bottom.at(front)) + 0.01),
        edge,
      },
      openFace: historic,
      mirrorAt,
      mirrorSize: modern || eighties ? [0.14, 0.045] : [0.085, 0.038],
    });
  }
  if (detail < 2) {
    // Headrest / roll structure.
    if (modern || eighties)
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
    // Shape x runs back from the airbox (negative x -> -z): the fin tapers
    // from the airbox to the rear axle over the engine cover.
    g.rotateY(-Math.PI / 2).translate(0.005, y(0.55), zCockpit - 0.5);
    parts.add(g, mats.paint);
  }
  if (seventies && s.airbox && detail < 2) {
    // Tall periscope airbox over the driver's head, intake facing forward.
    const za = zCockpit - 0.5;
    parts.add(
      roundedBox(0.3, 0.34, 0.56, 0.08, 3),
      mats.paint,
      placed(0, y(tubTop + 0.26), za, -0.08),
    );
    parts.add(
      roundedBox(0.22, 0.2, 0.02, 0.03, 2),
      sharedMaterials.grille(),
      placed(0, y(tubTop + 0.3), za + 0.28, -0.08),
    );
  }
  if ((seventies || eighties) && detail < 2) {
    // Wedge/flat-bottom era: wings on simple mounts, a single-plane front
    // wing either side of the nose and a big rear wing.
    const carbon70 = seventies ? mats.paint : carbon;
    if (s.frontWing) {
      const span = s.frontWingSpan ?? 1.5,
        zw = zNose - (seventies ? 0.18 : 0.1),
        yw = y(seventies ? 0.17 : 0.1);
      const front = new Parts();
      front.add(
        aerofoil(seventies ? 0.36 : 0.3, 0.1, 0.05, span, detail === 0 ? 12 : 6),
        carbon70,
        placed(0, yw, zw, seventies ? 0.12 : 0.06),
      );
      for (const side of [-1, 1])
        front.add(
          roundedBox(0.012, 0.16, 0.4, 0.004, 1),
          carbon70,
          placed(side * (span / 2), yw + 0.04, zw - 0.12),
        );
      const g = new T.Group();
      g.name = 'Front wing (detachable)';
      front.build(g, detail === 0);
      lod.group.add(g);
      lod.front.push(g);
    }
    if (s.rearWing) {
      const w = s.rearWingAt ?? { behind: 0.5, height: 0.9, span: 1.0, chord: 0.45 };
      const zw = f.rearAxle - w.behind,
        yw = y(w.height);
      const rear = new Parts();
      rear.add(
        aerofoil(w.chord, 0.12, 0.07, w.span, detail === 0 ? 14 : 6),
        carbon70,
        placed(0, yw, zw, 0.14),
      );
      rear.add(
        aerofoil(w.chord * 0.45, 0.1, 0.05, w.span * 0.98, 8),
        carbon70,
        placed(0, yw + 0.08, zw - w.chord * 0.85, 0.5),
      );
      for (const side of [-1, 1])
        rear.add(
          roundedBox(0.012, 0.36, w.chord * 1.5, 0.006, 1),
          carbon70,
          placed(side * (w.span / 2 + 0.006), yw - 0.05, zw - w.chord * 0.45),
        );
      if (seventies)
        // One central pylon from the gearbox.
        rear.add(
          roundedBox(0.03, yw - y(0.5), 0.16, 0.01, 1),
          sharedMaterials.steel(),
          placed(0, (yw + y(0.5)) / 2, zw - 0.1),
        );
      else
        for (const side of [-1, 1])
          rear.add(
            roundedBox(0.02, yw - y(0.55), 0.12, 0.008, 1),
            carbon,
            placed(side * w.span * 0.3, (yw + y(0.55)) / 2, zw - 0.08),
          );
      const g = new T.Group();
      g.name = 'Rear wing (detachable)';
      rear.build(g, detail === 0);
      lod.group.add(g);
      lod.rear.push(g);
    }
  }
  if (modern && s.frontWing) {
    const zw = zNose - 0.05,
      yw = y(0.1),
      span = s.frontWingSpan ?? 1.75;
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
    const zw = f.rearAxle - (s.rearWingAt?.behind ?? 0.42),
      yw = y(s.rearWingAt?.height ?? 0.92),
      span = s.rearWingAt?.span ?? 1.0;
    const rear = new Parts();
    rear.add(
      aerofoil(s.rearWingAt?.chord ?? 0.36, 0.12, 0.07, span, detail === 0 ? 14 : 6),
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
  if ((modern || eighties) && detail < 2) {
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
  if (eighties && detail < 2)
    // Turbo era: the engine hides under its cover; one wastegate pipe and a
    // central exhaust exit at the tail.
    parts.add(
      new T.CylinderGeometry(0.05, 0.06, 0.18, 14).rotateX(Math.PI / 2),
      sharedMaterials.exhaust(),
      placed(0, y(0.36), zTail - 0.06),
    );
  if ((historic || seventies) && detail < 2) {
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
    // Nose intake (the 1960s radiator; the 1970s wedge has none).
    if (historic)
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
  if (lod.cabin)
    lod.group.traverse((o) => {
      if (o instanceof T.Mesh && !Array.isArray(o.material) && o.material.userData.vehicleGlass)
        lod.cabin!.glass.push(o);
    });
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
  cabin?: { layout: CabinLayout; def: VehicleDefinition },
) {
  const compact = s.nose === 'compact',
    short = s.pods === 'short',
    air = s.cooling === 'air',
    enclosed = s.bumper === 'enclosed';
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
    // Nose fairing and front panel (number board); a compact sprint nose is
    // narrower, shorter and higher.
    parts.add(
      compact ? roundedBox(0.72, 0.14, 0.22, 0.05, 3) : roundedBox(0.95, 0.12, 0.3, 0.05, 3),
      mats.paint,
      compact ? placed(0, y(0.13), zF + 0.22, 0.2) : placed(0, y(0.12), zF + 0.28, 0.12),
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
        short ? roundedBox(0.22, 0.2, 0.46, 0.07, 3) : roundedBox(0.2, 0.16, 0.62, 0.06, 3),
        mats.paint,
        placed(side * (tw - 0.06), y(short ? 0.15 : 0.14), (zF + zR) / 2 - (short ? 0.12 : 0.05)),
      );
    // Rear bumper: a tube bar, or a full-width enclosed plastic bumper.
    if (enclosed)
      parts.add(roundedBox(1.42, 0.2, 0.22, 0.08, 3), plastic, placed(0, y(0.18), zR - 0.34));
    else parts.add(roundedBox(1.25, 0.1, 0.12, 0.04, 2), plastic, placed(0, y(0.16), zR - 0.32));
    // Floor tray.
    parts.add(roundedBox(0.5, 0.01, 0.85, 0.004, 1), plastic, placed(0, y(0.06), zF - 0.35));
    // Engine, cylinder and exhaust.
    parts.add(roundedBox(0.2, 0.22, 0.24, 0.03, 2), steel, placed(0.26, y(0.22), zR + 0.15));
    parts.add(
      new T.CylinderGeometry(0.06, 0.07, 0.16, 14),
      sharedMaterials.chrome(),
      placed(0.26, y(0.4), zR + 0.17),
    );
    // An air-cooled engine wears cooling fins on its cylinder and a large
    // intake silencer ahead of it instead of the side radiator.
    if (air) {
      for (let k = 0; k < 5; k++)
        parts.add(
          new T.CylinderGeometry(0.095, 0.095, 0.008, 14),
          sharedMaterials.chrome(),
          placed(0.26, y(0.34 + k * 0.025), zR + 0.17),
        );
      parts.add(roundedBox(0.16, 0.18, 0.3, 0.06, 2), plastic, placed(0.12, y(0.3), zR + 0.45));
    }
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
    if (!air)
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
  const near = detail === 0 && cabin ? cabin : null;
  const headParts = new Parts();
  addDriver(parts, mats, 0, seatY, seatZ + 0.1, 0.92, zF - 0.08, false, {
    ...(near ? { head: headParts, wheel: false, handDrop: near.layout.wheel.handDrop } : {}),
  });
  if (near)
    lod.cabin = buildFrameCabin({
      layout: near.layout,
      def: near.def,
      shell: parts,
      lod,
      headParts,
    });
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
