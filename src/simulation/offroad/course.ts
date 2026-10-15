import { clamp, mod, smooth } from '../../core/math.ts';
import { MATERIAL } from '../surface-material.ts';
import type { Track, TrackPoint } from '../track.ts';
import { LongitudinalProfile, type JumpSurvey } from './profile.ts';
import type { OffroadKind } from './types.ts';

/** Off-road course data (WP37-WP41): everything a terrain venue adds to its
 * catalogue centreline — the longitudinal jump profile, berms, soil kinds,
 * moisture, the rallycross joker road, the motocross start gate and the
 * rally stage controls. All stations are lap distances (m) of the built
 * Track; laterals use the Track's sign. The geometry here is static; the
 * deformable state (ruts, compaction) lives in CourseTerrain. */
export type SoilKind = 'hardpack' | 'loam' | 'sand' | 'mud' | 'gravel' | 'asphalt' | 'turf';
export const SOIL_KINDS: readonly SoilKind[] = Object.freeze([
  'hardpack',
  'loam',
  'sand',
  'mud',
  'gravel',
  'asphalt',
  'turf',
]);
export interface SoilProperties {
  /** Shared ground-material id (surface-material.ts). */
  material: number;
  /** Friction scale on top of the material's own grip (compaction state). */
  grip: number;
  /** Deformability: depression per unit load relative to loam (0 = rigid). */
  softness: number;
}
/** Original engineering estimates per soil kind (not measured soil data). */
export const SOILS: Readonly<Record<SoilKind, SoilProperties>> = Object.freeze({
  hardpack: Object.freeze({ material: MATERIAL.DIRT, grip: 1.1, softness: 0.4 }),
  loam: Object.freeze({ material: MATERIAL.DIRT, grip: 1, softness: 1 }),
  sand: Object.freeze({ material: MATERIAL.SAND, grip: 1, softness: 1.6 }),
  mud: Object.freeze({ material: MATERIAL.MUD, grip: 1, softness: 2.2 }),
  gravel: Object.freeze({ material: MATERIAL.GRAVEL_ROAD, grip: 1, softness: 0.55 }),
  asphalt: Object.freeze({ material: MATERIAL.ASPHALT, grip: 1, softness: 0 }),
  turf: Object.freeze({ material: MATERIAL.GRASS, grip: 1, softness: 0.25 }),
});
export interface SoilZone {
  from: number;
  to: number;
  soil: SoilKind;
  /** Lateral range (m, Track sign); absent: the whole terrain band. */
  lateral?: readonly [number, number];
  /** Extra moisture (watering, a spring line) 0..1. */
  moisture?: number;
}
export interface BermSpec {
  from: number;
  to: number;
  /** Height of the berm wall at the outer track edge (m). */
  height: number;
  /** Lateral side of the wall; absent: the outside of the corner. */
  side?: 1 | -1;
}
export interface JokerSpec {
  /** Lap distances where the joker road leaves and rejoins the lap. */
  from: number;
  to: number;
  /** Side (Track lateral sign) and centre offset of the joker road (m). */
  side: 1 | -1;
  offset: number;
  halfWidth: number;
  /** Length over which the road swings out and back (m). */
  ramp: number;
  soil: SoilKind;
}
export interface GateSpec {
  /** Lap distance of the gate line (front wheels behind it). */
  s: number;
  slots: number;
  spacing: number;
  /** Lap distance of the holeshot line (first corner entry). */
  holeshot: number;
}
export interface StageSpec {
  /** Start control, split points and the flying finish (lap distances). */
  start: number;
  splits: readonly number[];
  finish: number;
  /** Stop control: finished cars park beyond it, off the road. */
  stop: number;
  /** Seconds between starters. */
  interval: number;
}
export interface OffroadCourseSpec {
  kind: OffroadKind;
  /** Base soil on the course and off it (beyond the legal edges). */
  soil: SoilKind;
  offTrack: SoilKind;
  zones: readonly SoilZone[];
  /** Base moisture of the prepared soil 0..1. */
  moisture: number;
  berms: readonly BermSpec[];
  /** Stand-up roughness spans (whoops, chop) beyond the profile's own. */
  rough?: readonly { from: number; to: number }[];
  /** Small-scale chop amplitude in rough spans (m). */
  chop?: number;
  joker?: JokerSpec;
  gate?: GateSpec;
  stage?: StageSpec;
  /** Covered stadium floor (supercross): rain never reaches it. */
  indoor?: boolean;
}
/** Lateral band (m) the deformable grid covers beyond the widest legal road. */
/** Legal width beyond the groomed surface to the course tape (m). */
const TAPE_MARGIN = 0.8;
/** Legal width a berm adds on its outside (m). */
const BERM_ALLOWANCE = 1.6;
export const BAND_MARGIN = 6;
export const COURSE_CELL = Object.freeze({ lateral: 0.25, along: 0.5 });
/** A built course: static geometry queries shared by physics, AI and render. */
export class OffroadCourse {
  readonly kind: OffroadKind;
  readonly profile: LongitudinalProfile;
  readonly jumps: readonly JumpSurvey[];
  readonly rough: readonly { from: number; to: number }[];
  private readonly scratch = { h: 0, dh: 0 };
  constructor(
    readonly spec: OffroadCourseSpec,
    profile: LongitudinalProfile,
    jumps: readonly JumpSurvey[],
    rough: readonly { from: number; to: number }[],
    readonly length: number,
  ) {
    this.kind = spec.kind;
    this.profile = profile;
    this.jumps = Object.freeze([...jumps]);
    this.rough = Object.freeze([...rough, ...(spec.rough ?? [])]);
  }
  /** Lateral band covered by the terrain grid for a road of max half-width `w`. */
  band(maxWidth: number): [number, number] {
    let lo = -(maxWidth + BAND_MARGIN),
      hi = maxWidth + BAND_MARGIN;
    const j = this.spec.joker;
    if (j) {
      const outer = j.offset + j.halfWidth + 2;
      if (j.side > 0) hi = Math.max(hi, outer);
      else lo = Math.min(lo, -outer);
    }
    return [lo, hi];
  }
  /** Joker road centre (Track lateral) at lap distance s, or null away from it. */
  jokerCentre(s: number): number | null {
    const j = this.spec.joker;
    if (!j || !inSpan(s, j.from, j.to, this.length)) return null;
    const into = mod(s - j.from, this.length),
      span = mod(j.to - j.from, this.length),
      env = smooth(0, j.ramp, into) * (1 - smooth(span - j.ramp, span, into));
    return j.side * j.offset * env;
  }
  /** Is (s, lateral) on the joker road? */
  onJoker(s: number, lateral: number) {
    const c = this.jokerCentre(s);
    return c !== null && Math.abs(lateral - c) <= this.spec.joker!.halfWidth;
  }
  /** Legal half-width at (s, lateral): the main road, or the joker road a
   * wheel is on (so a car on the joker is not outside the track). */
  legalWidth(width: number, s: number, lateral: number) {
    // The course is marked by tape and stakes beyond the groomed width, and
    // a berm's face is track: riders use it to its lip.
    width += TAPE_MARGIN;
    const at = mod(s, this.length);
    for (const b of this.spec.berms)
      if (inSpan(at, b.from, b.to, this.length) && (b.side ?? 0) * lateral > 0) {
        width += BERM_ALLOWANCE;
        break;
      }
    const c = this.jokerCentre(s);
    if (c === null) return width;
    const half = this.spec.joker!.halfWidth;
    return Math.abs(lateral - c) <= half ? Math.max(width, Math.abs(c) + half) : width;
  }
  /** Relief above the Track's base cross-section at a station: the jump
   * profile (faded at the sides), berm walls, the joker island and chop.
   * Returns the height and its derivatives along s and across. */
  relief(s: number, lateral: number, p: TrackPoint, out: Relief) {
    s = mod(s, this.length);
    const w = p.width,
      f = this.profile.evaluate(s, this.scratch);
    // Jump sides fall away beyond the track edge (built faces, not walls).
    const a = Math.abs(lateral),
      fade = 1 - smooth(w + 0.4, w + 3.4, a),
      dFade = -dSmooth(w + 0.4, w + 3.4, a) * Math.sign(lateral);
    let h = f.h * fade,
      ds = f.dh * fade,
      dl = f.h * dFade;
    for (const b of this.spec.berms) {
      if (!inSpan(s, b.from, b.to, this.length)) continue;
      const side = b.side ?? (p.curvature > 0 ? -1 : 1),
        into = mod(s - b.from, this.length),
        span = mod(b.to - b.from, this.length),
        ramp = Math.min(7, span / 3),
        env = smooth(0, ramp, into) * (1 - smooth(span - ramp, span, into)),
        dEnv = dSmooth(0, ramp, into) * (1 - smooth(span - ramp, span, into)) -
          smooth(0, ramp, into) * dSmooth(span - ramp, span, into);
      // Wall rising toward the outside edge, then its back falling away.
      const out = side * lateral,
        inner = w * 0.15,
        reach = w * 1.05 + 1.1,
        t = clamp((out - inner) / reach, 0, 1),
        wall = t ** 1.8,
        dWall = t > 0 && t < 1 ? (1.8 * t ** 0.8) / reach : 0,
        back = 1 - smooth(w + 1.2, w + 3.6, out),
        dBack = -dSmooth(w + 1.2, w + 3.6, out),
        shape = wall * back,
        dShape = (dWall * back + wall * dBack) * side;
      h += b.height * shape * env;
      ds += b.height * shape * dEnv;
      dl += b.height * dShape * env;
    }
    const joker = this.jokerCentre(s);
    if (joker !== null) {
      // A low turf island between the lap and the joker road.
      const half = this.spec.joker!.halfWidth,
        side = this.spec.joker!.side,
        gap = side * (joker - lateral);
      if (Math.abs(joker) > w + half + 1) {
        const lo = half + 0.6,
          hi = Math.abs(joker) - w - 0.6,
          bump = hi > lo ? smooth(lo, lo + 0.8, gap) * (1 - smooth(hi - 0.8, hi, gap)) : 0;
        h += 0.22 * bump;
      }
    }
    if (this.spec.chop && this.isRough(s) && a < w) {
      // Braking chop: short deterministic bumps across the line.
      const k1 = (Math.PI * 2) / 1.7,
        k2 = (Math.PI * 2) / 0.9;
      h += this.spec.chop * (0.6 * Math.sin(s * k1) * Math.cos(lateral * 1.3) + 0.4 * Math.sin(s * k2 + lateral));
      ds += this.spec.chop * (0.6 * k1 * Math.cos(s * k1) * Math.cos(lateral * 1.3) + 0.4 * k2 * Math.cos(s * k2 + lateral));
      dl += this.spec.chop * (-0.6 * 1.3 * Math.sin(s * k1) * Math.sin(lateral * 1.3) + 0.4 * Math.cos(s * k2 + lateral));
    }
    out.h = h;
    out.ds = ds;
    out.dl = dl;
    return out;
  }
  isRough(s: number) {
    s = mod(s, this.length);
    for (const r of this.rough) if (inSpan(s, r.from, r.to, this.length)) return true;
    return false;
  }
  /** Soil kind and extra moisture at (s, lateral) on a road of half-width w. */
  soilAt(s: number, lateral: number, width: number): { soil: SoilKind; moisture: number } {
    s = mod(s, this.length);
    const spec = this.spec;
    const onJoker = this.onJoker(s, lateral);
    let soil: SoilKind = Math.abs(lateral) <= width + 0.6 || onJoker ? spec.soil : spec.offTrack;
    if (onJoker && spec.joker) soil = spec.joker.soil;
    let moisture = 0;
    for (const z of spec.zones) {
      if (!inSpan(s, z.from, z.to, this.length)) continue;
      if (z.lateral && (lateral < z.lateral[0] || lateral > z.lateral[1])) continue;
      soil = z.soil;
      moisture = Math.max(moisture, z.moisture ?? 0);
    }
    return { soil, moisture };
  }
  /** The jump whose take-off face or flight path covers lap distance s. */
  jumpAt(s: number) {
    s = mod(s, this.length);
    return this.jumps.find((j) => s >= j.start - 1 && s <= j.end + 1) ?? null;
  }
  /** Next jump take-off foot at or after s (wrapping), with its distance. */
  nextJump(s: number) {
    let best: JumpSurvey | null = null,
      distance = Infinity;
    for (const j of this.jumps) {
      const d = mod(j.start - s, this.length);
      if (d < distance) {
        distance = d;
        best = j;
      }
    }
    return best ? { jump: best, distance } : null;
  }
}
export interface Relief {
  h: number;
  ds: number;
  dl: number;
}
export const relief = (): Relief => ({ h: 0, ds: 0, dl: 0 });
/** Is s inside [from, to] on a lap of `length` (spans may wrap)? */
export function inSpan(s: number, from: number, to: number, length: number) {
  const a = mod(from, length),
    b = mod(to, length),
    x = mod(s, length);
  return a <= b ? x >= a && x <= b : x >= a || x <= b;
}
function dSmooth(a: number, b: number, x: number) {
  if (x <= a || x >= b) return 0;
  const t = (x - a) / (b - a);
  return (6 * t * (1 - t)) / (b - a);
}
/** Static height of the ground at (s, lateral) without ruts. */
export function groundHeight(track: Track, course: OffroadCourse, s: number, lateral: number, p: TrackPoint, r: Relief) {
  track.at(s, p);
  course.relief(s, lateral, p, r);
  return p.y + p.bank * clamp(lateral, -12, 12) + r.h;
}
