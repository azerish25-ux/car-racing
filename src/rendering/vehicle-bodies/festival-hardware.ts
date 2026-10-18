import * as T from 'three';
import type { Greenhouse } from './closed-body.ts';
import type { BuiltLod, CarMaterials } from './common.ts';
import { endBand, festivalRearBumper } from './festival-detail.ts';
import type { FestivalBodyModel } from './festival-form.ts';
import { aerofoil, roundedBox, tubeGeometry } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Festival production-form hardware (open world only; FestivalBodyModel.
 * addFormDetail): the small parts that read in the close references —
 * diffuser strakes in the black valance (refs 013, 018, 035, 099), deep
 * exhaust tips with a sooty bore (018, 035, 053, 069, 099), hooked LED tail
 * bars (018, 035), a third brake light (018, 035, 074), window seals on the
 * real glass base, parked wipers (019, 074, 090), a fuel flap, a red tow hook
 * (009, 074) and carbon dive planes (001, 045, 066) on the competition
 * classes. Static parts merge into the LOD's material draws (one new draw:
 * the soot of the exhaust bores). */
let soot: T.MeshStandardMaterial | null = null;
/** Sooted exhaust bore and lamp-cavity black (rough, nearly no reflection). */
export function sootMaterial() {
  if (!soot)
    soot = new T.MeshStandardMaterial({
      name: 'Festival exhaust soot',
      color: 0x050505,
      roughness: 0.82,
      metalness: 0.1,
    });
  return soot;
}

/** Tail lamp centre height (car frame), as festival-detail places it. */
export function tailLampY(model: FestivalBodyModel) {
  const { f, s } = model;
  return Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06);
}

/** Vertical strakes across the black rear valance: the diffuser fins seen
 * from behind, deepest at the centre. */
function addDiffuserStrakes(parts: Parts, model: FestivalBodyModel, detail: Detail) {
  const s = model.s;
  if (s.diffuser <= 0 || s.style === 'truck') return;
  // Low fins under the plate (it sits on the bumper above the valance).
  const lo = model.endFloor(true) + 0.006,
    top = lo + Math.min((model.valanceHeight() ?? 0.12) - 0.03, 0.085),
    n = s.style === 'supercar' ? 7 : 5,
    span = model.halfWidth(model.zRear) * (s.style === 'supercar' ? 0.6 : 0.5),
    carbon = sharedMaterials.carbonSatin();
  if (top - lo < 0.05) return;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1) - 0.5,
      x = u * 2 * span,
      h = (top - lo) * (1 - 0.3 * Math.abs(u) * 2),
      len = 0.13 - 0.05 * Math.abs(u) * 2;
    parts.add(
      roundedBox(0.008, h, len, 0.003, detail === 0 ? 1 : 1),
      carbon,
      placed(x, lo + h / 2, model.zRear - len * 0.25, -0.12),
    );
  }
  // The diffuser's floor: a dark ramp between the strakes.
  parts.add(
    roundedBox(span * 2 + 0.04, 0.008, 0.16, 0.003, 1),
    sharedMaterials.plastic(),
    placed(0, lo + 0.012, model.zRear + 0.02, -0.16),
  );
}

/** Exhaust tip: a polished shell with a rolled lip, then a sooty bore cup
 * whose inner faces are the visible ones. Tip axis along -Z (rearward). */
function exhaustTip(radius: number, length: number, segments: number) {
  const shell = new T.LatheGeometry(
    [
      new T.Vector2(radius * 0.92, 0),
      new T.Vector2(radius * 0.95, length * 0.78),
      new T.Vector2(radius, length * 0.96),
      new T.Vector2(radius * 0.99, length),
      new T.Vector2(radius * 0.87, length * 1.002),
    ],
    segments,
  ).rotateX(-Math.PI / 2);
  const bore = new T.LatheGeometry(
    [
      new T.Vector2(radius * 0.875, length),
      new T.Vector2(radius * 0.84, length * 0.35),
      new T.Vector2(radius * 0.4, length * 0.3),
      new T.Vector2(0.0005, length * 0.29),
    ],
    segments,
  ).rotateX(-Math.PI / 2);
  return { shell, bore };
}
function addExhaustTips(parts: Parts, model: FestivalBodyModel, detail: Detail) {
  const s = model.s,
    kind = model.form.exhaust;
  if (!kind || !s.extras.includes('exhaust-rear')) return;
  const hw = model.halfWidth(model.zRear),
    y = model.endFloor(true) + Math.min(0.13, (model.valanceHeight() ?? 0.12) * 0.55 + 0.02),
    seg = detail === 0 ? 24 : 12;
  const sites: [number, number][] =
    kind === 'quad'
      ? [-1, 1].flatMap((side) => [
          [side * (hw * 0.36 - 0.052), 0.04] as [number, number],
          [side * (hw * 0.36 + 0.052), 0.04] as [number, number],
        ])
      : kind === 'centre'
        ? [
            [-0.075, 0.05],
            [0.075, 0.05],
          ]
        : [
            [-hw * 0.42, 0.047],
            [hw * 0.42, 0.047],
          ];
  for (const [x, r] of sites) {
    const { shell, bore } = exhaustTip(r, 0.12, seg);
    // The tip stands about 4 cm proud of the valance face.
    const at = placed(x, y, model.zRear + 0.05);
    parts.add(shell, sharedMaterials.exhaust(), at);
    parts.add(bore, sootMaterial(), at);
  }
}

/** Hooks at each end of a full-width LED tail bar (refs 018, 035): the bar
 * turns down at the corner and returns inboard under the lamp band. */
function addTailHooks(parts: Parts, model: FestivalBodyModel, mats: CarMaterials, detail: Detail) {
  if (!model.form.tailHook || model.s.lamps.rear !== 'strip') return;
  const y = tailLampY(model),
    steps = detail === 0 ? 8 : 3;
  // The dark lamp band behind the hook (festival-detail draws the bar).
  parts.add(
    endBand(model, true, y - 0.07, y - 0.035, 0.12, 0.0035, steps, { inner: 0.15 }),
    sootMaterial(),
  );
  parts.add(
    endBand(model, true, y - 0.058, y - 0.004, 0.1, 0.0062, steps, { inner: 0.012 }),
    mats.tail,
  );
  parts.add(
    endBand(model, true, y - 0.058, y - 0.049, 0.02, 0.0062, steps, { inner: 0.12 }),
    mats.tail,
  );
}

/** Dark mesh panels with louvres in the rear bumper's corners, above the
 * valance (refs 018, 035, 099). */
function addTailCornerPanels(parts: Parts, model: FestivalBodyModel, detail: Detail) {
  const s = model.s,
    bumper = festivalRearBumper(model);
  if ((s.style !== 'supercar' && s.style !== 'gt') || !bumper) return;
  const lo = bumper.lo + (model.valanceHeight() ?? 0.12) + 0.012,
    hi = bumper.hi - 0.014;
  if (hi - lo < 0.06) return;
  const steps = detail === 0 ? 8 : 3,
    inner = model.halfWidth(model.zRear) * 0.32,
    out = bumper.depth + 0.0025;
  parts.add(endBand(model, true, lo, hi, 0.1, out, steps, { inner }), sharedMaterials.grille());
  const n = Math.max(2, Math.floor((hi - lo) / 0.03));
  for (let k = 1; k < n; k++) {
    const y = lo + ((hi - lo) * k) / n;
    parts.add(
      endBand(model, true, y - 0.003, y + 0.003, 0.1, out + 0.006, steps, { inner }),
      sharedMaterials.trim(),
    );
  }
}

/** Third brake light: on the rear deck lip of a fastback (refs 018, 035), at
 * the top of the rear glass of a saloon or hatch. */
function addThirdBrakeLight(
  parts: Parts,
  model: FestivalBodyModel,
  mats: CarMaterials,
  gh: Greenhouse | null,
) {
  const s = model.s;
  if (s.style === 'truck') return;
  const fastback = s.style === 'supercar' || s.style === 'gt' || !gh;
  if (fastback) {
    const z = model.zRear + 0.09,
      y = model.surfaceY(z, 0),
      dz = (model.surfaceY(z + 0.02, 0) - model.surfaceY(z - 0.02, 0)) / 0.04;
    parts.add(
      roundedBox(0.3, 0.016, 0.04, 0.006, 1),
      sootMaterial(),
      placed(0, y, z, -Math.atan(dz)),
    );
    parts.add(
      roundedBox(0.26, 0.008, 0.012, 0.003, 1),
      mats.tail,
      placed(0, y + 0.006, z - 0.012, -Math.atan(dz)),
    );
    return;
  }
  const z = gh.zRR - 0.03,
    section = gh.control(z),
    y = section[section.length - 1][1];
  parts.add(roundedBox(0.3, 0.02, 0.05, 0.007, 1), sootMaterial(), placed(0, y - 0.006, z));
  parts.add(roundedBox(0.26, 0.008, 0.012, 0.003, 1), mats.tail, placed(0, y - 0.002, z - 0.026));
}

/** Rubber seal along the side glass's real base (the festival greenhouse
 * stands on the sill crease, not the catalogue's 80 % line). */
function addWindowSeals(parts: Parts, model: FestivalBodyModel, gh: Greenhouse) {
  for (const side of [-1, 1]) {
    const seal: [number, number, number][] = [];
    for (let k = 0; k <= 20; k++) {
      const z = gh.zRW + 0.04 + ((gh.zWs - 0.05 - (gh.zRW + 0.04)) * k) / 20;
      seal.push([side * (model.sillX(z) + 0.002), gh.base(z) + 0.012, z]);
    }
    parts.add(tubeGeometry(seal, 0.0045, 40, 5), sharedMaterials.trim());
  }
}

/** Parked wipers at the windscreen foot: arm and blade lying on the glass. */
function addWipers(parts: Parts, model: FestivalBodyModel, gh: Greenhouse) {
  const z0 = gh.zWs - 0.07,
    trim = sharedMaterials.trim();
  const glassY = (x: number, z: number) => {
    const c = gh.control(z);
    let y = c[c.length - 1][1];
    for (let i = 0; i < c.length - 1; i++) {
      const [x0, y0] = c[i],
        [x1, y1] = c[i + 1];
      if ((x - x0) * (x - x1) <= 0 && x0 !== x1) y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return y;
  };
  // Two blades parked toward the driver's side, the pivots near the cowl.
  for (const [pivot, reach] of [
    [-0.42, 0.62],
    [0.12, 0.55],
  ]) {
    const points: [number, number, number][] = [];
    for (let k = 0; k <= 6; k++) {
      const x = pivot + (reach * k) / 6,
        z = z0 - 0.025 * Math.sin((k / 6) * Math.PI) - 0.006 * k;
      points.push([x, glassY(Math.abs(x), z) + 0.009, z]);
    }
    parts.add(tubeGeometry(points, 0.0045, 18, 4), trim);
    // The blade: a flat rubber strip just ahead of the arm.
    const blade = points.map(([x, y, z]) => [x, y - 0.003, z + 0.014] as [number, number, number]);
    parts.add(tubeGeometry(blade.slice(1), 0.0032, 16, 4), trim);
  }
}

/** A round fuel flap on the right rear quarter of a car without a scoop. */
function addFuelFlap(parts: Parts, model: FestivalBodyModel, paint: T.Material) {
  if (model.recesses.some((r) => r.kind === 'scoop') || model.s.style === 'truck') return;
  const f = model.f,
    z = f.rearAxle + f.radius + 0.24,
    section = model.control(z),
    y = section[6][1] - 0.075,
    x = model.sideX(z, y);
  if (x < 0.3) return;
  const at = placed(-(x + 0.0012), y, z, 0, 0, Math.PI / 2);
  parts.add(new T.CylinderGeometry(0.055, 0.055, 0.003, 24), sharedMaterials.trim(), at);
  parts.add(new T.CylinderGeometry(0.052, 0.052, 0.004, 24).translate(0, 0.0006, 0), paint, at);
}

/** Red D-ring tow hook on the front bumper's right side (refs 009, 074). */
function addTowHook(parts: Parts, model: FestivalBodyModel) {
  if (!model.form.towHook) return;
  const x = -model.halfWidth(model.zFront) * 0.42,
    y = model.endFloor(false) + 0.13,
    z = model.zFront + 0.012,
    red = sharedMaterials.caliper(0xc8161c);
  parts.add(roundedBox(0.03, 0.03, 0.03, 0.008, 1), sharedMaterials.trim(), placed(x, y, z));
  parts.add(new T.TorusGeometry(0.026, 0.0065, 8, 18), red, placed(x, y - 0.014, z + 0.03, -1.2));
}

/** Carbon dive planes on the front bumper corners (competition classes). */
function addCanards(model: FestivalBodyModel, detail: Detail, lod: BuiltLod) {
  if (!model.form.canards || detail > 1) return;
  const parts = new Parts(),
    lo = model.endFloor(false);
  for (const side of [-1, 1])
    for (const [dz, dy, span] of [
      [0.1, 0.1, 0.12],
      [0.2, 0.19, 0.1],
    ] as const) {
      const z = model.zFront - dz,
        y = lo + dy,
        x = model.sideX(z, y);
      if (x < 0.3) continue;
      const plane = aerofoil(0.15, 0.07, 0.015, span, detail === 0 ? 8 : 4);
      parts.add(
        plane,
        sharedMaterials.carbon(),
        placed(side * (x + span / 2 - 0.025), y, z + 0.06, 0.12, side * 0.18, side * 0.12),
      );
    }
  const group = new T.Group();
  group.name = 'Festival dive planes (detachable)';
  parts.build(group, detail === 0);
  lod.group.add(group);
  lod.front.push(group);
}

/** The tangent frame of the upper surface at (x, z): local y along the
 * normal, local z forward. */
function surfaceFrame(model: FestivalBodyModel, x: number, z: number) {
  const ax = Math.abs(x),
    side = Math.sign(x) || 1;
  const dz = (model.surfaceY(z + 0.015, ax) - model.surfaceY(z - 0.015, ax)) / 0.03;
  const dx = (model.surfaceY(z, ax + 0.015) - model.surfaceY(z, Math.max(0, ax - 0.015))) / 0.03;
  return placed(x, model.surfaceY(z, ax), z, -Math.atan(dz), 0, side * Math.atan(dx));
}
/** A trapezoid hood vent (refs 019, 037, 092): a painted lip standing on the
 * hood, dark inner walls and a honeycomb mesh just above the surface, with a
 * blade across it. Widest at the front (`front` m), `rear` m at the back. */
function hoodVent(
  parts: Parts,
  mats: CarMaterials,
  at: T.Matrix4,
  front: number,
  rear: number,
  length: number,
) {
  // Shape coordinates: x across, shape y = -z (rotateX(-PI/2) lays it flat).
  const outline = [
    new T.Vector2(-front / 2, -length / 2),
    new T.Vector2(-rear / 2, length / 2),
    new T.Vector2(rear / 2, length / 2),
    new T.Vector2(front / 2, -length / 2),
  ];
  const scaled = (k: number, pad: number) =>
    outline.map((p) => new T.Vector2(p.x * k + Math.sign(p.x) * pad, p.y * k));
  const ring = (outer: T.Vector2[], inner: T.Vector2[]) => {
    const shape = new T.Shape(outer);
    shape.holes.push(new T.Path(inner));
    return shape;
  };
  const local = (g: T.BufferGeometry, y: number) =>
    g
      .rotateX(-Math.PI / 2)
      .applyMatrix4(new T.Matrix4().makeTranslation(0, y, 0))
      .applyMatrix4(at);
  // The painted lip stands 8 mm proud; inside it a dark sleeve, then the mesh.
  parts.add(
    local(
      new T.ExtrudeGeometry(ring(scaled(1.1, 0.008), outline), {
        depth: 0.011,
        bevelEnabled: false,
      }),
      -0.003,
    ),
    mats.paint,
  );
  parts.add(
    local(
      new T.ExtrudeGeometry(ring(outline, scaled(0.94, 0)), { depth: 0.007, bevelEnabled: false }),
      -0.002,
    ),
    sootMaterial(),
  );
  parts.add(local(new T.ShapeGeometry(new T.Shape(outline)), 0.0015), sharedMaterials.grille());
  parts.add(
    roundedBox((front + rear) / 2, 0.003, 0.01, 0.0012, 1),
    sharedMaterials.trim(),
    at.clone().multiply(placed(0, 0.0035, 0, 0.5)),
  );
}
function addHoodVents(parts: Parts, model: FestivalBodyModel, mats: CarMaterials) {
  const { f, s } = model;
  if (s.bonnetVents)
    for (const side of [-1, 1]) {
      const z = (f.frontAxle + f.z(s.cabin[0])) / 2 + 0.05,
        x = side * model.halfWidth(z) * 0.43;
      hoodVent(parts, mats, surfaceFrame(model, x, z), 0.25, 0.16, 0.26);
    }
  if (model.form.centreVent) {
    const z = f.frontAxle + 0.12;
    if (z < model.zFront - 0.25) hoodVent(parts, mats, surfaceFrame(model, 0, z), 0.46, 0.32, 0.17);
  }
}

/** All festival hardware for one LOD (near and mid). */
export function addFestivalHardware(
  parts: Parts,
  model: FestivalBodyModel,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
  gh: Greenhouse | null,
) {
  if (detail > 1) return;
  addHoodVents(parts, model, mats);
  addDiffuserStrakes(parts, model, detail);
  addExhaustTips(parts, model, detail);
  addTailHooks(parts, model, mats, detail);
  addTailCornerPanels(parts, model, detail);
  addThirdBrakeLight(parts, model, mats, gh);
  addTowHook(parts, model);
  addCanards(model, detail, lod);
  if (detail > 0) return;
  addFuelFlap(parts, model, mats.paint);
  if (gh) {
    addWindowSeals(parts, model, gh);
    addWipers(parts, model, gh);
  }
}
