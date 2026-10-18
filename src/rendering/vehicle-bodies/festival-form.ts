import * as T from 'three';
import { clamp, smooth } from '../../core/math.ts';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet, type WingSheet } from './body-sheet.ts';
import { cabinLayout } from './cabin.ts';
import { ClosedBodyModel, Greenhouse, M } from './closed-body.ts';
import type { BuiltLod, CarMaterials } from './common.ts';
import type { BodyFrame } from './frame.ts';
import { insetProfile, roundedBox, sampleProfile, Track, type Pt, type Ring } from './loft.ts';
import { endBand, festivalFasciaOpenings } from './festival-detail.ts';
import { addFestivalHardware } from './festival-hardware.ts';
import { sharedMaterials, type PanelGap } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';
import {
  displaceSection,
  mergeStations,
  onRecessFloor,
  recessAt,
  recessStations,
  type Recess,
} from './festival-sculpt.ts';

/** Festival road-car form (open-world only: FestivalCars builds its bodies
 * with `{ festival: true }`; the circuit catalogue keeps the plain lofts).
 * The same sheet stations, heights, wheels and cabin drive a taut production
 * surface: every section is a fixed chain of feature points with hard creases
 * (floor edge, rocker sill, door bottom, shoulder, hood / deck edge) whose
 * spans are smoothed separately and whose crease points are duplicated, so
 * normals split along the character lines; wheel arches end in a crisp lip,
 * fender crests rise over the wheels outboard of a lower hood, the shoulder
 * climbs over the arches, the plan view wraps round the nose and tail, and
 * the greenhouse is a flush glass band under a crowned roof with black
 * frames and pillars. Construction principles from references 009-021, 037,
 * 053-063 and 089-098 (docs/production/fh6-r4/vehicle-bodies.md): original
 * shapes, no real model's surfaces. */
export interface FestivalForm {
  /** Greenhouse sill (window line) as a share of the half width. */
  sill: number;
  /** Hood and rear deck edge (the inboard crease of the fender tops) shares. */
  hoodEdge: number;
  deckEdge: number;
  /** Length (m) over which the edge moves from the sill to the hood/deck line. */
  edgeBlend: number;
  /** Fender crest above the hood / deck centreline over each axle (m). */
  fender: readonly [number, number];
  /** Hood and deck crown: centreline above the edge crease (m). */
  crown: number;
  /** Shoulder crease relative to the sheet's belt (m). */
  shoulder: number;
  /** Rocker sill: top above the floor (m), its face inset from the side (m),
   * the door bottom's turn-in (m) and whether it is dark trim. */
  rocker: number;
  rockerIn: number;
  tuck: number;
  rockerDark: boolean;
  /** Plan view: bumper face width share, wrap length (m); the nose's upper
   * roll into the fascia (m). */
  noseWidth: number;
  noseWrap: number;
  noseRoll: number;
  tailWidth: number;
  tailWrap: number;
  tailRoll: number;
  /** Wheel-arch lip protrusion (m); cladding: black plastic arches. */
  lip: number;
  cladding: boolean;
  /** Roof and pillar finishes; roof plan taper toward the rear window. */
  roof: 'paint' | 'black';
  aPillar: 'paint' | 'black';
  bPillar: 'paint' | 'black';
  roofTaper: number;
  /** Open load bed (pickups): floor height above the road and rail width (m). */
  bed: { floor: number; rail: number } | null;
  /** Festival nose, hood (at the front axle), deck and tail heights (m above
   * the road) over the sheet's. */
  nose?: number;
  bonnet?: number;
  deck?: number;
  tail?: number;
  /** Lower rear valance / diffuser band height (m), black. */
  valance: number;
  /** End faces in plan and side view: how far the bumper corners sweep back
   * from the face centre (m) and how far the upper face leans back (m). */
  noseCurve: number;
  noseRake: number;
  tailCurve: number;
  tailRake: number;
  /** A gloss black bar across the top of the bumper face joining the
   * headlamps (refs 019, 020, 090). */
  noseBar?: boolean;
  /** Headlamps set into an upright bumper face (trucks, muscle cars; ref
   * 063) instead of the nose roll. */
  lampFace?: boolean;
  /** Black corner intakes wrapping the front bumper corners (refs 011, 014,
   * 019, 096). */
  cornerVents?: boolean;
  /** Station where the roof ends (a longer, more raked hatch glass). */
  roofEnd?: number;
  /** Station (fraction of the wheelbase) where the side glass ends; behind it
   * a body-colour C-pillar (absent: the sheet's rear window base decides). */
  dlo?: number;
  /** Proportions over the sheet (refs 017, 019, 037, 097, 098): the roof
   * lowered (m), the glass base raised along the cabin (m) for a slimmer
   * glass band, and extra rear-haunch half width (m). */
  roofDrop: number;
  beltRise: number;
  haunch: number;
  /** Concave surfacing (festival-sculpt.ts): a side scoop ahead of each rear
   * wheel (depth m; cars whose sheet has a side intake; refs 013, 090, 097)
   * and a vertical gill behind each front wheel (depth m; refs 011, 014,
   * 019, 037). 0: none. */
  scoop: number;
  gill: number;
  /** Rear exhaust layout of a sheet with rear exhausts (festival-hardware.ts;
   * refs 018, 035, 053, 069, 099). */
  exhaust?: 'quad' | 'twin' | 'centre';
  /** A hooked end on each side of a full-width LED tail bar (refs 018, 035). */
  tailHook?: boolean;
  /** A third hood vent ahead of the twin vents (ref 019). */
  centreVent?: boolean;
  /** Competition dress: a red tow hook and carbon dive planes (refs 001,
   * 009, 045, 066, 074). */
  towHook?: boolean;
  canards?: boolean;
}
/** Competition classes carry a tow hook and dive planes. */
const COMPETITION = new Set(['gt', 'gt-sport', 'touring', 'club']);
const STYLE_FORMS: Record<ClosedSheet['style'], FestivalForm> = {
  supercar: {
    sill: 0.78,
    hoodEdge: 0.6,
    deckEdge: 0.64,
    edgeBlend: 0.35,
    fender: [0.075, 0.1],
    crown: 0.012,
    shoulder: 0,
    rocker: 0.13,
    rockerIn: 0.055,
    tuck: 0.035,
    rockerDark: true,
    noseWidth: 0.66,
    noseWrap: 0.55,
    noseRoll: 0.07,
    tailWidth: 0.82,
    tailWrap: 0.42,
    tailRoll: 0.06,
    valance: 0.2,
    noseCurve: 0.15,
    noseRake: 0.05,
    tailCurve: 0.09,
    tailRake: 0.03,
    lip: 0.012,
    cladding: false,
    roof: 'black',
    aPillar: 'black',
    bPillar: 'black',
    roofTaper: 0.14,
    bed: null,
    roofDrop: 0.03,
    beltRise: 0.03,
    haunch: 0.035,
    scoop: 0.075,
    gill: 0.02,
  },
  gt: {
    sill: 0.8,
    hoodEdge: 0.68,
    deckEdge: 0.72,
    edgeBlend: 0.35,
    fender: [0.035, 0.06],
    crown: 0.022,
    shoulder: 0,
    rocker: 0.12,
    rockerIn: 0.045,
    tuck: 0.03,
    rockerDark: false,
    noseWidth: 0.68,
    noseWrap: 0.5,
    noseRoll: 0.09,
    tailWidth: 0.84,
    tailWrap: 0.4,
    tailRoll: 0.07,
    valance: 0.14,
    noseCurve: 0.13,
    noseRake: 0.04,
    tailCurve: 0.08,
    tailRake: 0.03,
    lip: 0.01,
    cladding: false,
    roof: 'paint',
    aPillar: 'black',
    bPillar: 'black',
    roofTaper: 0.1,
    bed: null,
    roofDrop: 0.03,
    beltRise: 0.035,
    haunch: 0.02,
    scoop: 0.065,
    gill: 0.018,
  },
  roadster: {
    sill: 0.8,
    hoodEdge: 0.68,
    deckEdge: 0.72,
    edgeBlend: 0.3,
    fender: [0.04, 0.05],
    crown: 0.02,
    shoulder: 0,
    rocker: 0.11,
    rockerIn: 0.04,
    tuck: 0.03,
    rockerDark: false,
    noseWidth: 0.7,
    noseWrap: 0.45,
    noseRoll: 0.09,
    tailWidth: 0.84,
    tailWrap: 0.36,
    tailRoll: 0.06,
    valance: 0.12,
    noseCurve: 0.12,
    noseRake: 0.04,
    tailCurve: 0.08,
    tailRake: 0.03,
    lip: 0.01,
    cladding: false,
    roof: 'paint',
    aPillar: 'black',
    bPillar: 'black',
    roofTaper: 0.06,
    bed: null,
    roofDrop: 0,
    beltRise: 0,
    haunch: 0.015,
    scoop: 0,
    gill: 0,
  },
  saloon: {
    sill: 0.86,
    hoodEdge: 0.74,
    deckEdge: 0.8,
    edgeBlend: 0.3,
    fender: [0.02, 0.025],
    crown: 0.025,
    shoulder: 0.02,
    rocker: 0.13,
    rockerIn: 0.035,
    tuck: 0.028,
    rockerDark: false,
    noseWidth: 0.74,
    noseWrap: 0.42,
    noseRoll: 0.08,
    tailWidth: 0.86,
    tailWrap: 0.34,
    tailRoll: 0.07,
    valance: 0.12,
    noseCurve: 0.1,
    noseRake: 0.04,
    tailCurve: 0.07,
    tailRake: 0.03,
    lip: 0.008,
    cladding: false,
    roof: 'paint',
    aPillar: 'black',
    bPillar: 'black',
    roofTaper: 0.05,
    bed: null,
    roofDrop: 0.035,
    beltRise: 0.04,
    haunch: 0.01,
    scoop: 0,
    gill: 0,
  },
  truck: {
    sill: 0.9,
    hoodEdge: 0.84,
    deckEdge: 0.96,
    edgeBlend: 0.1,
    fender: [0.012, 0],
    crown: 0.015,
    shoulder: 0,
    rocker: 0.1,
    rockerIn: 0.03,
    tuck: 0.025,
    rockerDark: false,
    noseWidth: 0.84,
    noseWrap: 0.3,
    noseRoll: 0.04,
    tailWidth: 0.97,
    tailWrap: 0.1,
    tailRoll: 0.03,
    valance: 0.1,
    noseCurve: 0.05,
    noseRake: 0.02,
    tailCurve: 0.02,
    tailRake: 0,
    lip: 0.03,
    cladding: true,
    roof: 'paint',
    aPillar: 'black',
    bPillar: 'black',
    roofTaper: 0.03,
    bed: { floor: 0.82, rail: 0.075 },
    roofDrop: 0,
    beltRise: 0,
    haunch: 0,
    scoop: 0,
    gill: 0,
  },
  rally: null as unknown as FestivalForm,
  prototype: null as unknown as FestivalForm,
};
/** Per-car proportions over the style defaults (original designs). */
const CAR_FORMS: Readonly<Record<string, Partial<FestivalForm>>> = {
  // Electric hypercar: pointed low nose between tall fender crests, cab-forward
  // teardrop canopy with a black roof, strong rear haunches (refs 013, 090, 097).
  eh3: {
    noseWidth: 0.6,
    noseWrap: 0.62,
    fender: [0.07, 0.1],
    hoodEdge: 0.58,
    bonnet: 0.79,
    noseBar: true,
    cornerVents: true,
    scoop: 0.085,
    tailHook: true,
  },
  // Mid-engined wedge: sharp, flat engine deck between rear crests (refs 014, 092).
  sc7: {
    noseWidth: 0.6,
    noseWrap: 0.56,
    fender: [0.06, 0.09],
    deckEdge: 0.6,
    crown: 0.008,
    bonnet: 0.76,
    cornerVents: true,
    scoop: 0.08,
    exhaust: 'centre',
    tailHook: true,
    centreVent: true,
  },
  // Long-hood luxury GT, fastback with set-back cabin (refs 018, 019, 093).
  lx12: {
    noseWidth: 0.62,
    noseWrap: 0.55,
    fender: [0.045, 0.075],
    noseBar: true,
    exhaust: 'quad',
    tailHook: true,
    centreVent: true,
  },
  // Front-engined muscle coupe: blunt, wide grille face, flat hood (ref 063 stance).
  rm8: {
    noseWidth: 0.76,
    noseWrap: 0.42,
    noseRoll: 0.06,
    fender: [0.03, 0.06],
    hoodEdge: 0.74,
    lampFace: true,
    gill: 0,
  },
  // 1960s GT: rounded nose, soft crowned fenders, chrome-era body-colour sills (ref 012).
  rg63: {
    noseWidth: 0.6,
    noseWrap: 0.5,
    noseRoll: 0.12,
    fender: [0.06, 0.07],
    crown: 0.03,
    rocker: 0.1,
    lip: 0.006,
    aPillar: 'paint',
    bPillar: 'paint',
    roofTaper: 0.08,
    gill: 0,
    haunch: 0.01,
  },
  rd2: { noseWidth: 0.62, fender: [0.045, 0.055] },
  // Sports saloon and hot hatch: crisp shoulders, black skirts (refs 011, 091, 096).
  rs5: { fender: [0.025, 0.03], rockerDark: true, cornerVents: true, exhaust: 'quad' },
  // The hatch glass runs down to a short deck above a compact tail.
  rh3: {
    noseWidth: 0.7,
    rockerDark: true,
    tailWidth: 0.86,
    tailWrap: 0.28,
    deck: 1.12,
    tail: 1.07,
    roofEnd: 0.9,
    dlo: 0.9,
    cornerVents: true,
    towHook: true,
  },
  // Rally-bred road saloon: wider arch flares, a deeper sill (refs 007, 061).
  rr4: {
    lip: 0.016,
    rockerDark: true,
    noseWidth: 0.72,
    cornerVents: true,
    lampFace: true,
    towHook: true,
  },
  // Full-size pickup: tall flat hood ending in an upright grille face (ref 063).
  rp6: {
    hoodEdge: 0.88,
    nose: 1.17,
    noseRoll: 0.035,
    noseWidth: 0.9,
    noseWrap: 0.2,
    noseCurve: 0.03,
    lampFace: true,
  },
};
/** Classes drawn with the festival form: road cars and the closed GT,
 * GT-sport, club and touring cars the festival admits (prototypes, rally and
 * off-road machines keep the plain lofts). */
const FORM_CLASSES = new Set(['road', 'street', 'gt', 'gt-sport', 'club', 'touring']);
export function festivalFormFor(def: VehicleDefinition, sheet: ClosedSheet): FestivalForm | null {
  if (!FORM_CLASSES.has(String(def.classId)) || sheet.open) return null;
  const base = STYLE_FORMS[sheet.style];
  if (!base) return null;
  const race = COMPETITION.has(String(def.classId));
  return Object.freeze({
    ...base,
    exhaust: 'twin' as const,
    towHook: race,
    canards: race && sheet.splitter >= 0.05,
    ...CAR_FORMS[def.id],
  });
}
/** The cabin a festival build carries (under its lowered roof); the sheet's
 * cabin for a car without a form. */
export function festivalCabinFor(def: VehicleDefinition) {
  const sheet = bodySheetFor(def);
  if (!sheet) return null;
  const form = sheet.kind === 'closed' ? festivalFormFor(def, sheet) : null;
  return cabinLayout(def, sheet, form?.roofDrop ?? 0);
}

/** Section feature points (see FestivalBodyModel.control) and their creases. */
const CREASES = [1, 3, 4, 6, 8] as const;
const C = { shoulder: 6, edge: 8, inner: 9 } as const;
// The door (door bottom to shoulder) carries the scoops and gills: about
// 4.5 cm between samples on the near LOD.
const COUNTS: Record<Detail, readonly number[]> = {
  0: [1, 1, 1, 1, 4, 4, 3, 2, 3, 3],
  1: [1, 1, 1, 1, 2, 2, 2, 1, 2, 2],
  2: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};
const STEP: Record<Detail, readonly [number, number]> = {
  0: [0.042, 0.02],
  1: [0.09, 0.045],
  2: [0.22, 0.11],
};
/** Greenhouse section: sill, side glass, glass top (crease), cantrail, roof. */
const GH_CREASES = [2] as const;
const GH_COUNTS: Record<Detail, readonly number[]> = {
  0: [3, 3, 2, 3, 3],
  1: [2, 2, 1, 2, 2],
  2: [1, 1, 1, 1, 1],
};

/** Sample a control chain span by span between creases; each crease point is
 * emitted twice (end of one span, start of the next), so a loft's vertex
 * normals split there while the topology stays fixed. */
export function sampleCreased(
  ctrl: readonly Pt[],
  counts: readonly number[],
  creases: readonly number[],
): Pt[] {
  const out: Pt[] = [];
  let start = 0;
  for (const end of [...creases, ctrl.length - 1]) {
    out.push(...sampleProfile(ctrl.slice(start, end + 1), counts.slice(start, end)));
    start = end;
  }
  return out;
}
/** Sample index of each control point's first copy, and the control segment
 * of each quad (j to j + 1; -1 between a crease's two copies). */
function layout(counts: readonly number[], creases: readonly number[]) {
  const first: number[] = [],
    segment: number[] = [];
  let index = 0;
  for (let c = 0; c < counts.length + 1; c++) {
    first.push(index);
    if (creases.includes(c)) {
      segment.push(-1);
      index++;
    }
    if (c < counts.length)
      for (let k = 0; k < counts[c]; k++) {
        segment.push(c);
        index++;
      }
  }
  return { first, segment };
}
const LAYOUT = {
  0: layout(COUNTS[0], CREASES),
  1: layout(COUNTS[1], CREASES),
  2: layout(COUNTS[2], CREASES),
};
const GH_LAYOUT = {
  0: layout(GH_COUNTS[0], GH_CREASES),
  1: layout(GH_COUNTS[1], GH_CREASES),
  2: layout(GH_COUNTS[2], GH_CREASES),
};

const IDENTITY = new T.Matrix4();
let glossBlack: T.MeshPhysicalMaterial | null = null;
/** Gloss black paint (contrast roofs, black pillars): one shared clear coat. */
export function festivalGlossBlack() {
  if (!glossBlack) {
    glossBlack = new T.MeshPhysicalMaterial({
      name: 'Festival gloss black paint',
      color: 0x050607,
      roughness: 0.32,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
    glossBlack.userData.weatherExposure = 1;
  }
  return glossBlack;
}
export function disposeFestivalForm() {
  glossBlack?.dispose();
  glossBlack = null;
}

export class FestivalBodyModel extends ClosedBodyModel {
  private readonly ftop: Track;
  private readonly ffloor: Track;
  private readonly ftaper: Track;
  private readonly zWs: number;
  private readonly zRW: number;
  private readonly noseWrap: number;
  private readonly tailWrap: number;
  /** Ducktail / lip height at the deck's trailing edge (m). */
  private readonly duck: number;
  /** Scoops, gills and shut-line grooves (festival-sculpt.ts). */
  readonly recesses: Recess[] = [];
  /** The last section `slot` evaluated (one station's faces share it). */
  private slotRing: { z: number; detail: Detail; half: readonly Pt[] } | null = null;
  constructor(
    f: BodyFrame,
    s: ClosedSheet,
    tyreHalf: readonly [number, number],
    readonly form: FestivalForm,
  ) {
    super(f, s, tyreHalf);
    const y = f.y,
      z = f.z,
      fm = form,
      [ws, , , rw] = s.cabin,
      zF = this.zFront,
      zR = this.zRear;
    this.zWs = z(ws);
    this.zRW = z(rw);
    const open = s.style === 'roadster' || !!s.open;
    const cockpit = open ? s.belt + 0.06 : s.cowl + (s.deck - s.cowl) * 0.3;
    // Room for the wraps between the bumper faces and the wheel openings.
    const r = f.radius + 0.05;
    const noseWrap = (this.noseWrap = Math.min(fm.noseWrap, (zF - (f.frontAxle + r)) * 0.95));
    const tailWrap = (this.tailWrap = Math.min(fm.tailWrap, (f.rearAxle - r - zR) * 0.95));
    const nr = fm.noseRoll,
      tr = fm.tailRoll,
      tail = fm.tail ?? s.tail,
      deck = fm.deck ?? s.deck,
      nose = fm.nose ?? s.nose,
      bonnet = fm.bonnet ?? s.bonnet;
    // A ducktail or lip spoiler is shaped into the deck's trailing edge.
    const duck = s.wing?.kind === 'ducktail' ? 0.05 : s.wing?.kind === 'lip' ? 0.028 : 0;
    this.duck = duck;
    const back: [number, number][] = duck
      ? [
          [zR, y(tail + duck - 0.016)],
          [zR + 0.014, y(tail + duck)],
          [zR + 0.2, y(tail + duck * 0.25)],
        ]
      : [
          [zR, y(tail - tr)],
          [zR + tr * 0.35, y(tail - tr * 0.4)],
          [zR + tr * 1.2, y(tail)],
        ];
    // A closed form raises its glass base along the cabin (a slimmer glass
    // band, refs 019, 037): it climbs from the windscreen foot within 0.3 m.
    const rise = open ? 0 : fm.beltRise,
      mid = (z(rw) + z(ws)) / 2,
      shoulderKey: [number, number][] =
        rise > 0 && z(ws) - 0.3 > mid + 0.1
          ? [[z(ws) - 0.3, y(s.cowl + (cockpit + rise - s.cowl) * 0.85)]]
          : [];
    this.ftop = new Track(
      [
        ...back,
        [Math.min(z(rw), zR + 0.32), y(deck)],
        [z(rw) + 0.02, y(open ? cockpit : deck + rise * 0.6)],
        [mid, y(cockpit + rise)],
        ...shoulderKey,
        [z(ws) - 0.02, y(open ? cockpit : s.cowl)],
        [Math.max(z(ws) + 0.05, (z(ws) + f.frontAxle) / 2), y((s.cowl + bonnet) / 2)],
        [f.frontAxle, y(bonnet)],
        [zF - 0.3, y(nose + (bonnet - nose) * 0.5)],
        [zF - nr * 1.1, y(nose)],
        [zF - nr * 0.35, y(nose - nr * 0.42)],
        [zF, y(nose - nr)],
      ].filter((k, i, all) => i === 0 || k[0] > all[i - 1][0] + 1e-3) as [number, number][],
    );
    // The tail tucks under toward its diffuser.
    this.ffloor = new Track([
      [zR, y(s.floor + 0.15 + s.diffuser * 0.3)],
      [zR + 0.1, y(s.floor + 0.07)],
      [zR + 0.25, y(s.floor + 0.02)],
      [f.rearAxle - 0.15, y(s.floor + 0.01)],
      [f.rearAxle + 0.25, y(s.floor)],
      [f.frontAxle - 0.2, y(s.floor)],
      [zF - 0.22, y(s.floor + 0.015)],
      [zF - 0.05, y(s.floor + 0.05)],
      [zF, y(s.floor + 0.075)],
    ]);
    const nw = fm.noseWidth,
      tw = fm.tailWidth;
    this.ftaper = new Track([
      [zR, tw],
      [zR + tailWrap * 0.12, tw + (1 - tw) * 0.47],
      [zR + tailWrap * 0.45, tw + (1 - tw) * 0.86],
      [zR + tailWrap, 1],
      [zF - noseWrap, 1],
      [zF - noseWrap * 0.45, nw + (1 - nw) * 0.84],
      [zF - noseWrap * 0.12, nw + (1 - nw) * 0.45],
      [zF, nw],
    ]);
    this.recesses.push(...this.sculpt());
  }
  /** The form's recesses: a scoop from the rear door shut line to the rear
   * wheel opening, a gill between the front wheel opening and the front door
   * shut line, and a groove along each door shut line (near LOD). */
  private sculpt(): Recess[] {
    const f = this.f,
      s = this.s,
      fm = this.form,
      out: Recess[] = [];
    const [, rf, rr] = s.cabin,
      [front, rear] = this.arches;
    const band = (z: number) => {
      const c = this.control(z);
      return { sill: c[3][1], shoulder: c[C.shoulder][1] };
    };
    if (fm.scoop > 0 && s.sideIntake) {
      const lip = Math.max(f.rearAxle + f.radius + 0.12, f.z((rf + rr) / 2 + 0.12)) - 0.004,
        end = rear.z + rear.r + 0.03,
        { sill, shoulder } = band(lip);
      if (lip - end > 0.25 && shoulder - sill > 0.25)
        out.push({
          kind: 'scoop',
          front: lip,
          rear: end,
          lo: sill + 0.035,
          hi: shoulder - 0.04,
          depth: fm.scoop,
          soft: 0.035,
        });
    }
    if (fm.gill > 0) {
      const lip = front.z - front.r - 0.02,
        { sill, shoulder } = band(lip);
      if (shoulder - sill > 0.25)
        out.push({
          kind: 'gill',
          front: lip,
          rear: lip - 0.042,
          lo: sill + 0.09,
          hi: shoulder - 0.07,
          depth: fm.gill,
          soft: 0.02,
        });
    }
    // Door shut lines (a pickup's cab/bed gap stays the wide shader line).
    for (const gap of this.gaps())
      if (gap.n[2] === 1 && gap.min[0] > 0 && gap.min[1] > f.y(s.floor + 0.1))
        out.push({
          kind: 'groove',
          front: gap.d,
          rear: gap.d,
          lo: gap.min[1],
          hi: gap.max[1],
          depth: 0.0028,
          soft: 0,
        });
    return out;
  }
  override roofHeight() {
    return this.s.roof - (this.s.style === 'roadster' || this.s.open ? 0 : this.form.roofDrop);
  }
  override get festival() {
    return true;
  }
  override drawsWing(w: WingSheet) {
    return w.kind !== 'ducktail' && w.kind !== 'lip' && w.kind !== 'roof';
  }
  /** Headlamps sit on the nose roll, facing forward and up. */
  override lampSetback() {
    return Math.max(0.05, this.form.noseRoll * 0.55);
  }
  override lampFace() {
    if (!this.form.lampFace) return null;
    const top = this.topY(this.zFront),
      bottom = this.endFloor(false);
    return top - Math.max(0.075, (top - bottom) * 0.16);
  }
  /** The end warp at a body-frame point: z offset and its partial
   * derivatives (x, y, z). Near the nose every point moves back by the plan
   * curve (outboard points more) and the rake (upper points more), fading
   * out over the nose wrap; the tail mirrors it. */
  private warpAt(x: number, y: number, z: number, out: number[]) {
    const fm = this.form,
      X = this.halfBase,
      u = x / X,
      phi = Math.min(1, u * u),
      dphi = Math.abs(u) < 1 ? (2 * u) / X : 0;
    out[0] = out[1] = out[2] = out[3] = 0;
    const front = (z - (this.zFront - this.noseWrap)) / this.noseWrap,
      rear = (this.zRear + this.tailWrap - z) / this.tailWrap;
    const apply = (
      t: number,
      dtdz: number,
      curve: number,
      rake: number,
      y0: number,
      y1: number,
      sign: number,
    ) => {
      if (t <= 0) return;
      const tt = Math.min(1, t),
        g = tt * tt * (3 - 2 * tt),
        dg = t < 1 ? 6 * tt * (1 - tt) * dtdz : 0;
      const v = clamp((y - y0) / (y1 - y0), 0, 1),
        psi = v * v * (3 - 2 * v),
        dpsi = v > 0 && v < 1 ? (6 * v * (1 - v)) / (y1 - y0) : 0;
      const shape = curve * phi + rake * psi;
      out[0] += sign * g * shape;
      out[1] += sign * g * curve * dphi;
      out[2] += sign * g * rake * dpsi;
      out[3] += sign * dg * shape;
    };
    const f = this.f,
      s = this.s;
    const nose = fm.nose ?? s.nose;
    apply(front, 1 / this.noseWrap, fm.noseCurve, fm.noseRake, f.y(s.floor + 0.12), f.y(nose), -1);
    apply(
      rear,
      -1 / this.tailWrap,
      fm.tailCurve,
      fm.tailRake,
      f.y(s.floor + 0.2),
      f.y(fm.tail ?? s.tail),
      1,
    );
  }
  override warpGeometry(geometry: T.BufferGeometry) {
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      w = [0, 0, 0, 0],
      v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      this.warpAt(x, y, z, w);
      if (w[0] === 0 && w[3] === 0) continue;
      p.setZ(i, z + w[0]);
      if (!n) continue;
      // Normals follow the inverse transpose of the warp's Jacobian.
      const c = 1 + w[3],
        nz = n.getZ(i);
      v.set(n.getX(i) - (w[1] / c) * nz, n.getY(i) - (w[2] / c) * nz, nz / c).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    if (n) n.needsUpdate = true;
    geometry.computeBoundingSphere();
    return geometry;
  }
  override finishLod(lod: BuiltLod) {
    const warped = new Set<unknown>(),
      inverse = new T.Matrix4(),
      relative = new T.Matrix4();
    lod.group.updateMatrixWorld(true);
    inverse.copy(lod.group.matrixWorld).invert();
    lod.group.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      // Posed parts (the steering column) stay rigid; they sit mid-car.
      relative.multiplyMatrices(inverse, o.matrixWorld);
      if (!relative.equals(IDENTITY)) return;
      const position = o.geometry.getAttribute('position');
      if (warped.has(position)) return;
      warped.add(position);
      this.warpGeometry(o.geometry);
    });
  }
  override endFloor(rear: boolean) {
    return this.ffloor.at(rear ? this.zRear : this.zFront);
  }
  override valanceHeight() {
    return this.form.valance;
  }
  override topY(z: number) {
    return this.ftop.at(z);
  }
  override cabinStations(): readonly [number, number, number, number] {
    const [ws, rf, rr, rw] = this.s.cabin;
    return [ws, rf, this.form.roofEnd ?? rr, rw];
  }
  override halfWidth(z: number) {
    let hw = this.halfBase * this.ftaper.at(z);
    this.arches.forEach((a, i) => {
      // The rear haunch stands wider than the sheet's flare (refs 013, 018).
      const u = (z - a.z) / (a.r * 1.55),
        flare = a.flare + (i === 1 ? this.form.haunch : 0);
      if (Math.abs(u) < 1) hw += flare * Math.cos((u * Math.PI) / 2) ** 2;
    });
    return hw;
  }
  override sillX(z: number) {
    return this.halfWidth(z) * this.form.sill - 0.01;
  }
  /** 0 along the greenhouse, 1 over the hood and the rear deck. */
  private zone(z: number) {
    return Math.max(smooth(this.zWs, this.zWs + 0.3, z), 1 - smooth(this.zRW - 0.3, this.zRW, z));
  }
  /** Share of the half width at which the hood / sill / deck edge crease runs. */
  private edgeShare(z: number) {
    const fm = this.form,
      b = fm.edgeBlend;
    return (
      fm.sill +
      (fm.hoodEdge - fm.sill) * smooth(this.zWs, this.zWs + b, z) +
      (fm.deckEdge - fm.sill) * (1 - smooth(this.zRW - b, this.zRW, z))
    );
  }
  /** Fender crests over the axles. */
  private rise(z: number) {
    let out = 0;
    this.arches.forEach((a, i) => {
      const u = (z - a.z) / (a.r * 1.8);
      if (Math.abs(u) < 1) out += this.form.fender[i] * Math.cos((u * Math.PI) / 2) ** 2;
    });
    return out;
  }
  /** The shoulder crease (at most `cap`) climbs over each arch to 7.5 cm
   * above its crown, even above a low hood (a fender ridge). */
  private shoulderY(z: number, cap: number) {
    // A raised glass base carries the shoulder with it (a crisp, high belt).
    const base = Math.min(this.belt.at(z) + this.form.shoulder + this.form.beltRise * 0.8, cap);
    let lift = 0;
    for (const a of this.arches) {
      const u = (z - a.z) / (a.r * 2);
      const need = a.hub + a.r + 0.075 - base;
      if (need > 0 && Math.abs(u) < 1)
        lift = Math.max(lift, need * Math.cos((u * Math.PI) / 2) ** 2);
    }
    return base + lift;
  }
  /** Bed opening of a pickup (between the tailgate and the cab). */
  bedSpan(): readonly [number, number] | null {
    return this.form.bed ? [this.zRear + 0.07, this.zRW - 0.05] : null;
  }
  /** Feature points of the half section at z: 0 bottom centre, 1 floor edge,
   * 2 rocker underside (tub wall top), 3 sill top (arch lip), 4 door bottom
   * (lip top), 5 door, 6 shoulder crease, 7 fender / haunch crest, 8 hood,
   * sill or deck edge crease, 9 inner hood / deck (bed rail), 10 centre. */
  override control(z: number): Pt[] {
    const fm = this.form;
    const fl = this.ffloor.at(z),
      tp = this.topY(z),
      hw = this.halfWidth(z),
      arch = this.arch(z),
      zone = this.zone(z),
      e = this.edgeShare(z);
    const sh = Math.max(this.shoulderY(z, tp - 0.045), Math.min(fl + 0.16, tp - 0.06));
    // Behind the greenhouse the deck crowns convexly out to its corners
    // (no gutter); only a haunch rises above it.
    const deck = this.form.bed ? 0 : 1 - smooth(this.zRW - 0.3, this.zRW, z);
    const crest = Math.max(tp + this.rise(z) - fm.crown * 1.6 * deck, sh + 0.03);
    const ex = hw * e,
      // Over the hood and deck the crest sits outboard: a broad fender top
      // falling to the hood edge; along the cabin, a tumblehome.
      cx = ex + (hw - ex) * (0.45 + 0.25 * zone);
    const hoodEdge = Math.min(
      crest - 0.004,
      tp - fm.crown + zone * 0.35 * Math.max(0, crest - tp - 0.03),
    );
    const edgeY = hoodEdge + (tp - fm.crown * 0.6 - hoodEdge) * deck;
    // Pickups: a narrow rail top inboard of the edge behind the cab.
    const bed = fm.bed ? 1 - smooth(this.zRW - 0.06, this.zRW, z) : 0,
      rail = fm.bed ? fm.bed.rail : 0,
      hoodY = (edgeY + tp) / 2 + fm.crown * 0.3;
    const inner: Pt = [ex * 0.5 + (ex - rail - ex * 0.5) * bed, hoodY + (tp - hoodY) * bed];
    const upper: Pt[] = [[hw, sh], [cx, crest], [ex, edgeY], inner, [0, tp]];
    if (arch) {
      const ya = Math.min(arch.y, sh - 0.05);
      const tub = Math.min(arch.tub, hw - 0.12);
      return [
        [0, fl],
        [tub, fl],
        [tub, ya],
        [hw + fm.lip, ya],
        [hw - 0.004 + fm.lip * 0.4, ya + 0.026],
        [hw - 0.004, (ya + 0.026 + sh) / 2],
        ...upper,
      ];
    }
    const sillTop = Math.min(fl + fm.rocker, sh - 0.12);
    const sx = hw - fm.rockerIn;
    return [
      [0, fl],
      [Math.min(sx - 0.04, hw * 0.86), fl],
      [sx - 0.016, fl + Math.min(0.03, (sillTop - fl) * 0.3)],
      [sx, sillTop],
      [hw - fm.tuck, sillTop + 0.03],
      [hw - 0.007, (sillTop + 0.03 + sh) / 2],
      ...upper,
    ];
  }
  override ring(z: number, detail: Detail): Ring {
    const half = sampleCreased(this.control(z), COUNTS[detail], CREASES);
    // Recesses move the side from the rocker to the hood / sill / deck edge.
    if (this.recesses.length)
      displaceSection(
        this.recesses,
        z,
        half,
        LAYOUT[detail].first[2],
        LAYOUT[detail].first[C.edge] + 1,
      );
    return { z, half };
  }
  override profile(z: number): readonly Pt[] {
    return this.ring(z, 0).half;
  }
  override deckSample(detail: Detail) {
    return LAYOUT[detail].first[C.edge] + 1;
  }
  /** Sample index of a feature point (second copy of a crease). */
  sampleOf(point: number, detail: Detail) {
    return LAYOUT[detail].first[point] + (CREASES.includes(point as never) ? 1 : 0);
  }
  override surfaceY(z: number, x: number) {
    const half = this.profile(z);
    let best = -Infinity;
    for (let i = LAYOUT[0].first[C.shoulder]; i < half.length - 1; i++) {
      const [x0, y0] = half[i],
        [x1, y1] = half[i + 1];
      if ((x - x0) * (x - x1) <= 0 && x0 !== x1)
        best = Math.max(best, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
    return Number.isFinite(best) ? best : this.topY(z);
  }
  /** Denser stations through the nose and tail wraps; both sides of every
   * arch edge. */
  override stations(detail: Detail) {
    const [step, fine] = STEP[detail];
    const tailEnd = this.zRear + this.tailWrap,
      noseStart = this.zFront - this.noseWrap;
    const out: number[] = [];
    const run = (a: number, b: number, h: number) => {
      const n = Math.max(1, Math.ceil((b - a) / h));
      for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / n);
    };
    run(this.zRear, tailEnd, fine);
    run(tailEnd, noseStart, step);
    run(noseStart, this.zFront, fine);
    out.push(this.zFront);
    for (const a of this.arches)
      for (const e of [a.z - a.r, a.z + a.r]) out.push(e - 0.0015, e + 0.0015);
    return mergeStations(
      out.sort((p, q) => p - q).filter((z, i, all) => i === 0 || z - all[i - 1] > 0.0008),
      recessStations(this.recesses, detail),
    );
  }
  /** Whether face j at zMid lies in the deep, dark pocket of a scoop or
   * gill (behind its lip, more than half its depth in). */
  private pocket(zMid: number, j: number, detail: Detail) {
    const r = this.recesses.find((q) => onRecessFloor(q, zMid));
    if (!r) return false;
    if (this.slotRing?.z !== zMid || this.slotRing.detail !== detail)
      this.slotRing = { z: zMid, detail, half: this.ring(zMid, detail).half };
    const half = this.slotRing.half,
      y = (half[j][1] + half[j + 1][1]) / 2;
    // A scoop's dark throat lies under its lip (refs 013, 090); its floor
    // behind runs out in paint to the haunch.
    if (r.kind === 'scoop' && zMid < r.front - 0.13) return false;
    return recessAt(r, zMid, y) > r.depth * 0.5;
  }
  override slot(zMid: number, j: number, detail: Detail) {
    const seg = LAYOUT[detail].segment[j];
    if (seg < 0) return -1;
    const fm = this.form,
      arch = !!this.arch(zMid);
    if (seg === 0) return M.floor;
    if (seg === 1) return arch ? M.liner : M.floor;
    if (seg === 2) return arch || fm.rockerDark || fm.cladding ? M.liner : M.paint;
    if (seg === 3) return (arch ? fm.cladding : fm.rockerDark || fm.cladding) ? M.liner : M.paint;
    if (seg < 7 && !arch && this.pocket(zMid, j, detail)) return M.liner;
    const [ws, , , rw] = this.s.cabin;
    if (seg >= 8) {
      if (this.s.style === 'roadster' && zMid < this.f.z(ws) && zMid > this.f.z(rw))
        return M.interior;
      const bed = this.bedSpan();
      if (seg === 9 && bed && zMid > bed[0] && zMid < bed[1]) return -1;
      if (this.s.stripe === 'centre' && seg === 9 && j === LAYOUT[detail].first[10] - 1)
        return M.accent;
    }
    return M.paint;
  }
  override greenhouse(): Greenhouse {
    return new FestivalGreenhouse(this);
  }
  override greenhouseMaterials(paint: T.Material, glass: T.Material): T.Material[] {
    return [paint, glass, sharedMaterials.trim(), festivalGlossBlack()];
  }
  override mirrorAt(side: number): readonly [number, number, number] {
    const zm = this.zWs - 0.17,
      sill = this.sillX(zm);
    return [side * (this.halfWidth(zm) + 0.035), this.surfaceY(zm, sill) + 0.1, zm - 0.055];
  }
  override cabinEdge(z: number): Pt {
    const half = this.ring(z, 0).half,
      sill = this.sillX(z) + 0.02;
    for (let j = this.deckSample(0); j < half.length - 1; j++)
      if (half[j][0] <= sill) return half[j];
    return half[half.length - 2];
  }
  /** Shut lines: front door (behind the front arch), its rear edge at the
   * B-pillar (and a rear door's on a saloon), the hood along its edge crease
   * and at the cowl, the boot / engine lid. */
  override gaps(): PanelGap[] {
    const f = this.f,
      s = this.s,
      [ws, rf, rr, rw] = s.cabin,
      hw = this.halfBase,
      big = 3;
    const door = (zc: number): PanelGap => ({
      n: [0, 0, 1],
      d: zc,
      min: [hw * 0.6, f.y(s.floor + 0.12), zc - 0.02],
      max: [big, f.y(s.belt + 0.32), zc + 0.02],
    });
    const front = Math.min(f.frontAxle - f.radius - 0.12, f.z(ws) - 0.06);
    const out: PanelGap[] = [door(front)];
    if (s.style === 'saloon' && this.form.sill > 0.82 && rr - rf > 0.45) {
      const pillarB = f.z((rf + rr) / 2) - 0.08;
      out.push(
        door(pillarB + 0.05),
        door(pillarB - 0.07),
        door(Math.max(f.rearAxle + f.radius + 0.1, f.z(rr) - 0.05)),
      );
    } else out.push(door(Math.max(f.rearAxle + f.radius + 0.12, f.z((rf + rr) / 2 + 0.12))));
    const cowl = this.zWs + 0.09;
    const hood = this.halfBase * this.form.hoodEdge;
    out.push(
      {
        n: [0, 0, 1],
        d: cowl,
        min: [0, f.y(s.belt), cowl - 0.02],
        max: [hood + 0.01, big, cowl + 0.02],
      },
      {
        n: [1, 0, 0],
        d: hood - 0.012,
        min: [hood - 0.03, f.y(s.belt), this.zFront - 0.35],
        max: [hood + 0.01, big, cowl],
      },
    );
    const lid = this.zRW - 0.08;
    // A pickup's bed stands apart from the cab: a wide, dark gap.
    if (this.form.bed)
      out.push({
        n: [0, 0, 1],
        d: this.zRW - 0.03,
        min: [this.halfBase * 0.5, f.y(s.floor + 0.05), this.zRW - 0.06],
        max: [big, big, this.zRW],
        width: 0.006,
      });
    else
      out.push({
        n: [0, 0, 1],
        d: lid,
        min: [0, f.y(s.belt), lid - 0.02],
        max: [this.halfBase * this.form.deckEdge, big, lid + 0.02],
      });
    void rw;
    // Wider grooves than a race shell: they read at chase-camera distance.
    return out.map((g) => ({ ...g, width: g.width ?? 0.0021 }));
  }
  override addFormDetail(
    parts: Parts,
    mats: CarMaterials,
    detail: Detail,
    lod: BuiltLod,
    gh: Greenhouse | null,
  ) {
    void gh;
    if (this.s.mirrors && detail < 2) addMirrors(parts, this, mats, detail);
    if (this.form.bed) addBed(parts, this, detail);
    if (detail > 1) return;
    // Black lower valance round the tail and a chin under the bumper face.
    const steps = detail === 0 ? 10 : 4,
      plastic = sharedMaterials.plastic();
    // The chin stays below the intakes.
    const front = this.endFloor(false);
    let chin = front + 0.05;
    for (const mouth of festivalFasciaOpenings(this))
      chin = Math.min(chin, mouth.y - mouth.height / 2 - 0.012);
    if (chin > front + 0.02)
      parts.add(endBand(this, false, front + 0.004, chin, 0.3, 0.006, steps), plastic);
    if (this.form.cornerVents) {
      // Beside the main intake, wrapping round onto the bumper's flank.
      const mouths = festivalFasciaOpenings(this);
      if (mouths.length) {
        const lo = Math.min(...mouths.map((m) => m.y - m.height / 2)),
          hi = Math.max(...mouths.map((m) => m.y + m.height / 2)) + 0.02;
        parts.add(
          endBand(this, false, lo, hi, 0.16, 0.005, steps, { inner: 0.075 }),
          sharedMaterials.grille(),
        );
      }
    }
    if (this.form.noseBar) {
      const top = this.topY(this.zFront) - 0.012;
      let lo = top - 0.042;
      for (const mouth of festivalFasciaOpenings(this))
        lo = Math.max(lo, mouth.y + mouth.height / 2 + 0.008);
      if (top - lo > 0.015)
        parts.add(endBand(this, false, lo, top, 0.08, 0.004, steps), festivalGlossBlack());
    }
    if (this.s.splitter > 0) addSplitter(this, detail, lod);
    if (this.s.wing?.kind === 'roof' && gh) addRoofSpoiler(this, gh, mats, detail, lod);
    addFestivalHardware(parts, this, mats, detail, lod, gh);
  }
}

/** Roof spoiler continuing the roof's trailing edge over the hatch glass
 * (refs 061, 091), with small black end fins; detachable with rear damage. */
function addRoofSpoiler(
  model: FestivalBodyModel,
  gh: Greenhouse,
  mats: CarMaterials,
  detail: Detail,
  lod: BuiltLod,
) {
  const z = gh.zRR + 0.02,
    section = gh.control(z),
    rail = section[3][0],
    y = section[section.length - 1][1];
  const depth = 0.18 + (model.s.wing?.chord ?? 0.16) * 0.4,
    seg = detail === 0 ? 2 : 1;
  const parts = new Parts();
  parts.add(
    roundedBox(rail * 2 + 0.03, 0.03, depth, 0.012, seg),
    mats.paint,
    placed(0, y - 0.012, z - depth / 2 + 0.04, 0.1),
  );
  for (const side of [-1, 1])
    parts.add(
      roundedBox(0.014, 0.06, depth * 0.9, 0.005, 1),
      sharedMaterials.plastic(),
      placed(side * (rail + 0.012), y - 0.03, z - depth / 2 + 0.03, 0.1),
    );
  const group = new T.Group();
  group.name = 'Rear wing (detachable)';
  parts.build(group, detail === 0);
  lod.group.add(group);
  lod.rear.push(group);
}

/** Front splitter lip following the bumper's plan outline (detachable). */
function addSplitter(model: FestivalBodyModel, detail: Detail, lod: BuiltLod) {
  const zF = model.zFront,
    y0 = model.endFloor(false) - 0.004,
    reach = 0.42,
    tip = 0.025 + model.s.splitter * 0.35,
    n = detail === 0 ? 12 : 5;
  const right: T.Vector2[] = [];
  for (let k = 0; k <= n; k++) {
    const z = zF - reach + (reach * k) / n;
    right.push(
      new T.Vector2(
        model.sideX(z, y0 + 0.025) + 0.012 + (tip * k) / n,
        z + (tip * k * k) / (n * n),
      ),
    );
  }
  const tipEdge: T.Vector2[] = [];
  const last = right[right.length - 1];
  for (let k = 1; k < 12; k++) tipEdge.push(new T.Vector2(last.x * (1 - (2 * k) / 12), last.y));
  const outline = [...right, ...tipEdge, ...right.map((p) => new T.Vector2(-p.x, p.y)).reverse()];
  const g = new T.ExtrudeGeometry(new T.Shape(outline), { depth: 0.014, bevelEnabled: false });
  g.rotateX(Math.PI / 2).translate(0, y0, 0);
  g.computeVertexNormals();
  const mesh = new T.Mesh(g, sharedMaterials.carbonSatin());
  mesh.name = 'Front element (detachable)';
  mesh.castShadow = detail === 0;
  mesh.receiveShadow = true;
  lod.group.add(mesh);
  lod.front.push(mesh);
}

/** Mirror housings on stalks from the door top (refs 019, 091, 096, 097). */
function addMirrors(parts: Parts, model: FestivalBodyModel, mats: CarMaterials, detail: Detail) {
  const seg = detail === 0 ? 3 : 1;
  for (const side of [-1, 1]) {
    const [x, y, z] = model.mirrorAt(side);
    // Housing ahead of the glass, its outboard end swept back.
    parts.add(
      roundedBox(0.23, 0.115, 0.12, 0.05, seg),
      mats.paint,
      placed(x, y, z + 0.062, 0, side * 0.12),
    );
    parts.add(
      roundedBox(0.2, 0.09, 0.008, 0.016, 1),
      sharedMaterials.trim(),
      placed(x, y, z + 0.004, 0, side * 0.12),
    );
    // Stalk and base on the door top behind the A-pillar foot.
    const zb = z + 0.07,
      xb = model.sillX(zb) + 0.025,
      yb = model.surfaceY(zb, xb);
    parts.add(
      roundedBox(0.05, 0.03, 0.13, 0.012, 1),
      sharedMaterials.trim(),
      placed(side * xb, yb + 0.008, zb),
    );
    const len = Math.abs(x) - 0.07 - xb;
    if (len > 0.01)
      parts.add(
        roundedBox(len + 0.02, 0.022, 0.05, 0.009, 1),
        sharedMaterials.trim(),
        placed(
          side * (xb + len / 2),
          (yb + y) / 2 - 0.01,
          zb - 0.01,
          0,
          0,
          side * Math.atan2(y - yb - 0.02, len),
        ),
      );
  }
}

/** Pickup load bed: liner floor, inner walls under the rails, the cab's
 * front wall and the tailgate's inner skin. */
function addBed(parts: Parts, model: FestivalBodyModel, detail: Detail) {
  const span = model.bedSpan(),
    fm = model.form;
  if (!span || !fm.bed) return;
  const [z0, z1] = span,
    floor = model.f.y(fm.bed.floor),
    liner = sharedMaterials.plastic();
  const n = detail === 0 ? 16 : detail === 1 ? 6 : 2;
  const inner = (z: number) => model.ring(z, 0).half[model.sampleOf(C.inner, 0)];
  const wall: number[] = [];
  let minX = Infinity;
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n,
      [x, top] = inner(z);
    minX = Math.min(minX, x);
    wall.push(x, top, z, x, floor, z);
  }
  for (const side of [-1, 1]) {
    const position: number[] = [],
      index: number[] = [];
    for (let i = 0; i < wall.length; i += 3)
      position.push(side * wall[i], wall[i + 1], wall[i + 2]);
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      // Faces look inboard (toward the bed centre).
      if (side > 0) index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      else index.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    parts.add(g, liner);
  }
  const [, topFront] = inner(z1),
    [, topRear] = inner(z0);
  parts.add(
    roundedBox(minX * 2, 0.02, z1 - z0, 0.004, 1),
    liner,
    placed(0, floor - 0.01, (z0 + z1) / 2),
  );
  parts.add(
    roundedBox(minX * 2, topFront - floor, 0.02, 0.004, 1),
    liner,
    placed(0, (topFront + floor) / 2, z1),
  );
  parts.add(
    roundedBox(minX * 2, topRear - floor, 0.02, 0.004, 1),
    liner,
    placed(0, (topRear + floor) / 2, z0),
  );
}

/** Festival greenhouse: flush side glass on the sill crease, a crisp glass
 * top line under a rounded cantrail, a crowned roof tapering in plan toward
 * the rear window; black frames, A/B pillars and (per form) a black roof. */
export class FestivalGreenhouse extends Greenhouse {
  override base(z: number) {
    const m = this.model;
    return m.surfaceY(z, m.sillX(z)) - 0.01;
  }
  override control(z: number): Pt[] {
    const m = this.model as FestivalBodyModel,
      fm = m.form;
    const b = this.base(z),
      top = Math.max(b + 0.004, this.roof.at(z)),
      sill = m.sillX(z),
      along = clamp((this.zRF - z) / Math.max(0.1, this.zRF - this.zRW), 0, 1),
      hr = Math.min(sill - 0.02, m.s.roofWidth * m.halfBase * (1 - fm.roofTaper * along * along)),
      h = top - b,
      crown = Math.min(0.035, h * 0.1);
    const ctrl: Pt[] = [
      [sill, b],
      [sill + (hr - sill) * 0.5 + Math.min(0.016, h * 0.05), b + h * 0.5],
      [hr + 0.01, top - Math.min(0.032, h * 0.15)],
      [hr - 0.016, top - Math.min(0.004, h * 0.02)],
      [hr * 0.5, top + crown * 0.8],
      [0, top + crown],
    ];
    // Where the roof line runs down to the cowl and the rear deck, the glass
    // edge follows the crowned body under it instead of a flat sill line.
    return ctrl.map(([x, y]) => [x, Math.max(y, m.surfaceY(z, x) - 0.008)] as const);
  }
  override counts(detail: Detail) {
    return [...GH_COUNTS[detail]];
  }
  override rings(detail: Detail, inset = 0): Ring[] {
    const { zWs, zRW } = this;
    const n = Math.max(
      6,
      Math.ceil((zWs - zRW) / (detail === 0 ? 0.035 : detail === 1 ? 0.08 : 0.2)),
    );
    const rings: Ring[] = [];
    for (let i = 0; i <= n; i++) {
      const z = zRW + ((zWs - zRW) * i) / n,
        half = sampleCreased(this.control(z), GH_COUNTS[detail], GH_CREASES);
      rings.push({ z, half: inset ? insetProfile(half, inset) : half });
    }
    return rings;
  }
  override material(detail: Detail) {
    const { zWs, zRF, zRR, zRW } = this,
      m = this.model as FestivalBodyModel,
      fm = m.form,
      s = m.s,
      { first, segment } = GH_LAYOUT[detail];
    const glassTop = first[2],
      pillarB = (zRF + zRR) / 2 - 0.08,
      fastback = s.style === 'supercar' || s.style === 'gt',
      quarter = fm.dlo !== undefined ? m.f.z(fm.dlo) : zRR - (zRR - zRW) * 0.4;
    // 0 paint, 1 glass, 2 trim, 3 gloss black.
    const a = fm.aPillar === 'black' ? 3 : 0,
      bp = fm.bPillar === 'black' ? 3 : 0,
      roof = fm.roof === 'black' ? 3 : 0;
    return (zMid: number, j: number) => {
      if (segment[j] < 0) return -1;
      const side = j < glassTop,
        rail = !side && j < first[3];
      if (zMid > zRF - 0.01) {
        if (zMid > zWs - 0.022) return 2;
        if (j === glassTop - 1 || rail) return a;
        return 1;
      }
      if (zMid < zRR + 0.01) {
        // Fastback sail panels in the roof finish; a saloon's C-pillar behind
        // a quarter window.
        if (side) {
          if (fastback) return roof;
          if (zMid < quarter) return 0;
          return j === glassTop - 1 ? 0 : 1;
        }
        if (rail) return fastback ? roof : 0;
        if (zMid < zRW + 0.035) return 2;
        return 1;
      }
      if (!side) return roof;
      if (zMid < quarter) return 0;
      if (Math.abs(zMid - pillarB) < 0.05) return bp;
      if (j === 0 || j === glassTop - 1) return 2;
      return 1;
    };
  }
  override cantrail(detail: Detail) {
    const counts = GH_COUNTS[detail];
    return counts[0] + counts[1];
  }
}
