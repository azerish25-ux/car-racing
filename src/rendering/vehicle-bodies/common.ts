import * as T from 'three';
import { LIVERIES } from '../../simulation/config.ts';
import type { PaintFinish } from '../paint-finish.ts';
import { revolveX, roundedBox, tubeGeometry, type Pt } from './loft.ts';
import {
  bodyPaint,
  lampMaterial,
  numberBoard,
  sharedMaterials,
  type PanelGap,
} from './materials.ts';
import { placed, type Parts } from './parts.ts';

/** Per-car materials: its own paint (livery colour), accent, lamps (driven
 * from the snapshot), number board and helmet; everything else is shared. */
export interface CarMaterials {
  paint: T.MeshPhysicalMaterial;
  accent: T.MeshPhysicalMaterial;
  helmet: T.MeshPhysicalMaterial;
  head: T.MeshStandardMaterial;
  tail: T.MeshStandardMaterial;
  board: T.MeshStandardMaterial;
  suit: T.MeshStandardMaterial;
}
const ACCENTS = [0xf2f2ef, 0x101113, 0xf2c200, 0xe9e9eb, 0xb3121e, 0x111111];
export function carMaterials(id: number, finish: PaintFinish, gaps: readonly PanelGap[]) {
  const color = LIVERIES[id % LIVERIES.length];
  const accentColor =
    ACCENTS[id % ACCENTS.length] === color ? 0x101113 : ACCENTS[id % ACCENTS.length];
  const helmet = bodyPaint(accentColor, 'gloss');
  const materials: CarMaterials = {
    paint: bodyPaint(color, finish, gaps),
    accent: bodyPaint(accentColor, finish === 'metallic' ? 'gloss' : finish),
    helmet,
    head: lampMaterial(0xe8edf2, 0xfff4e2),
    tail: lampMaterial(0x4a0606, 0xff1a12),
    board: numberBoard(id + 1),
    suit: sharedMaterials.suit(color) as T.MeshStandardMaterial,
  };
  materials.paint.name = 'Body paint';
  return materials;
}
/** One level of detail: its static group plus the detachable elements the
 * snapshot's component health hides (wings, splitters, noses). */
export interface BuiltLod {
  group: T.Group;
  front: T.Object3D[];
  rear: T.Object3D[];
}
export function emptyLod(name: string): BuiltLod {
  const group = new T.Group();
  group.name = name;
  return { group, front: [], rear: [] };
}
/** A seated driver: helmet with visor, HANS collar, shoulders, torso and
 * arms reaching for a wheel `reach` m ahead. `scale` 1 is an adult. */
export function addDriver(
  parts: Parts,
  mats: CarMaterials,
  x: number,
  seatY: number,
  z: number,
  scale: number,
  wheelZ: number,
  openFace = false,
) {
  const s = scale,
    headY = seatY + 0.74 * s,
    headZ = z + 0.02;
  // Helmet: a lathe about the vertical axis (rotate the X-axis lathe).
  const shell: Pt[] = [
    [0.0, -0.13],
    [0.09, -0.125],
    [0.125, -0.06],
    [0.135, 0.02],
    [0.12, 0.085],
    [0.08, 0.125],
    [0.0, 0.14],
  ].map(([r, a]) => [r * s, a * s] as const);
  const helmet = revolveX(shell, 24).rotateZ(Math.PI / 2);
  helmet.scale(1, 1, 1.12);
  parts.add(helmet, mats.helmet, placed(x, headY, headZ));
  if (!openFace) {
    const visor = roundedBox(0.2 * s, 0.07 * s, 0.03 * s, 0.012 * s, 2);
    parts.add(
      visor,
      sharedMaterials.visor(),
      placed(x, headY + 0.01 * s, headZ + 0.128 * s, -0.12),
    );
  } else {
    const goggles = roundedBox(0.18 * s, 0.05 * s, 0.03 * s, 0.015 * s, 2);
    parts.add(goggles, sharedMaterials.visor(), placed(x, headY + 0.02 * s, headZ + 0.13 * s));
  }
  // Collar, shoulders and torso.
  parts.add(
    new T.CylinderGeometry(0.11 * s, 0.13 * s, 0.08 * s, 16),
    sharedMaterials.trim(),
    placed(x, headY - 0.16 * s, z - 0.02),
  );
  parts.add(
    roundedBox(0.44 * s, 0.2 * s, 0.24 * s, 0.08 * s, 3),
    mats.suit,
    placed(x, headY - 0.27 * s, z - 0.04),
  );
  parts.add(
    roundedBox(0.36 * s, 0.42 * s, 0.22 * s, 0.09 * s, 3),
    mats.suit,
    placed(x, headY - 0.52 * s, z - 0.06, -0.12),
  );
  // Arms to the wheel, hands on it.
  const shoulderY = headY - 0.27 * s,
    hand = new T.Vector3(0, headY - 0.38 * s, wheelZ);
  for (const side of [-1, 1]) {
    const sx = x + side * 0.19 * s,
      hx = x + side * 0.17 * s;
    parts.add(
      tubeGeometry(
        [
          [sx, shoulderY, z - 0.02],
          [sx + side * 0.03 * s, shoulderY - 0.2 * s, (z + wheelZ) / 2],
          [hx, hand.y, wheelZ - 0.03],
        ],
        0.045 * s,
        10,
        8,
      ),
      mats.suit,
    );
    parts.add(
      new T.SphereGeometry(0.045 * s, 10, 8),
      sharedMaterials.trim(),
      placed(hx, hand.y, wheelZ),
    );
  }
  // Steering wheel.
  const wheel = new T.TorusGeometry(0.15 * s, 0.016 * s, 8, 24);
  parts.add(wheel, sharedMaterials.trim(), placed(x, hand.y, wheelZ + 0.02, -0.35));
}
