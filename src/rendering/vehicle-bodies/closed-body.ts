import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { ClosedSheet, WingSheet } from './body-sheet.ts';
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
import { sharedMaterials, type PanelGap } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';
import { addDriver, type CarMaterials, type BuiltLod } from './common.ts';

/** Closed-wheel bodies (GT, prototype, saloon, roadster, rally, truck, road
 * supercar) generated from a ClosedSheet. The lower body is one loft of
 * mirrored sections whose profile carries a wheel tub and arch at every
 * section that crosses a wheel, so arches, lips and liners are exact; the
 * greenhouse is a second, open loft standing on the body with glass, pillars
 * and window frames assigned per face; lamps, intakes, mirrors, numbers,
 * aero furniture and extras are placed against the evaluated surface. */
const SEGMENTS: Record<Detail, readonly number[]> = {
  0: [3, 3, 3, 2, 5, 4, 4, 4],
  1: [2, 2, 2, 1, 3, 3, 2, 2],
  2: [1, 1, 1, 1, 2, 1, 1, 1],
};
const SPACING: Record<Detail, number> = { 0: 0.03, 1: 0.075, 2: 0.2 };
/** Body material slots (loft groups). */
const M = { paint: 0, liner: 1, floor: 2, accent: 3, interior: 4 } as const;
export class ClosedBodyModel {
  readonly zFront: number;
  readonly zRear: number;
  readonly halfBase: number;
  private readonly top: Track;
  private readonly floor: Track;
  private readonly belt: Track;
  private readonly taper: Track;
  private readonly arches: { z: number; hub: number; r: number; tub: number; flare: number }[];
  constructor(
    readonly f: BodyFrame,
    readonly s: ClosedSheet,
    tyreHalf: readonly [number, number],
  ) {
    const z = f.z,
      y = f.y,
      [ws, , , rw] = s.cabin;
    this.zFront = f.frontAxle + s.overhang[0];
    this.zRear = f.rearAxle - s.overhang[1];
    this.halfBase = s.width / 2 - Math.max(s.flare[0], s.flare[1]);
    const zF = this.zFront,
      zR = this.zRear;
    const open = s.style === 'roadster' || !!s.open;
    const cockpit = open ? s.belt + 0.06 : s.cowl + (s.deck - s.cowl) * 0.3;
    this.top = new Track(
      [
        [zR, y(s.tail - 0.07)],
        [zR + 0.05, y(s.tail - 0.018)],
        [zR + 0.16, y(s.tail)],
        [Math.min(z(rw), zR + 0.3), y(s.deck)],
        [z(rw) + 0.02, y(open ? cockpit : s.deck)],
        [(z(rw) + z(ws)) / 2, y(cockpit)],
        [z(ws) - 0.02, y(open ? cockpit : s.cowl)],
        [Math.max(z(ws) + 0.05, (z(ws) + f.frontAxle) / 2), y((s.cowl + s.bonnet) / 2)],
        [f.frontAxle, y(s.bonnet)],
        [zF - 0.32, y(s.nose + (s.bonnet - s.nose) * 0.62)],
        [zF - 0.08, y(s.nose + 0.02)],
        [zF - 0.02, y(s.nose - 0.02)],
        [zF, y(s.nose - 0.06)],
      ].filter((k, i, all) => i === 0 || k[0] > all[i - 1][0] + 1e-3) as [number, number][],
    );
    this.floor = new Track([
      [zR, y(s.floor + 0.12 + s.diffuser * 0.3)],
      [f.rearAxle - 0.15, y(s.floor + 0.02)],
      [f.rearAxle + 0.25, y(s.floor)],
      [f.frontAxle - 0.2, y(s.floor)],
      [zF - 0.18, y(s.floor + 0.02)],
      [zF, y(s.floor + 0.08)],
    ]);
    this.belt = new Track([
      [zR, y(Math.min(s.tail - 0.12, s.belt + 0.06))],
      [f.rearAxle, y(s.belt + 0.02)],
      [z(0.5), y(s.belt)],
      [f.frontAxle, y(s.belt - 0.02)],
      [zF, y(Math.min(s.nose - 0.06, s.belt - 0.08))],
    ]);
    this.taper = new Track([
      [zR, 0.8],
      [zR + 0.05, 0.9],
      [zR + 0.3, 0.97],
      [f.rearAxle, 1],
      [f.frontAxle, 1],
      [zF - 0.4, 0.95],
      [zF - 0.1, 0.84],
      [zF - 0.03, 0.78],
      [zF, 0.7],
    ]);
    const clearance = s.style === 'truck' ? 0.1 : 0.045;
    this.arches = [
      {
        z: f.frontAxle,
        hub: f.hubFront,
        r: f.radius + clearance,
        tub: f.trackFront / 2 - tyreHalf[0] - 0.035,
        flare: s.flare[0],
      },
      {
        z: f.rearAxle,
        hub: f.hubRear,
        r: f.radius + clearance,
        tub: f.trackRear / 2 - tyreHalf[1] - 0.035,
        flare: s.flare[1],
      },
    ];
  }
  /** Half width at the beltline, with flares bulging over the wheels. */
  halfWidth(z: number) {
    let hw = this.halfBase * this.taper.at(z);
    for (const a of this.arches) {
      const u = (z - a.z) / (a.r * 1.55);
      if (Math.abs(u) < 1) hw += a.flare * Math.cos((u * Math.PI) / 2) ** 2;
    }
    return hw;
  }
  topY(z: number) {
    return this.top.at(z);
  }
  /** Arch at z: the ceiling height and tub wall, or null outside the wheels. */
  arch(z: number) {
    for (const a of this.arches) {
      const dz = z - a.z;
      if (Math.abs(dz) < a.r) return { y: a.hub + Math.sqrt(a.r * a.r - dz * dz), tub: a.tub };
    }
    return null;
  }
  /** Fender crown above the centreline over each axle (prototype fenders,
   * supercar haunches); the bonnet or deck between them stays low. */
  fenderRise(z: number) {
    const rise: Record<ClosedSheet['style'], readonly [number, number]> = {
      prototype: [0.15, 0.08],
      supercar: [0.07, 0.09],
      gt: [0.05, 0.07],
      roadster: [0.07, 0.05],
      truck: [0.03, 0.03],
      rally: [0.02, 0.02],
      saloon: [0.02, 0.02],
    };
    const [front, rear] = rise[this.s.style];
    let out = 0;
    this.arches.forEach((a, i) => {
      const u = (z - a.z) / (a.r * 1.7);
      if (Math.abs(u) < 1) out += (i === 0 ? front : rear) * Math.cos((u * Math.PI) / 2) ** 2;
    });
    return out;
  }
  /** Control points of the half section at z (fixed topology): floor, tub
   * (wheel well), arch lip, rocker, near-vertical side to a crisp shoulder,
   * fender crown, deck and centreline. */
  control(z: number): Pt[] {
    const floor = this.floor.at(z),
      top = this.top.at(z),
      hw = this.halfWidth(z),
      arch = this.arch(z),
      fender = Math.min(this.fenderRise(z), Math.max(0, (top - floor) * 0.25));
    let belt = clamp(this.belt.at(z), floor + 0.1, top - 0.05);
    const floorW = Math.min(hw * 0.86, hw - 0.08);
    const rockerY = floor + Math.min(0.08, (belt - floor) * 0.4);
    const deckW = hw * (this.s.style === 'truck' ? 0.92 : 0.8);
    const upper = (b: number): Pt[] => {
      const shoulder = Math.min(top + fender - 0.03, b + (top - b) * 0.68 + fender * 0.6);
      return [
        [hw, b],
        [hw * 0.985, Math.max(b + 0.01, shoulder)],
        [deckW, top - 0.012 + fender],
        [0, top],
      ];
    };
    if (arch) {
      const ya = Math.min(arch.y, top - 0.06);
      belt = Math.max(belt, ya + 0.05);
      const tub = Math.min(arch.tub, floorW);
      return [
        [0, floor],
        [tub, floor],
        [tub, ya],
        [hw - 0.012, ya],
        [hw, ya + 0.025],
        ...upper(belt),
      ];
    }
    return [
      [0, floor],
      [floorW * 0.9, floor],
      [floorW * 0.95, floor + 0.0002],
      [floorW, floor + 0.0004],
      [hw * 0.97, rockerY],
      ...upper(belt),
    ];
  }
  /** Sampled ring at z for a detail level. */
  ring(z: number, detail: Detail): Ring {
    return { z, half: sampleProfile(this.control(z), SEGMENTS[detail]) };
  }
  /** Stations along the car: uniform, plus both sides of every arch edge. */
  stations(detail: Detail) {
    const out: number[] = [];
    const n = Math.max(6, Math.ceil((this.zFront - this.zRear) / SPACING[detail]));
    for (let i = 0; i <= n; i++) out.push(this.zRear + ((this.zFront - this.zRear) * i) / n);
    for (const a of this.arches)
      for (const e of [a.z - a.r, a.z + a.r]) out.push(e - 0.0015, e + 0.0015);
    return out.sort((p, q) => p - q).filter((z, i, all) => i === 0 || z - all[i - 1] > 0.0008);
  }
  /** Outer side x of the body at (z, height y) — for placing side furniture. */
  sideX(z: number, y: number) {
    const half = sampleProfile(this.control(z), SEGMENTS[0]);
    let best = 0;
    for (let i = 0; i < half.length - 1; i++) {
      const [x0, y0] = half[i],
        [x1, y1] = half[i + 1];
      if ((y - y0) * (y - y1) <= 0 && y0 !== y1)
        best = Math.max(best, x0 + ((x1 - x0) * (y - y0)) / (y1 - y0));
    }
    return best;
  }
  /** Upper surface y at (z, |x|). */
  surfaceY(z: number, x: number) {
    const half = sampleProfile(this.control(z), SEGMENTS[0]);
    let best = -Infinity;
    for (let i = 4; i < half.length - 1; i++) {
      const [x0, y0] = half[i],
        [x1, y1] = half[i + 1];
      if ((x - x0) * (x - x1) <= 0 && x0 !== x1)
        best = Math.max(best, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
    return Number.isFinite(best) ? best : this.top.at(z);
  }
  /** Material slot of a lower-body face: liners in the wheel wells, floor
   * underneath, interior in an open cockpit, accent stripes. */
  slot(zMid: number, j: number, detail: Detail) {
    const counts = SEGMENTS[detail];
    let seg = 0,
      acc = 0;
    while (seg < counts.length - 1 && j >= acc + counts[seg]) acc += counts[seg++];
    if (seg === 0) return M.floor;
    if ((seg === 1 || seg === 2) && this.arch(zMid)) return M.liner;
    if (seg <= 2) return M.floor;
    const [ws, , , rw] = this.s.cabin;
    if (
      (this.s.style === 'roadster' || this.s.open) &&
      seg === 7 &&
      zMid < this.f.z(ws) &&
      zMid > this.f.z(rw)
    )
      return M.interior;
    if (this.s.stripe === 'centre' && seg === 7 && j >= acc + counts[7] - 1) return M.accent;
    if (this.s.stripe === 'side' && seg === 4 && j === acc + counts[4] - 2) return M.accent;
    return M.paint;
  }
  /** Panel gaps: doors, bonnet and boot/engine cover shut lines. */
  gaps(): PanelGap[] {
    const f = this.f,
      s = this.s,
      [ws, rf, rr] = s.cabin,
      hw = this.halfBase,
      big = 3;
    const door = (zc: number): PanelGap => ({
      n: [0, 0, 1],
      d: zc,
      min: [hw * 0.55, f.y(s.floor + 0.09), zc - 0.02],
      max: [big, f.y(s.belt + 0.3), zc + 0.02],
    });
    const out: PanelGap[] = [];
    if (s.style !== 'truck' && s.style !== 'roadster') {
      out.push(door(f.z(ws) - 0.04), door(f.z((rf + rr) / 2 + 0.12)));
      if (s.style === 'saloon' || s.style === 'rally') out.push(door(f.z(rr) + 0.02));
    } else out.push(door(f.z(ws) - 0.06), door(f.z(rr) + 0.04));
    const cowl = f.z(ws) + 0.1;
    out.push({
      n: [0, 0, 1],
      d: cowl,
      min: [0, f.y(s.belt), cowl - 0.02],
      max: [hw * 0.8, big, cowl + 0.02],
    });
    out.push({
      n: [1, 0, 0],
      d: hw * 0.74,
      min: [hw * 0.72, f.y(s.belt + 0.02), this.zFront - 0.42],
      max: [hw * 0.76, big, cowl],
    });
    const lid = f.z(s.cabin[3]) - 0.1;
    out.push({
      n: [0, 0, 1],
      d: lid,
      min: [0, f.y(s.belt), lid - 0.02],
      max: [hw * 0.8, big, lid + 0.02],
    });
    return out;
  }
}
/** Greenhouse (glass, pillars, roof) standing on the body. */
function greenhouse(model: ClosedBodyModel, detail: Detail) {
  const { f, s } = model;
  const [ws, rf, rr, rw] = s.cabin;
  const zWs = f.z(ws),
    zRF = f.z(rf),
    zRR = f.z(rr),
    zRW = f.z(rw);
  const roofY = f.y(s.roof);
  const base = (z: number) => model.topY(z) - 0.012;
  const roof = new Track([
    [zRW, base(zRW) + 0.004],
    [zRW + (zRR - zRW) * 0.45, base(zRW) + (roofY - base(zRW)) * 0.62],
    [zRR, roofY - 0.012],
    [(zRR + zRF) / 2, roofY + 0.008],
    [zRF, roofY - 0.008],
    [zWs - (zWs - zRF) * 0.35, base(zWs) + (roofY - base(zWs)) * 0.55],
    [zWs, base(zWs) + 0.004],
  ]);
  const roofHalf = (z: number) =>
    (model.halfBase * s.roofWidth * model.halfWidth(z)) / model.halfBase;
  const counts = detail === 0 ? [4, 4, 3, 3] : detail === 1 ? [2, 2, 2, 2] : [1, 1, 1, 1];
  const n = Math.max(
    6,
    Math.ceil((zWs - zRW) / (detail === 0 ? 0.035 : detail === 1 ? 0.08 : 0.2)),
  );
  const rings: Ring[] = [];
  for (let i = 0; i <= n; i++) {
    const z = zRW + ((zWs - zRW) * i) / n,
      b = base(z),
      top = Math.max(b + 0.004, roof.at(z)),
      sill = model.halfWidth(z) * 0.8 - 0.01,
      hr = Math.min(sill - 0.02, roofHalf(z)),
      h = top - b,
      crown = Math.min(0.03, h * 0.1);
    rings.push({
      z,
      half: sampleProfile(
        [
          [sill, b],
          [sill - (sill - hr) * 0.4, b + h * 0.45],
          [hr + 0.02, top - Math.min(0.035, h * 0.15)],
          [hr * 0.55, top + crown * 0.7],
          [0, top + crown],
        ],
        counts,
      ),
    });
  }
  const pillarB = (zRF + zRR) / 2 - 0.08;
  const sideEnd = counts[0] + counts[1];
  const geometry = loftRings(rings, {
    closed: false,
    material: (zMid, j) => {
      // 0 paint, 1 glass, 2 trim.
      const upper = j >= sideEnd;
      if (zMid > zRF - 0.01) {
        if (zMid > zWs - 0.035) return 2;
        if (j === sideEnd - 1 || j === sideEnd) return 0; // A-pillar
        return 1;
      }
      if (zMid < zRR + 0.01) {
        if (s.style === 'supercar' || s.style === 'prototype' || s.style === 'gt')
          return upper ? 1 : 0; // fastback: sail panels, small rear screen
        if (zMid < zRW + 0.035) return 2;
        if (j === sideEnd - 1 || j === sideEnd) return 0; // C-pillar
        return upper ? 1 : 1;
      }
      if (upper) return 0; // roof
      if (Math.abs(zMid - pillarB) < 0.045) return 0; // B-pillar
      if (j === 0 || j === sideEnd - 1) return 2; // window frame
      return 1;
    },
  });
  return geometry;
}
function wing(
  parts: Parts,
  model: ClosedBodyModel,
  w: WingSheet,
  mats: CarMaterials,
  detail: Detail,
) {
  const { f, s } = model;
  const carbon = sharedMaterials.carbon();
  const span = s.width * w.span,
    z = f.z(w.at),
    y = f.y(w.height);
  const group = new Parts();
  if (w.kind === 'ducktail' || w.kind === 'lip') {
    const lip = aerofoil(w.chord, 0.05, -0.04, span, detail === 0 ? 12 : 6);
    lip.rotateX(-0.25);
    parts.add(lip, mats.paint, placed(0, y, z));
    return;
  }
  const steps = detail === 0 ? 14 : detail === 1 ? 8 : 4;
  group.add(aerofoil(w.chord, 0.12, 0.05, span, steps), carbon, placed(0, y, z, 0.1));
  if (w.flap && detail < 2)
    group.add(
      aerofoil(w.chord * 0.42, 0.1, 0.04, span * 0.98, steps),
      carbon,
      placed(0, y + 0.045, z - w.chord * 0.92, 0.42),
    );
  // Endplates.
  for (const side of [-1, 1]) {
    const plate = roundedBox(0.012, 0.2 + (w.flap ? 0.06 : 0), w.chord * 1.45, 0.004, 1);
    group.add(plate, carbon, placed(side * (span / 2 + 0.006), y + 0.02, z - w.chord * 0.6));
  }
  const deckAt = (zz: number, x: number) => model.surfaceY(zz, x);
  if (w.kind === 'swan-neck' && detail < 2)
    for (const side of [-1, 1]) {
      const x = side * span * 0.22,
        z0 = z + 0.05,
        y0 = deckAt(z0, Math.abs(x)) - 0.01;
      group.add(
        tubeGeometry(
          [
            [x, y0, z0],
            [x, y + 0.1, z0 - 0.05],
            [x, y + 0.13, z - w.chord * 0.35],
            [x, y + 0.03, z - w.chord * 0.55],
          ],
          0.012,
          detail === 0 ? 16 : 8,
          6,
        ),
        carbon,
      );
    }
  else if (w.kind === 'pedestal' || w.kind === 'swan-neck')
    for (const side of [-1, 1]) {
      const x = side * span * 0.28,
        zz = z - w.chord * 0.4;
      const y0 = deckAt(zz, Math.abs(x)) - 0.01;
      group.add(
        roundedBox(0.014, Math.max(0.05, y - y0), 0.12, 0.004, 1),
        carbon,
        placed(x, (y + y0) / 2, zz),
      );
    }
  else if (w.kind === 'full-width')
    for (const side of [-1, 1]) {
      // Endplates run down to the rear bodywork.
      const x = side * (span / 2 + 0.006),
        y0 = deckAt(z - w.chord * 0.5, Math.min(Math.abs(x), model.halfWidth(z) * 0.9));
      group.add(
        roundedBox(0.01, Math.max(0.05, y - y0 + 0.06), w.chord * 1.6, 0.004, 1),
        carbon,
        placed(x, (y + y0) / 2, z - w.chord * 0.65),
      );
    }
  else if (w.kind === 'roof')
    for (const side of [-1, 1]) {
      const x = side * (span / 2 - 0.02);
      group.add(
        roundedBox(0.012, 0.16, w.chord * 0.9, 0.004, 1),
        mats.paint,
        placed(x, y - 0.06, z - w.chord * 0.2, 0.35),
      );
    }
  return group;
}
/** Build one LOD of a closed body into `lod.group`. */
export function buildClosedBody(
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
) {
  const { f, s } = model;
  const parts = new Parts();
  const rings = model.stations(detail).map((z) => model.ring(z, detail));
  const lower = loftRings(rings, {
    capStart: true,
    capEnd: true,
    capMaterial: M.paint,
    material: (zMid, j) => model.slot(zMid, j, detail),
  });
  parts.addGrouped(
    lower,
    [
      mats.paint,
      sharedMaterials.plastic(),
      sharedMaterials.carbonSatin(),
      mats.accent,
      sharedMaterials.interior(),
    ],
    'Body (lofted)',
  );
  const openCockpit = s.style === 'roadster' || !!s.open;
  if (!openCockpit)
    parts.addGrouped(
      greenhouse(model, detail),
      [mats.paint, sharedMaterials.glass(), sharedMaterials.trim()],
      'Greenhouse',
    );
  const [ws, rf, rr, rw] = s.cabin,
    zWs = f.z(ws),
    zRF = f.z(rf),
    zRR = f.z(rr),
    zRW = f.z(rw);
  const trim = sharedMaterials.trim(),
    grille = sharedMaterials.grille(),
    carbon = sharedMaterials.carbon();
  // Lamps: recessed housings with lenses, oriented to the local surface.
  const hw = (z: number) => model.halfWidth(z);
  const surface = (z: number, x: number) => {
    const y0 = model.surfaceY(z, x),
      dz = (model.surfaceY(z + 0.02, x) - model.surfaceY(z - 0.02, x)) / 0.04,
      dx = (model.surfaceY(z, x + 0.02) - model.surfaceY(z, Math.max(0, x - 0.02))) / 0.04;
    return { y: y0, pitch: -Math.atan(dz), roll: Math.atan(dx) };
  };
  const seg = detail === 0 ? 3 : 1;
  const zHead = model.zFront - (s.style === 'truck' ? 0.1 : s.lamps.front === 'pod' ? 0.3 : 0.22);
  for (const side of [-1, 1]) {
    const ax = hw(zHead) * (s.lamps.front === 'bar' ? 0.45 : 0.66),
      at = surface(zHead, ax),
      x = side * ax,
      roll = side * at.roll;
    const lamp = (w: number, d: number, dx = 0, round = false) => {
      parts.add(
        roundedBox(w + 0.03, 0.03, d + 0.03, 0.012, seg),
        trim,
        placed(x + side * dx, at.y - 0.01, zHead, at.pitch, 0, roll),
      );
      const lens = round
        ? new T.CylinderGeometry(w / 2, w / 2, 0.026, detail === 0 ? 24 : 10)
        : roundedBox(w, 0.026, d, 0.01, seg);
      parts.add(lens, mats.head, placed(x + side * dx, at.y - 0.002, zHead, at.pitch, 0, roll));
    };
    if (s.lamps.front === 'round') lamp(0.15, 0.15, 0, true);
    else if (s.lamps.front === 'twin') {
      lamp(0.12, 0.12, 0.08, true);
      lamp(0.12, 0.12, -0.08, true);
    } else if (s.lamps.front === 'pod') {
      parts.add(
        roundedBox(0.16, 0.08, 0.22, 0.035, seg),
        mats.paint,
        placed(x, at.y + 0.02, zHead, at.pitch),
      );
      parts.add(
        roundedBox(0.12, 0.05, 0.02, 0.012, seg),
        mats.head,
        placed(x, at.y + 0.025, zHead + 0.11),
      );
    } else if (s.lamps.front === 'bar') lamp(hw(zHead) * 0.5, 0.06);
    else lamp(0.3, 0.07);
  }
  // Tail lamps on the rear face.
  {
    const zTail = model.zRear - 0.004,
      half = hw(model.zRear) * 0.8,
      ty = Math.min(f.y(s.tail) - 0.13, model.topY(model.zRear) - 0.06);
    const unit = (x: number, w: number, h: number, round = false) => {
      parts.add(
        roundedBox(w + 0.03, h + 0.03, 0.02, 0.01, seg),
        trim,
        placed(x, ty, zTail + 0.006),
      );
      parts.add(
        round
          ? new T.CylinderGeometry(w / 2, w / 2, 0.02, detail === 0 ? 20 : 8).rotateX(Math.PI / 2)
          : roundedBox(w, h, 0.02, Math.min(0.01, h / 3), seg),
        mats.tail,
        placed(x, ty, zTail),
      );
    };
    if (s.lamps.rear === 'bar') unit(0, half * 1.7, 0.06);
    else if (s.lamps.rear === 'strip') unit(0, half * 1.8, 0.022);
    for (const side of [-1, 1]) {
      const x = side * half * 0.74;
      if (s.lamps.rear === 'round') {
        unit(x, 0.11, 0.11, true);
        unit(x - side * 0.15, 0.09, 0.09, true);
      } else if (s.lamps.rear === 'twin') unit(x, 0.24, 0.09);
    }
  }
  // Grille and intakes.
  if (s.grille > 0) {
    const gw = hw(model.zFront) * 1.1 * s.grille;
    parts.add(
      roundedBox(gw, 0.12 * Math.max(0.6, s.grille), 0.08, 0.02, 2),
      grille,
      placed(0, f.y(s.nose * 0.55 + s.floor * 0.45), model.zFront - 0.035),
    );
  }
  if (s.splitter > 0 && detail < 2) {
    const sp = roundedBox(hw(model.zFront - 0.25) * 2 * 0.94, 0.014, 0.5, 0.006, 1);
    lod.front.push(
      ...addDetachable(
        lod,
        sp,
        carbon,
        placed(0, f.y(s.floor + 0.02), model.zFront + s.splitter * 0.5 - 0.25),
      ),
    );
  }
  if (detail < 2) {
    // Lower rear valance across the tail, and the diffuser ramp behind it.
    const zv = model.zRear - 0.004,
      half = hw(model.zRear) * 0.8;
    parts.add(
      roundedBox(half * 1.9, 0.1, 0.03, 0.012, 1),
      sharedMaterials.plastic(),
      placed(0, f.y(s.floor) + 0.17, zv + 0.01),
    );
    if (s.diffuser > 0) {
      const ramp = roundedBox(half * 1.6, 0.012, 0.6, 0.004, 1);
      parts.add(
        ramp,
        sharedMaterials.carbonSatin(),
        placed(0, f.y(s.floor) + 0.07, model.zRear + 0.3, 0.2),
      );
    }
  }
  if (s.diffuser > 0 && detail < 2) {
    const h = 0.04 + s.diffuser * 0.45;
    for (let k = -2; k <= 2; k++)
      parts.add(
        roundedBox(0.012, h, 0.42, 0.004, 1),
        carbon,
        placed(k * hw(model.zRear) * 0.3, f.y(s.floor) + h * 0.5 + 0.03, model.zRear + 0.2, 0.25),
      );
  }
  if (s.sideIntake && detail < 2)
    for (const side of [-1, 1]) {
      const zi = f.rearAxle + f.radius + 0.36;
      const yi = f.y(s.belt) - 0.04;
      parts.add(
        roundedBox(0.06, 0.18, 0.42, 0.03, 2),
        grille,
        placed(side * (model.sideX(zi, yi) - 0.02), yi, zi),
      );
    }
  if (s.bonnetVents && detail < 2)
    for (const side of [-1, 1]) {
      const zv = (f.frontAxle + zWs) / 2 + 0.05;
      const xv = hw(zv) * 0.45,
        at = surface(zv, xv);
      parts.add(
        roundedBox(0.22, 0.02, 0.26, 0.008, 1),
        grille,
        placed(side * xv, at.y - 0.004, zv, at.pitch, 0, side * at.roll),
      );
    }
  if (s.roofScoop && !openCockpit) {
    const zs = zRF - 0.12;
    parts.add(
      roundedBox(0.26, 0.09, 0.4, 0.035, seg),
      mats.paint,
      placed(0, f.y(s.roof) + 0.035, zs),
    );
    parts.add(
      roundedBox(0.2, 0.05, 0.02, 0.01, 1),
      grille,
      placed(0, f.y(s.roof) + 0.045, zs + 0.2),
    );
  }
  // Mirrors on short stalks at the A-pillar base.
  if (s.mirrors && detail < 2)
    for (const side of [-1, 1]) {
      const zm = zWs - 0.14,
        ym = model.topY(zm) + 0.08,
        xm = side * (hw(zm) * 0.8 + 0.08);
      parts.add(roundedBox(0.12, 0.065, 0.085, 0.028, seg), mats.paint, placed(xm, ym, zm));
      parts.add(
        roundedBox(0.1, 0.05, 0.006, 0.008, 1),
        sharedMaterials.chrome(),
        placed(xm, ym, zm - 0.044),
      );
      parts.add(
        rodGeometry(
          new T.Vector3(xm - side * 0.04, ym - 0.02, zm),
          new T.Vector3(side * (hw(zm) * 0.8 - 0.01), ym - 0.06, zm + 0.02),
          0.009,
          6,
        ),
        trim,
      );
    }
  // Number boards on the doors (texture-mapped planes facing outward).
  if (s.numbers === 'door' && detail < 2)
    for (const side of [-1, 1]) {
      const zn = (zRF + zRR) / 2 + 0.05,
        yn = f.y(s.belt) - 0.16;
      const x = model.sideX(zn, yn);
      parts.add(
        new T.PlaneGeometry(0.3, 0.26).rotateY((side * Math.PI) / 2),
        mats.board,
        placed(side * (x + 0.006), yn, zn),
      );
    }
  // Exhausts.
  if (s.extras.includes('exhaust-rear'))
    for (const side of [-1, 1])
      parts.add(
        new T.CylinderGeometry(0.045, 0.05, 0.12, 14).rotateX(Math.PI / 2),
        sharedMaterials.exhaust(),
        placed(side * hw(model.zRear) * 0.45, f.y(s.floor + 0.14), model.zRear + 0.02),
      );
  if (s.extras.includes('exhaust-side'))
    for (const side of [-1, 1])
      parts.add(
        new T.CylinderGeometry(0.04, 0.04, 0.14, 12).rotateX(Math.PI / 2),
        sharedMaterials.exhaust(),
        placed(side * (hw(f.z(ws)) - 0.02), f.y(s.floor + 0.1), f.frontAxle - f.radius - 0.3),
      );
  if (s.extras.includes('fin') && detail < 2) {
    const z0 = zRR,
      z1 = model.zRear + 0.4;
    const fin = new T.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(z0 - z1, 0);
    fin.lineTo(z0 - z1, f.y(s.roof) - model.topY(z1) - 0.05);
    fin.lineTo(0, 0.05);
    const g = new T.ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
    g.rotateY(-Math.PI / 2).translate(0.006, model.topY(z1) - 0.01, z1);
    parts.add(g, mats.paint);
  }
  if (s.extras.includes('mudflaps') && detail < 2)
    for (const a of [f.frontAxle, f.rearAxle])
      for (const side of [-1, 1])
        parts.add(
          roundedBox(0.2, 0.22, 0.008, 0.003, 1),
          sharedMaterials.plastic(),
          placed(side * (hw(a) - 0.12), f.y(s.floor + 0.14), a - f.radius - 0.08),
        );
  if (s.extras.includes('lightbar'))
    parts.add(
      roundedBox(s.width * 0.6, 0.07, 0.08, 0.02, 2),
      mats.head,
      placed(0, f.y(s.roof) + 0.06, zRF - 0.05),
    );
  if (s.extras.includes('bullbar') && detail < 2) {
    const zb = model.zFront + 0.04,
      yb = f.y(s.nose);
    parts.add(
      tubeGeometry(
        [
          [-hw(zb) * 0.9, yb - 0.25, zb - 0.1],
          [-hw(zb) * 0.7, yb + 0.12, zb],
          [hw(zb) * 0.7, yb + 0.12, zb],
          [hw(zb) * 0.9, yb - 0.25, zb - 0.1],
        ],
        0.025,
        20,
        8,
      ),
      sharedMaterials.steel(),
    );
  }
  if (s.extras.includes('snorkel') && detail < 2) {
    const zs = zWs - 0.04;
    const x = -(hw(zs) * 0.8 + 0.02);
    parts.add(
      tubeGeometry(
        [
          [x, f.y(s.belt), zs + 0.1],
          [x - 0.02, f.y(s.cowl + 0.1), zs + 0.05],
          [x + 0.06, f.y(s.roof + 0.04), zs - 0.15],
        ],
        0.045,
        14,
        10,
      ),
      sharedMaterials.plastic(),
    );
  }
  if (s.extras.includes('spare') && detail < 2) {
    // Spare wheel strapped flat in the bed: tyre, rim and hub.
    const zs = model.zRear + 0.62,
      ys = model.topY(zs) + f.radius * 0.26;
    const tyre = new T.TorusGeometry(f.radius * 0.76, f.radius * 0.25, 14, detail === 0 ? 40 : 16);
    parts.add(tyre.rotateX(Math.PI / 2), sharedMaterials.plastic(), placed(0, ys, zs));
    const rim = new T.CylinderGeometry(f.radius * 0.56, f.radius * 0.56, f.radius * 0.36, 24);
    parts.add(rim, sharedMaterials.rim(0x1a1b1d), placed(0, ys, zs));
    for (const side of [-1, 1])
      parts.add(
        roundedBox(0.04, 0.012, f.radius * 2.1, 0.004, 1),
        sharedMaterials.plastic(),
        placed(side * 0.12, ys + f.radius * 0.26, zs),
      );
  }
  if (s.extras.includes('cage') && s.style === 'truck' && detail < 2) {
    // Exposed bed cage: tubes from the cab roof to the tail, shock towers.
    const steel = sharedMaterials.steel(),
      y1 = f.y(s.roof) - 0.04,
      zt = model.zRear + 0.12,
      yt = model.topY(zt) + 0.32;
    for (const side of [-1, 1]) {
      const x1 = side * hw(zRR) * s.roofWidth * 0.85,
        xt = side * hw(zt) * 0.72;
      parts.add(
        tubeGeometry(
          [
            [x1, y1, zRR + 0.06],
            [x1 * 1.05, y1 - 0.08, zRR - 0.4],
            [xt, yt, zt],
          ],
          0.026,
          20,
          8,
        ),
        steel,
      );
      parts.add(
        rodGeometry(
          new T.Vector3(xt, yt, zt),
          new T.Vector3(xt, model.topY(zt) - 0.02, zt - 0.05),
          0.024,
          8,
        ),
        steel,
      );
      const zr = f.rearAxle;
      parts.add(
        rodGeometry(
          new T.Vector3(side * hw(zr) * 0.55, model.topY(zr) - 0.05, zr + 0.08),
          new T.Vector3(side * hw(zr) * 0.68, model.topY(zr) + 0.42, zr + 0.18),
          0.045,
          12,
        ),
        sharedMaterials.chrome(),
      );
    }
    parts.add(
      rodGeometry(
        new T.Vector3(-hw(zt) * 0.72, yt, zt),
        new T.Vector3(hw(zt) * 0.72, yt, zt),
        0.026,
        8,
      ),
      steel,
    );
    for (const x of [-0.35, 0, 0.35])
      parts.add(
        roundedBox(0.09, 0.07, 0.05, 0.015, 2),
        mats.tail,
        placed(x * hw(zt), yt + 0.02, zt - 0.03),
      );
  }
  if (s.extras.includes('cage') && detail === 0 && !openCockpit && s.style !== 'truck') {
    // Roll cage visible through the glass.
    const y0 = model.topY(zRR) - 0.05,
      y1 = f.y(s.roof) - 0.07;
    for (const side of [-1, 1]) {
      const x0 = side * hw(zRR) * 0.62,
        x1 = side * hw(zRR) * s.roofWidth * 0.85;
      parts.add(
        rodGeometry(new T.Vector3(x0, y0, zRR + 0.05), new T.Vector3(x1, y1, zRR + 0.05), 0.02, 8),
        sharedMaterials.steel(),
      );
      parts.add(
        rodGeometry(
          new T.Vector3(x1, y1, zRR + 0.05),
          new T.Vector3(x1 * 0.95, y1 - 0.02, zRF - 0.05),
          0.02,
          8,
        ),
        sharedMaterials.steel(),
      );
    }
  }
  if (openCockpit && detail < 2) {
    // Low screen and roll hoop (racing); a road roadster without a cage has
    // a taller framed screen and no hoop.
    const racing = s.style !== 'roadster' || s.extras.includes('cage');
    const zw = zWs + 0.02,
      yw = model.topY(zw);
    const screen = roundedBox(hw(zw) * 1.5, racing ? 0.22 : 0.36, 0.008, 0.004, 1);
    parts.add(
      screen,
      sharedMaterials.glass(),
      placed(0, yw + (racing ? 0.1 : 0.16), zw, racing ? -0.45 : -0.62),
    );
    if (!racing)
      parts.add(
        roundedBox(hw(zw) * 1.52, 0.03, 0.03, 0.01, 1),
        sharedMaterials.trim(),
        placed(0, yw + 0.33, zw - 0.1),
      );
    const zh = zRW + 0.12,
      yh = model.topY(zh);
    if (racing)
      parts.add(
        tubeGeometry(
          [
            [-0.32, yh - 0.02, zh],
            [-0.3, yh + 0.38, zh - 0.04],
            [0.3, yh + 0.38, zh - 0.04],
            [0.32, yh - 0.02, zh],
          ],
          0.022,
          20,
          8,
        ),
        sharedMaterials.steel(),
      );
  }
  extraFurniture(parts, model, mats, detail, lod);
  // Interior: dash, seat, driver (visible through glass / open cockpit).
  if (detail === 0) {
    const zd = zWs - 0.12,
      yd = model.topY(zd) - (openCockpit ? 0.02 : 0.06);
    parts.add(
      roundedBox(hw(zd) * 1.4, 0.1, 0.3, 0.03, 2),
      sharedMaterials.interior(),
      placed(0, yd, zd),
    );
    const seatZ = openCockpit ? (zWs + zRW) / 2 - 0.15 : (zRF + zRR) / 2;
    const seatX = s.style === 'truck' || s.style === 'saloon' || s.style === 'rally' ? 0.36 : 0.3;
    const seatY = f.y(s.floor) + 0.12;
    parts.add(
      roundedBox(0.44, 0.12, 0.48, 0.04, 2),
      sharedMaterials.interior(),
      placed(seatX, seatY + 0.06, seatZ),
    );
    parts.add(
      roundedBox(0.44, 0.62, 0.12, 0.05, 2),
      sharedMaterials.interior(),
      placed(seatX, seatY + 0.36, seatZ - 0.26, -0.18),
    );
    addDriver(parts, mats, seatX, seatY + 0.12, seatZ - 0.05, 0.9, zd - 0.12);
  }
  void rr;
  parts.build(lod.group, detail === 0);
  if (s.wing) {
    const built = wing(parts, model, s.wing, mats, detail);
    if (built) {
      const g = new T.Group();
      g.name = 'Rear wing (detachable)';
      built.build(g, detail === 0);
      lod.group.add(g);
      lod.rear.push(g);
    }
    parts.build(lod.group, detail === 0);
  }
}
/** Catalogue-growth furniture: extractor fans, dive planes, a rally lamp
 * pod, a bonnet scoop and fender louvres (each only when the sheet asks). */
function extraFurniture(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
) {
  const { f, s } = model;
  const has = (e: ClosedSheet['extras'][number]) => s.extras.includes(e);
  const hw = (z: number) => model.halfWidth(z);
  const grille = sharedMaterials.grille(),
    carbon = sharedMaterials.carbon(),
    sides = detail === 0 ? 28 : detail === 1 ? 14 : 8;
  if (has('fan')) {
    // Two extractor fans in a shroud across the tail, blades behind a grille.
    const zf = model.zRear + 0.02,
      yf = f.y(s.floor) + Math.min(0.3, (s.tail - s.floor) * 0.45),
      r = Math.min(0.24, hw(model.zRear) * 0.42);
    for (const side of [-1, 1]) {
      const x = side * r * 1.08;
      parts.add(
        new T.CylinderGeometry(r + 0.025, r + 0.025, 0.08, sides, 1, true).rotateX(Math.PI / 2),
        sharedMaterials.plastic(),
        placed(x, yf, zf),
      );
      parts.add(new T.CircleGeometry(r, sides).rotateY(Math.PI), grille, placed(x, yf, zf - 0.035));
      if (detail < 2)
        for (let k = 0; k < 6; k++)
          // Hub, then the blade's angular slot, its radial offset and pitch.
          parts.add(
            roundedBox(0.05, r * 0.9, 0.012, 0.004, 1),
            sharedMaterials.steel(),
            placed(x, yf, zf - 0.02, 0, 0, (k / 6) * Math.PI * 2).multiply(
              placed(0, r * 0.45, 0, 0, 0.35),
            ),
          );
    }
  }
  if (has('canards') && detail < 2)
    for (const side of [-1, 1])
      for (const [dz, dy] of [
        [0.18, 0.04],
        [0.32, 0.12],
      ] as const) {
        const z = model.zFront - dz,
          plane = aerofoil(0.16, 0.08, 0.02, 0.2, detail === 0 ? 8 : 4);
        const front = new T.Mesh(
          plane.applyMatrix4(placed(side * (hw(z) + 0.06), f.y(s.nose * 0.7) + dy, z, 0.18)),
          carbon,
        );
        front.castShadow = detail === 0;
        front.name = 'Dive plane (detachable)';
        lod.group.add(front);
        lod.front.push(front);
      }
  if (has('lamp-pod')) {
    // Four round driving lamps on a bar ahead of the grille.
    const zl = model.zFront + 0.03,
      yl = f.y(s.nose) + 0.05;
    parts.add(
      roundedBox(hw(zl) * 1.3, 0.03, 0.03, 0.01, 1),
      sharedMaterials.steel(),
      placed(0, yl - 0.09, zl - 0.02),
    );
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * hw(zl) * 0.34;
      parts.add(
        new T.CylinderGeometry(0.085, 0.085, 0.07, sides).rotateX(Math.PI / 2),
        sharedMaterials.trim(),
        placed(x, yl, zl),
      );
      parts.add(new T.CircleGeometry(0.075, sides), mats.head, placed(x, yl, zl + 0.036));
    }
  }
  if (has('bonnet-scoop')) {
    const zs = f.frontAxle - 0.25,
      ys = model.surfaceY(zs, 0);
    parts.add(roundedBox(0.5, 0.08, 0.62, 0.03, 2), mats.paint, placed(0, ys + 0.02, zs));
    parts.add(roundedBox(0.42, 0.05, 0.02, 0.01, 1), grille, placed(0, ys + 0.03, zs + 0.31));
  }
  if (has('louvres') && detail < 2)
    for (const side of [-1, 1])
      for (let k = 0; k < 5; k++) {
        const zl = f.frontAxle - 0.08 + k * 0.07,
          xl = hw(zl) * 0.78;
        parts.add(
          roundedBox(0.22, 0.012, 0.025, 0.004, 1),
          grille,
          placed(side * xl, model.surfaceY(zl, xl) + 0.004, zl),
        );
      }
}
function addDetachable(
  lod: BuiltLod,
  geometry: T.BufferGeometry,
  material: T.Material,
  matrix: T.Matrix4,
) {
  geometry.applyMatrix4(matrix);
  const mesh = new T.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Front element (detachable)';
  lod.group.add(mesh);
  return [mesh];
}
