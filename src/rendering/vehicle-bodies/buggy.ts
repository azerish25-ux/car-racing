import * as T from 'three';
import type { BuggySheet } from './body-sheet.ts';
import { addDriver, type BuiltLod, type CarMaterials } from './common.ts';
import type { BodyFrame } from './frame.ts';
import { rodGeometry, roundedBox, tubeGeometry } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import type { Link } from './open-wheel.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Tube-frame desert buggy (WP30 catalogue growth): an exposed space frame
 * and roll cage over a two-seat cockpit, minimal glass-fibre panels (nose,
 * flanks, optional roof), a mid-mounted engine with its radiator and
 * exhausts in the rear cage, a spare wheel and a lamp bar. The wheels stand
 * outside the body on long-travel arms, rebuilt per frame by the manager
 * from the hub poses like a single-seater's links. */
type V3 = [number, number, number];
export function buildBuggy(
  f: BodyFrame,
  s: BuggySheet,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
): Link[] {
  const parts = new Parts(),
    y = f.y,
    steel = sharedMaterials.steel(),
    sides = detail === 0 ? 10 : detail === 1 ? 6 : 4,
    tube = (a: V3, b: V3, r = 0.024) =>
      parts.add(rodGeometry(new T.Vector3(...a), new T.Vector3(...b), r, sides), steel);
  const zF = f.frontAxle,
    zR = f.rearAxle,
    zNose = zF + 0.72,
    zTail = zR - 0.62,
    zCockpit = f.z(s.cockpit),
    floor = y(0.36),
    roof = y(s.roof),
    hw = 0.55,
    roofW = 0.5;
  // Lower frame: perimeter rails, cross members, nose and tail hoops.
  for (const side of [-1, 1]) {
    tube([side * 0.32, floor + 0.06, zNose], [side * hw, floor, zF - 0.25]);
    tube([side * hw, floor, zF - 0.25], [side * hw, floor, zR + 0.35]);
    tube([side * hw, floor, zR + 0.35], [side * 0.36, floor + 0.12, zTail]);
    // Upper side rail (door bar) and the A/C pillars of the cage.
    tube([side * hw, floor + 0.32, zF - 0.3], [side * hw, floor + 0.32, zR + 0.4]);
    tube([side * hw, floor + 0.32, zF - 0.3], [side * roofW, roof, zCockpit + 0.55]);
    tube([side * roofW, roof, zCockpit + 0.55], [side * roofW, roof, zCockpit - 0.55]);
    tube([side * roofW, roof, zCockpit - 0.55], [side * hw, floor, zCockpit - 0.65]);
    // Rear cage over the engine down to the tail; front cage to the nose.
    tube([side * roofW, roof, zCockpit - 0.55], [side * 0.38, floor + 0.42, zTail + 0.1]);
    tube([side * hw, floor + 0.32, zF - 0.3], [side * 0.32, floor + 0.28, zNose - 0.05]);
  }
  for (const z of [zNose, zF - 0.25, zCockpit - 0.65, zR + 0.35])
    tube([-hw * (z === zNose ? 0.58 : 1), floor, z], [hw * (z === zNose ? 0.58 : 1), floor, z]);
  tube([-roofW, roof, zCockpit + 0.55], [roofW, roof, zCockpit + 0.55]);
  tube([-roofW, roof, zCockpit - 0.55], [roofW, roof, zCockpit - 0.55]);
  tube([-0.36, floor + 0.12, zTail], [0.36, floor + 0.12, zTail], 0.03);
  if (detail < 2) {
    // Diagonals in the roof and the rear cage.
    tube([-roofW, roof, zCockpit + 0.55], [roofW, roof, zCockpit - 0.55], 0.018);
    tube([-0.38, floor + 0.42, zTail + 0.1], [0.38, floor + 0.42, zTail + 0.1], 0.02);
    // Shock towers: coil-over pairs leaning onto each axle.
    for (const za of [zF, zR])
      for (const side of [-1, 1])
        for (const dz of [0.1, -0.1])
          parts.add(
            rodGeometry(
              new T.Vector3(side * 0.42, floor + 0.55, za + dz),
              new T.Vector3(
                side * (za === zF ? f.trackFront : f.trackRear) * 0.36,
                floor - 0.05,
                za + dz,
              ),
              0.034,
              sides,
            ),
            sharedMaterials.chrome(),
          );
  }
  // Panels: a nose bonnet with lamp pods, low flanks and an optional roof.
  parts.add(
    roundedBox(hw * 1.5, 0.16, zNose - (zF - 0.3), 0.06, 3),
    mats.paint,
    placed(0, floor + 0.3, (zNose + zF - 0.3) / 2, 0.12),
  );
  for (const side of [-1, 1]) {
    parts.add(
      roundedBox(0.03, 0.26, zF - 0.4 - (zR + 0.45), 0.012, 2),
      mats.paint,
      placed(side * (hw + 0.02), floor + 0.17, (zF - 0.4 + zR + 0.45) / 2),
    );
    parts.add(
      new T.CylinderGeometry(0.08, 0.08, 0.08, detail === 0 ? 20 : 10).rotateX(Math.PI / 2),
      sharedMaterials.trim(),
      placed(side * 0.26, floor + 0.36, zNose - 0.04),
    );
    parts.add(
      new T.CircleGeometry(0.07, detail === 0 ? 20 : 10),
      mats.head,
      placed(side * 0.26, floor + 0.36, zNose + 0.002),
    );
    // Tail lamps on the rear hoop.
    parts.add(
      roundedBox(0.1, 0.06, 0.02, 0.01, 1),
      mats.tail,
      placed(side * 0.26, floor + 0.2, zTail - 0.02),
    );
  }
  if (s.roofPanel)
    parts.add(
      roundedBox(roofW * 2.04, 0.025, 1.18, 0.01, 1),
      mats.paint,
      placed(0, roof + 0.03, zCockpit),
    );
  if (s.lightbar)
    parts.add(
      roundedBox(roofW * 1.8, 0.07, 0.08, 0.02, 2),
      mats.head,
      placed(0, roof + 0.09, zCockpit + 0.5),
    );
  // Engine bay: block, radiator behind it, intake and exhausts.
  const ze = zR + 0.3;
  parts.add(
    roundedBox(0.5, 0.34, 0.6, 0.05, 2),
    sharedMaterials.steel(),
    placed(0, floor + 0.26, ze),
  );
  if (detail < 2) {
    parts.add(
      roundedBox(0.62, 0.42, 0.06, 0.02, 1),
      sharedMaterials.grille(),
      placed(0, floor + 0.46, zTail + 0.25, -0.35),
    );
    for (const side of [-1, 1])
      parts.add(
        tubeGeometry(
          [
            [side * 0.2, floor + 0.3, ze + 0.2],
            [side * 0.3, floor + 0.18, ze - 0.1],
            [side * 0.3, floor + 0.2, zTail + 0.1],
            [side * 0.26, floor + 0.32, zTail - 0.02],
          ],
          0.035,
          16,
          8,
        ),
        sharedMaterials.exhaust(),
      );
  }
  if (s.spare && detail < 2) {
    // Spare wheel lying flat on the rear cage.
    const zs = zTail + 0.48,
      ys = floor + 0.62;
    parts.add(
      new T.TorusGeometry(f.radius * 0.72, f.radius * 0.26, 12, detail === 0 ? 36 : 16).rotateX(
        Math.PI / 2,
      ),
      sharedMaterials.plastic(),
      placed(0, ys, zs),
    );
  }
  // Two seats and the driver (left seat).
  for (const side of [-1, 1]) {
    parts.add(
      roundedBox(0.42, 0.12, 0.46, 0.04, 2),
      sharedMaterials.interior(),
      placed(side * 0.28, floor + 0.08, zCockpit - 0.05),
    );
    parts.add(
      roundedBox(0.42, 0.64, 0.12, 0.05, 2),
      sharedMaterials.interior(),
      placed(side * 0.28, floor + 0.38, zCockpit - 0.3, -0.16),
    );
  }
  addDriver(parts, mats, 0.28, floor + 0.08, zCockpit - 0.1, 0.92, zCockpit + 0.36);
  parts.build(lod.group, detail === 0);
  // Long-travel arms: upper and lower wishbones from the frame to each hub.
  const links: Link[] = [];
  if (detail < 2)
    for (let w = 0; w < 4; w++) {
      const front = w < 2,
        side = w % 2 === 0 ? -1 : 1,
        za = front ? zF : zR,
        hub = front ? f.hubFront : f.hubRear;
      for (const dz of [0.22, -0.22])
        for (const [dy, oy] of [
          [-0.02, -0.08],
          [0.22, 0.1],
        ] as const)
          links.push({
            inboard: new T.Vector3(side * 0.42, hub + dy, za + dz),
            wheel: w,
            offset: new T.Vector3(-side * 0.1, oy, 0),
          });
    }
  return links;
}
