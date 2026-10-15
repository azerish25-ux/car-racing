import * as T from 'three';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import type { CabinLayout } from './cabin.ts';
import { CabinDisplay, type DisplayKind } from './cabin-display.ts';
import type { Greenhouse } from './closed-body.ts';
import { addDriver, type BuiltLod, type CarMaterials } from './common.ts';
import {
  insetProfile,
  rodGeometry,
  roundedBox,
  sampleProfile,
  tubeGeometry,
  type Pt,
} from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';

/** Procedural cabins per body family (cars loose ends 2). Each near (LOD0)
 * body gets two layers:
 *  - a shell merged into the body's own LOD0 draws per material: the cockpit
 *    cell (floor, door cards, bulkheads, footwell, headliner), dashboard,
 *    seats, the driver with legs and the steering column; the turning wheel
 *    is one more draw of its own;
 *  - a detail group drawn only for the followed car and cars close to the
 *    camera: instruments (the car's own display), switch panel, shifter,
 *    console, harness or belts, the roll cage of a roofed race car, the
 *    interior mirror and the two rear-view feed surfaces.
 * The driver's helmet and visor are a separate group the cockpit view hides.
 * LOD1 and LOD2 carry none of this (a dark lid under the glass instead). */
export interface BuiltCabin {
  layout: CabinLayout;
  /** Furniture for the followed / nearby car only. */
  detail: T.Group;
  /** Wheel-mounted detail (display, buttons): toggled with `detail`. */
  wheelDetail: T.Object3D[];
  /** Helmet and visor (hidden in the driver's own cockpit view). */
  head: T.Group;
  /** Steering pivot: rotation.z = -F.STEER * layout.wheel.ratio. */
  steering: T.Group;
  /** Glazing seen from the cockpit (renderOrder raised in cockpit view). */
  glass: T.Mesh[];
  /** Rear-view feed surfaces [right, left] (MirrorViews order), or none. */
  mirrors: T.Mesh[];
  display: CabinDisplay | null;
}
/** Cockpit cell of a body: the open floor between `rear` and `front`, and
 * the inner wall at a station (x > 0 and the wall's top y). */
export interface CabinOpening {
  rear: number;
  front: number;
  floor: number;
  edge(z: number): Pt;
}
/** Distance (m) within which a rival's cabin detail is drawn. */
export const CABIN_DETAIL_DISTANCE = 15;
/** Transparent sort group of the followed car's glazing in its cockpit view:
 * drawn after every world transparent (guides, ghost, marks, particles), as
 * the glass is the surface nearest the eye. */
export const CABIN_GLASS_ORDER = 10;

/** A wall strip at |x| = edge(z) on `side`, from the floor to the edge top,
 * facing the cabin centreline. */
function wallStrip(op: CabinOpening, side: 1 | -1, z0: number, z1: number, n = 8, inset = 0.004) {
  const positions: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n,
      [x, top] = op.edge(Math.min(z, op.front));
    positions.push(side * (x - inset), op.floor - 0.02, z, side * (x - inset), top, z);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2,
      b = a + 1,
      c = a + 2,
      d = a + 3;
    // Front faces toward the centre (-side * x).
    if (side > 0) index.push(a, c, b, b, c, d);
    else index.push(a, b, c, b, d, c);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
/** A box spanning x0..x1, y0..y1, z0..z1. */
function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new T.BoxGeometry(
    Math.max(0.002, x1 - x0),
    Math.max(0.002, y1 - y0),
    Math.max(0.002, z1 - z0),
  );
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
/** A side profile (z, y polygon) extruded across x0..x1. */
function sideProfile(profile: readonly Pt[], x0: number, x1: number) {
  const shape = new T.Shape(profile.map(([z, y]) => new T.Vector2(z, y)));
  const g = new T.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: 1 });
  // Shape x -> car z, extrusion -> car -x; then move to x0..x1.
  g.rotateY(-Math.PI / 2);
  g.translate(x1, 0, 0);
  g.computeVertexNormals();
  return g;
}
/** A seat at (x, cushion top y, driver z). */
function addSeat(parts: Parts, layout: CabinLayout, x: number, floor: number) {
  const [, y, z] = layout.seat,
    race = layout.race,
    m = race ? sharedMaterials.interior() : sharedMaterials.leather();
  parts.add(roundedBox(0.44, 0.08, 0.46, 0.03, 2), m, placed(x, y - 0.04, z + 0.06));
  if (y - 0.08 - floor > 0.03)
    parts.add(
      slab(-0.18, 0.18, floor - 0.01, y - 0.07, -0.18, 0.18),
      sharedMaterials.plastic(),
      placed(x, 0, z + 0.04),
    );
  parts.add(roundedBox(0.46, 0.7, 0.07, 0.03, 2), m, placed(x, y + 0.36, z - 0.22, -0.2));
  if (race) {
    // Bucket: cushion and back bolsters, head wings either side of the helmet.
    for (const side of [-1, 1]) {
      parts.add(
        roundedBox(0.06, 0.16, 0.42, 0.025, 2),
        m,
        placed(x + side * 0.235, y + 0.05, z + 0.02),
      );
      parts.add(
        roundedBox(0.06, 0.5, 0.14, 0.025, 2),
        m,
        placed(x + side * 0.235, y + 0.38, z - 0.17, -0.2),
      );
      parts.add(
        roundedBox(0.05, 0.16, 0.16, 0.02, 2),
        m,
        placed(x + side * 0.16, y + 0.66, z - 0.15, -0.2),
      );
    }
  } else parts.add(roundedBox(0.26, 0.18, 0.1, 0.04, 2), m, placed(x, y + 0.78, z - 0.25, -0.12));
}
/** Belts: a race harness (two shoulder straps, lap belts, crotch strap) from
 * `anchorZ` behind the shoulders, or a road three-point belt from a pillar. */
function addBelts(parts: Parts, layout: CabinLayout, x: number, anchor: T.Vector3 | null) {
  const s = layout.driverScale,
    [, seatY, z] = layout.seat,
    headY = layout.head[1],
    shoulderY = headY - 0.27 * s,
    hipY = seatY + 0.08 * s,
    front = z + 0.095,
    m = sharedMaterials.harness(),
    r = 0.011;
  const buckle = new T.Vector3(x, hipY + 0.1, front + 0.01);
  if (layout.race) {
    for (const side of [-1, 1]) {
      const ax = x + side * 0.075;
      parts.add(
        tubeGeometry(
          [
            [ax, anchor ? anchor.y : shoulderY + 0.03, anchor ? anchor.z : z - 0.24],
            [ax + side * 0.01, shoulderY + 0.08 * s, z - 0.08],
            [ax, shoulderY + 0.02, front - 0.01],
            [x + side * 0.045, hipY + 0.16, front],
            [buckle.x + side * 0.01, buckle.y + 0.02, buckle.z],
          ],
          r,
          16,
          5,
        ),
        m,
      );
      parts.add(
        tubeGeometry(
          [
            [x + side * 0.2, seatY + 0.03, z - 0.04],
            [x + side * 0.15, hipY + 0.06, front - 0.02],
            [buckle.x + side * 0.02, buckle.y - 0.01, buckle.z],
          ],
          r,
          10,
          5,
        ),
        m,
      );
    }
    parts.add(
      tubeGeometry(
        [
          [x, seatY + 0.005, z + 0.12],
          [x, hipY + 0.04, front],
          [buckle.x, buckle.y - 0.02, buckle.z],
        ],
        r,
        8,
        5,
      ),
      m,
    );
    parts.add(
      roundedBox(0.07, 0.07, 0.02, 0.008, 1),
      sharedMaterials.chrome(),
      placed(buckle.x, buckle.y, buckle.z + 0.012),
    );
    return;
  }
  // Road: diagonal from the pillar anchor over the outer shoulder, and a lap belt.
  const top = anchor ?? new T.Vector3(x + 0.24, shoulderY + 0.12, z - 0.12);
  const lap = new T.Vector3(x - 0.18, hipY + 0.02, front - 0.02);
  parts.add(
    tubeGeometry(
      [
        [top.x, top.y, top.z],
        [x + 0.12, shoulderY + 0.05, front - 0.01],
        [x - 0.02, (shoulderY + hipY) / 2, front + 0.005],
        [lap.x, lap.y, lap.z],
      ],
      r,
      16,
      5,
    ),
    m,
  );
  parts.add(
    tubeGeometry(
      [
        [x + 0.22, seatY + 0.04, z - 0.02],
        [x + 0.05, hipY + 0.03, front],
        [lap.x, lap.y, lap.z],
      ],
      r,
      10,
      5,
    ),
    m,
  );
}
/** The turning steering wheel: a tilt pivot at the rim centre holding the
 * steer pivot; the rim lies in the pivot's XY plane facing the driver. */
function buildSteering(layout: CabinLayout, detail: T.Object3D[], display: CabinDisplay | null) {
  const w = layout.wheel,
    tilt = new T.Group(),
    steer = new T.Group();
  tilt.name = 'Steering column';
  steer.name = 'Steering wheel (turns with F.STEER)';
  tilt.position.set(...w.centre);
  tilt.rotation.x = w.tilt;
  tilt.add(steer);
  const parts = new Parts(),
    r = w.radius,
    grip = layout.race ? sharedMaterials.interior() : sharedMaterials.leather();
  if (w.style === 'formula') {
    // Rectangular single-seater wheel: centre body, two grips, paddles.
    parts.add(
      roundedBox(r * 1.7, r * 0.8, 0.045, 0.02, 2),
      sharedMaterials.carbon(),
      placed(0, 0, 0),
    );
    for (const side of [-1, 1])
      parts.add(roundedBox(0.045, r * 0.95, 0.05, 0.02, 2), grip, placed(side * r, -0.005, -0.004));
  } else {
    const tube = w.style === 'kart' ? 0.013 : 0.017;
    if (w.style === 'gt') {
      // Flat-bottomed race wheel: a 300-degree rim and a straight bottom.
      const gap = Math.PI / 6;
      const rim = new T.TorusGeometry(r, tube, 8, 30, Math.PI * 2 - 2 * gap);
      rim.rotateZ(-Math.PI / 2 + gap);
      parts.add(rim, grip);
      const y = -r * Math.cos(gap),
        x = r * Math.sin(gap);
      parts.add(rodGeometry(new T.Vector3(-x, y, 0), new T.Vector3(x, y, 0), tube, 8), grip);
    } else parts.add(new T.TorusGeometry(r, tube, 8, 32), grip);
    // Spokes: left, right and bottom (dished wheels sit forward of the rim),
    // and the hub; one material with the rim, so a rival's turning wheel is a
    // single draw.
    const dish = w.style === 'dished' ? 0.05 : 0.012;
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const end = new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0);
      parts.add(
        rodGeometry(new T.Vector3(0, 0, dish), end, w.style === 'kart' ? 0.008 : 0.012, 6),
        grip,
      );
    }
    parts.add(
      new T.CylinderGeometry(0.045, 0.05, 0.04, 16).rotateX(Math.PI / 2),
      grip,
      placed(0, 0, dish + 0.01),
    );
  }
  parts.build(steer, true);
  if (display && (w.style === 'formula' || w.style === 'kart')) {
    // Wheel display (single-seaters and karts).
    const size = w.style === 'formula' ? [0.12, 0.06] : [0.08, 0.04];
    const screen = new T.Mesh(
      new T.PlaneGeometry(size[0], size[1]).rotateY(Math.PI),
      display.material,
    );
    screen.name = 'Wheel display';
    screen.position.set(
      0,
      w.style === 'formula' ? 0.01 : 0.0,
      w.style === 'formula' ? -0.024 : -0.02,
    );
    steer.add(screen);
    detail.push(screen);
  }
  return tilt;
}
/** Two rear-view feed surfaces facing the driver (UVs run toward -x, the
 * feed texture is flipped by MirrorViews): [right, left]. */
function mirrorFaces(
  at: readonly (readonly [number, number, number])[],
  size: readonly [number, number],
) {
  return at.map(([x, y, z], i) => {
    const m = new T.Mesh(
      new T.PlaneGeometry(size[0], size[1]).rotateY(Math.PI),
      sharedMaterials.chrome(),
    );
    m.position.set(x, y, z);
    m.name = i === 0 ? 'Mirror glass (right)' : 'Mirror glass (left)';
    return m;
  });
}
/** Instruments and dash furniture shared by the closed and buggy cabins. */
function addInstruments(
  detail: Parts,
  layout: CabinLayout,
  display: CabinDisplay | null,
  group: T.Group,
  dashRear: number,
  dashTop: number,
) {
  const [x] = layout.seat,
    eye = layout.eye,
    road = !layout.race;
  const w = road ? 0.3 : 0.2,
    h = road ? 0.15 : 0.1;
  const y = Math.min(eye[1] - 0.17, dashTop - h / 2 - 0.015),
    z = dashRear - 0.006;
  // Face the eye: pitch the screen back toward the driver.
  const pitch = Math.atan2(eye[1] - y, z - eye[2]) * 0.8;
  if (display) {
    const screen = new T.Mesh(new T.PlaneGeometry(w, h).rotateY(Math.PI), display.material);
    screen.name = road ? 'Instrument binnacle display' : 'Race dash display';
    screen.position.set(x, y, z);
    screen.rotation.x = -pitch;
    group.add(screen);
  }
  // Surround: a carbon bezel (race) or a hooded binnacle (road).
  if (road)
    detail.add(
      roundedBox(w + 0.06, 0.04, 0.14, 0.018, 2),
      sharedMaterials.plastic(),
      placed(x, y + h / 2 + 0.02, z + 0.04, -0.1),
    );
  else
    detail.add(
      roundedBox(w + 0.03, h + 0.03, 0.012, 0.004, 1),
      sharedMaterials.carbon(),
      placed(x, y, z + 0.004, -pitch),
    );
}
/** Closed bodies (roofed and open cockpits): the cell, dash, seats, driver,
 * wheel, instruments, harness or belts, cage, mirrors. */
export function buildClosedCabin(input: {
  layout: CabinLayout;
  def: VehicleDefinition;
  mats: CarMaterials;
  shell: Parts;
  lod: BuiltLod;
  opening: CabinOpening;
  greenhouse: Greenhouse | null;
  mirrorAt: readonly (readonly [number, number, number])[];
}) {
  const { layout, mats, shell, opening: op, greenhouse: gh } = input;
  const cell = layout.cell!,
    dash = layout.dash!,
    [seatX] = layout.seat,
    detailParts = new Parts(),
    headParts = new Parts();
  const detail = new T.Group(),
    head = new T.Group(),
    wheelDetail: T.Object3D[] = [];
  detail.name = 'Cabin detail (followed / near car)';
  head.name = 'Driver head (hidden in own cockpit view)';
  const interior = sharedMaterials.interior(),
    plastic = sharedMaterials.plastic(),
    trim = sharedMaterials.trim();
  // Cell: floor, door cards, rear bulkhead, toe board.
  const xr = op.edge(op.rear)[0],
    xf = op.edge(Math.min(op.front, dash.rear))[0];
  const half = Math.min(xr, xf) - 0.006;
  shell.add(slab(-half, half, op.floor - 0.03, op.floor, op.rear, op.front), interior);
  for (const side of [-1, 1] as const)
    shell.add(
      wallStrip(op, side, op.rear - 0.01, op.front, 10),
      layout.race ? interior : sharedMaterials.leather(),
    );
  const [, rearTop] = op.edge(op.rear + 0.01);
  shell.add(slab(-xr, xr, op.floor - 0.03, rearTop, op.rear - 0.025, op.rear), interior);
  const dashBottom = dash.top - 0.26;
  shell.add(
    slab(-xf, xf, op.floor - 0.02, dashBottom + 0.02, cell.front - 0.02, cell.front),
    plastic,
  );
  // Dashboard: a wedge from under the cowl to its rear face, its top rising to
  // the windscreen base so no slit opens under the glass.
  const base = gh ? gh.base(gh.zWs) : dash.top + 0.02;
  const zWs = gh ? gh.zWs : (dash.front + dash.rear) / 2;
  const dx = op.edge(Math.min(zWs - 0.05, dash.rear + 0.05))[0] - 0.006;
  shell.add(
    sideProfile(
      [
        [dash.rear, dashBottom],
        [dash.front, dashBottom],
        [dash.front, Math.max(base, dash.top) + 0.004],
        [Math.min(zWs, dash.front - 0.01), Math.max(base - 0.002, dash.top + 0.003)],
        [dash.rear + 0.05, dash.top],
        [dash.rear, dash.top - 0.035],
      ],
      -dx,
      dx,
    ),
    layout.race ? sharedMaterials.carbonSatin() : plastic,
  );
  // Seats, driver with legs, column.
  addSeat(shell, layout, seatX, op.floor);
  if (layout.passenger) addSeat(shell, layout, -seatX, op.floor);
  if (layout.rearBench) {
    const zb = Math.max(op.rear + 0.32, layout.seat[2] - 0.75),
      y = layout.seat[1] - 0.02;
    shell.add(
      roundedBox(half * 1.7, 0.12, 0.44, 0.04, 2),
      sharedMaterials.leather(),
      placed(0, y - 0.06, zb + 0.04),
    );
    shell.add(
      roundedBox(half * 1.7, 0.56, 0.12, 0.04, 2),
      sharedMaterials.leather(),
      placed(0, y + 0.28, zb - 0.2, -0.2),
    );
  }
  const pedals = cell.front - 0.06;
  addDriver(
    shell,
    mats,
    seatX,
    layout.seat[1],
    layout.seat[2],
    layout.driverScale,
    layout.wheel.centre[2] - 0.02,
    false,
    {
      head: headParts,
      wheel: false,
      legs: { floor: op.floor, pedals },
      handDrop: layout.wheel.handDrop,
    },
  );
  const w = layout.wheel;
  const columnEnd = new T.Vector3(0, -0.02, 0.32)
    .applyAxisAngle(new T.Vector3(1, 0, 0), w.tilt)
    .add(new T.Vector3(...w.centre));
  shell.add(rodGeometry(new T.Vector3(...w.centre), columnEnd, 0.028, 10), trim);
  // Instruments and the display.
  const display = new CabinDisplay(layout.race ? 'race' : 'road', input.def.spec);
  addInstruments(detailParts, layout, display, detail, dash.rear, dash.top);
  const steering = buildSteering(layout, wheelDetail, display);
  input.lod.group.add(steering);
  // Centre furniture.
  const consoleTop = layout.seat[1] + 0.05;
  if (layout.race) {
    // Switch panel on the centre dash, sequential shifter, extinguisher.
    detailParts.add(
      roundedBox(0.2, 0.12, 0.03, 0.01, 1),
      sharedMaterials.carbon(),
      placed(0, dash.top - 0.09, dash.rear - 0.01, 0.3),
    );
    for (let k = 0; k < 6; k++)
      detailParts.add(
        new T.CylinderGeometry(0.009, 0.009, 0.014, 8).rotateX(Math.PI / 2),
        k % 3 === 0 ? sharedMaterials.harness() : trim,
        placed(
          -0.06 + (k % 3) * 0.06,
          dash.top - 0.065 - Math.floor(k / 3) * 0.05,
          dash.rear - 0.03,
        ),
      );
    const sx = seatX - 0.24,
      sz = w.centre[2] - 0.12;
    detailParts.add(
      roundedBox(0.08, Math.max(0.05, consoleTop - op.floor), 0.12, 0.02, 1),
      plastic,
      placed(sx, (consoleTop + op.floor) / 2, sz),
    );
    detailParts.add(
      rodGeometry(
        new T.Vector3(sx, consoleTop, sz),
        new T.Vector3(sx, consoleTop + 0.2, sz - 0.04),
        0.009,
        8,
      ),
      sharedMaterials.chrome(),
    );
    detailParts.add(
      new T.SphereGeometry(0.022, 10, 8),
      trim,
      placed(sx, consoleTop + 0.21, sz - 0.04),
    );
    if (!layout.passenger)
      detailParts.add(
        new T.CylinderGeometry(0.055, 0.055, 0.4, 14).rotateX(Math.PI / 2),
        sharedMaterials.harness(),
        placed(-seatX + 0.05, op.floor + 0.06, layout.seat[2] + 0.12),
      );
  } else {
    // Centre console, gear lever and a dark infotainment screen.
    const cz0 = layout.seat[2] - 0.25,
      cz1 = dash.rear;
    detailParts.add(slab(-0.09, 0.09, op.floor, consoleTop, cz0, cz1), plastic);
    detailParts.add(
      rodGeometry(
        new T.Vector3(0, consoleTop, layout.seat[2] + 0.3),
        new T.Vector3(0, consoleTop + 0.13, layout.seat[2] + 0.28),
        0.01,
        8,
      ),
      sharedMaterials.chrome(),
    );
    detailParts.add(
      new T.SphereGeometry(0.026, 12, 8),
      sharedMaterials.leather(),
      placed(0, consoleTop + 0.14, layout.seat[2] + 0.28),
    );
    detailParts.add(
      roundedBox(0.2, 0.12, 0.012, 0.006, 1),
      sharedMaterials.visor(),
      placed(0, dash.top - 0.1, dash.rear - 0.006, 0.2),
    );
    // Door armrests and pulls.
    for (const side of [-1, 1]) {
      const z = layout.seat[2] + 0.12,
        [ex] = op.edge(z);
      detailParts.add(
        roundedBox(0.07, 0.05, 0.42, 0.02, 2),
        sharedMaterials.leather(),
        placed(side * (ex - 0.04), consoleTop + 0.12, z),
      );
      detailParts.add(
        roundedBox(0.03, 0.03, 0.12, 0.01, 1),
        sharedMaterials.chrome(),
        placed(side * (ex - 0.02), consoleTop + 0.26, z + 0.3),
      );
    }
  }
  if (layout.style === 'rally' || layout.style === 'truck')
    // Hydraulic handbrake beside the shifter.
    detailParts.add(
      rodGeometry(
        new T.Vector3(seatX - 0.22, layout.seat[1], layout.seat[2] + 0.12),
        new T.Vector3(seatX - 0.24, layout.seat[1] + 0.32, layout.seat[2] + 0.08),
        0.012,
        8,
      ),
      sharedMaterials.harness(),
    );
  // Roll cage of a roofed race car, from the greenhouse sections.
  let anchor: T.Vector3 | null = null;
  if (layout.cage && gh && layout.hoop !== null) anchor = addCage(detailParts, layout, gh, op);
  else if (!layout.race && gh)
    anchor = new T.Vector3(seatX + 0.22, layout.head[1] - 0.1, (gh.zRF + gh.zRR) / 2 - 0.12);
  addBelts(detailParts, layout, seatX, anchor);
  if (layout.passenger) {
    const mirrored = {
      ...layout,
      seat: [-seatX, layout.seat[1], layout.seat[2]] as const,
    } as CabinLayout;
    addBelts(
      detailParts,
      mirrored,
      -seatX,
      anchor ? new T.Vector3(-anchor.x, anchor.y, anchor.z) : null,
    );
  }
  // Interior rear-view mirror on the windscreen header.
  if (gh) {
    const y = (layout.roof ?? gh.roofY) - 0.09,
      z = gh.zRF - 0.03;
    detailParts.add(roundedBox(0.24, 0.065, 0.035, 0.015, 2), trim, placed(0, y, z));
    detailParts.add(
      new T.PlaneGeometry(0.21, 0.045).rotateY(Math.PI),
      sharedMaterials.chrome(),
      placed(0, y, z - 0.019),
    );
    detailParts.add(
      rodGeometry(
        new T.Vector3(0, y + 0.02, z + 0.005),
        new T.Vector3(0, y + 0.085, z + 0.03),
        0.008,
        6,
      ),
      trim,
    );
  }
  const mirrors = input.mirrorAt.length === 2 ? mirrorFaces(input.mirrorAt, [0.1, 0.05]) : [];
  for (const m of mirrors) detail.add(m);
  detailParts.build(detail, false);
  headParts.build(head, true);
  input.lod.group.add(detail, head);
  return {
    detail,
    head,
    wheelDetail,
    steering: steering.children[0] as T.Group,
    mirrors,
    display,
    glass: [] as T.Mesh[],
    layout,
  } satisfies BuiltCabin;
}
/** Roll cage inside a roofed race car: main hoop behind the seats, A-pillar
 * and roof-rail bars, front header and harness bars, door bars and a hoop
 * diagonal. Returns the harness bar anchor behind the driver's shoulders. */
function addCage(parts: Parts, layout: CabinLayout, gh: Greenhouse, op: CabinOpening) {
  const steel = sharedMaterials.steel(),
    r = 0.021,
    inset = 0.05,
    hoop = layout.hoop!,
    floor = op.floor + 0.01;
  const cantrail = gh.cantrail(0);
  const section = (z: number) => insetProfile(sampleProfile(gh.control(z), gh.counts(0)), inset);
  // Main hoop: floor, up the inside of the pillar, over the roof, down again.
  const hs = section(hoop),
    edgeX = op.edge(hoop)[0] - inset;
  const left: [number, number, number][] = [
    [edgeX, floor, hoop],
    ...hs
      .filter((_, k) => k % 2 === 0 || k === hs.length - 1)
      .map(([x, y]) => [x, y, hoop] as [number, number, number]),
  ];
  const path = [
    ...left,
    ...left
      .slice(0, -1)
      .reverse()
      .map(([x, y, z]) => [-x, y, z] as [number, number, number]),
  ];
  parts.add(tubeGeometry(path, r, 48, 8), steel);
  // A-pillar bar to the roof rail and back along it to the hoop.
  const zA = layout.dash!.rear + 0.04,
    stations: number[] = [];
  for (let k = 0; k <= 6; k++)
    stations.push(gh.zWs - 0.06 - ((gh.zWs - 0.06 - (gh.zRF - 0.02)) * k) / 6);
  for (let k = 1; k <= 4; k++) stations.push(gh.zRF - 0.02 - ((gh.zRF - 0.02 - hoop) * k) / 4);
  for (const side of [-1, 1]) {
    const pts: [number, number, number][] = [[side * (op.edge(zA)[0] - inset), floor, zA]];
    for (const z of stations) {
      const [x, y] = section(z)[cantrail];
      pts.push([side * x, y, z]);
    }
    parts.add(tubeGeometry(pts, r, 40, 8), steel);
    // Door bars: an X between the hoop and the front of the door.
    const [fx, fTop] = op.edge(zA),
      [bx, bTop] = op.edge(hoop);
    const xf = side * (fx - inset),
      xb = side * (bx - inset);
    parts.add(
      rodGeometry(new T.Vector3(xb, floor + 0.08, hoop), new T.Vector3(xf, fTop - 0.06, zA), r, 8),
      steel,
    );
    parts.add(
      rodGeometry(new T.Vector3(xb, bTop - 0.05, hoop), new T.Vector3(xf, floor + 0.12, zA), r, 8),
      steel,
    );
  }
  // Front header and hoop diagonal.
  const [hx, hy] = section(gh.zRF - 0.02)[cantrail];
  parts.add(
    rodGeometry(new T.Vector3(-hx, hy, gh.zRF - 0.02), new T.Vector3(hx, hy, gh.zRF - 0.02), r, 8),
    steel,
  );
  const [tx, ty] = hs[cantrail];
  parts.add(
    rodGeometry(new T.Vector3(tx, ty, hoop), new T.Vector3(-edgeX, floor, hoop), r, 8),
    steel,
  );
  // Harness bar at shoulder height across the hoop.
  const s = layout.driverScale,
    by = layout.head[1] - 0.27 * s + 0.04;
  const bx = Math.min(edgeX, widthAt(hs, by));
  parts.add(rodGeometry(new T.Vector3(-bx, by, hoop), new T.Vector3(bx, by, hoop), r, 8), steel);
  return new T.Vector3(layout.seat[0], by + 0.02, hoop + 0.02);
}
/** Inner half width of an inset section at height y (its outermost x there). */
function widthAt(section: readonly Pt[], y: number) {
  let best = section[0][0];
  for (let k = 0; k < section.length - 1; k++) {
    const [x0, y0] = section[k],
      [x1, y1] = section[k + 1];
    if ((y - y0) * (y - y1) <= 0 && y0 !== y1) best = x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return best;
}
/** Single-seater cockpit (inside the tub's opening): cell walls, front and
 * rear bulkheads, the driver with legs, the formula wheel with its display,
 * the harness and the rear-view feed surfaces on the pods' mirrors. */
export function buildOpenWheelCabin(input: {
  layout: CabinLayout;
  def: VehicleDefinition;
  mats: CarMaterials;
  shell: Parts;
  lod: BuiltLod;
  opening: CabinOpening;
  openFace: boolean;
  mirrorAt: readonly (readonly [number, number, number])[];
  mirrorSize: readonly [number, number];
}) {
  const { layout, mats, shell, opening: op } = input;
  const detailParts = new Parts(),
    headParts = new Parts(),
    detail = new T.Group(),
    head = new T.Group(),
    wheelDetail: T.Object3D[] = [];
  detail.name = 'Cabin detail (followed / near car)';
  head.name = 'Driver head (hidden in own cockpit view)';
  const interior = sharedMaterials.interior(),
    carbon = sharedMaterials.carbonSatin();
  const xr = op.edge(op.rear)[0],
    xf = op.edge(op.front)[0];
  shell.add(
    slab(-Math.min(xr, xf), Math.min(xr, xf), op.floor - 0.03, op.floor, op.rear, op.front),
    interior,
  );
  for (const side of [-1, 1] as const)
    shell.add(wallStrip(op, side, op.rear - 0.01, op.front + 0.01, 10), carbon);
  shell.add(slab(-xr, xr, op.floor - 0.03, op.edge(op.rear)[1], op.rear - 0.03, op.rear), interior);
  shell.add(
    slab(-xf, xf, op.floor + 0.12, op.edge(op.front)[1], op.front, op.front + 0.03),
    carbon,
  );
  const [x, y, z] = layout.seat;
  addDriver(
    shell,
    mats,
    x,
    y,
    z,
    layout.driverScale,
    layout.wheel.centre[2] - 0.02,
    input.openFace,
    {
      head: headParts,
      wheel: false,
      legs: { floor: op.floor, pedals: op.front + 0.55 },
      handDrop: layout.wheel.handDrop,
    },
  );
  const w = layout.wheel;
  shell.add(
    rodGeometry(
      new T.Vector3(...w.centre),
      new T.Vector3(0, w.centre[1] - 0.04, op.front + 0.03),
      0.02,
      8,
    ),
    sharedMaterials.trim(),
  );
  const display = new CabinDisplay('wheel', input.def.spec);
  const steering = buildSteering(layout, wheelDetail, display);
  input.lod.group.add(steering);
  addBelts(
    detailParts,
    layout,
    x,
    new T.Vector3(x, layout.head[1] - 0.27 * layout.driverScale + 0.02, op.rear - 0.02),
  );
  const mirrors = input.mirrorAt.length === 2 ? mirrorFaces(input.mirrorAt, input.mirrorSize) : [];
  for (const m of mirrors) detail.add(m);
  detailParts.build(detail, false);
  headParts.build(head, true);
  input.lod.group.add(detail, head);
  return {
    detail,
    head,
    wheelDetail,
    steering: steering.children[0] as T.Group,
    mirrors,
    display,
    glass: [] as T.Mesh[],
    layout,
  } satisfies BuiltCabin;
}
/** Karts and buggies: the turning wheel (and a display), the helmet group and,
 * on the buggy, a dash panel and harnesses for both seats. The driver itself
 * is added by the body builder (`shell`). */
export function buildFrameCabin(input: {
  layout: CabinLayout;
  def: VehicleDefinition;
  shell: Parts;
  lod: BuiltLod;
  headParts: Parts;
  dash?: { z: number; y: number; floor: number };
}) {
  const { layout, lod } = input;
  const detail = new T.Group(),
    head = new T.Group(),
    detailParts = new Parts(),
    wheelDetail: T.Object3D[] = [];
  detail.name = 'Cabin detail (followed / near car)';
  head.name = 'Driver head (hidden in own cockpit view)';
  const kind: DisplayKind = layout.family === 'kart' ? 'wheel' : 'race';
  const display = new CabinDisplay(kind, input.def.spec);
  const steering = buildSteering(layout, wheelDetail, display);
  lod.group.add(steering);
  const w = layout.wheel;
  if (input.dash) {
    const d = input.dash;
    input.shell.add(
      roundedBox(0.95, 0.2, 0.12, 0.02, 2),
      sharedMaterials.carbonSatin(),
      placed(0, d.y, d.z, 0.3),
    );
    input.shell.add(
      rodGeometry(
        new T.Vector3(...w.centre),
        new T.Vector3(w.centre[0], d.y - 0.02, d.z),
        0.022,
        8,
      ),
      sharedMaterials.trim(),
    );
    addInstruments(detailParts, layout, display, detail, d.z - 0.07, d.y + 0.1);
    for (const sx of [layout.seat[0], -layout.seat[0]]) {
      const l = { ...layout, seat: [sx, layout.seat[1], layout.seat[2]] as const } as CabinLayout;
      addBelts(detailParts, l, sx, new T.Vector3(sx, layout.head[1] - 0.2, layout.seat[2] - 0.3));
    }
  }
  detailParts.build(detail, false);
  input.headParts.build(head, true);
  lod.group.add(detail, head);
  return {
    detail,
    head,
    wheelDetail,
    steering: steering.children[0] as T.Group,
    mirrors: [] as T.Mesh[],
    display,
    glass: [] as T.Mesh[],
    layout,
  } satisfies BuiltCabin;
}
