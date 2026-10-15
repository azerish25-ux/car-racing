import { mod } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { CatalogueMeta, VenueSpan } from '../../simulation/circuit-catalogue/venue-data.ts';
import type { StandSpec, VenuePlan } from '../venue-plan.ts';
import { VENUE_THEMES } from './theme.ts';
import { VenueField } from './field.ts';

/** Catalogue metadata of a track, or null for the bespoke original venues. */
export function catalogueOf(track: Track): CatalogueMeta | null {
  return track.circuit.catalogue ?? null;
}
const fields = new WeakMap<Track, VenueField>();
/** The venue's coarse distance/height field, built once per Track. */
export function venueField(track: Track) {
  let field = fields.get(track);
  if (!field) fields.set(track, (field = new VenueField(track)));
  return field;
}
/** Is lap distance `s` inside a (possibly wrapping) span? */
export function inSpan(span: { from: number; to: number }, s: number, length: number) {
  const x = mod(s, length);
  return span.from <= span.to ? x >= span.from && x <= span.to : x >= span.from || x <= span.to;
}
export function sideSpanAt(
  spans: readonly VenueSpan[],
  s: number,
  side: number,
  length: number,
): boolean {
  for (const span of spans) if (span.side === side && inSpan(span, s, length)) return true;
  return false;
}

/** Pit building frame: garages start before the first box and run past the
 * last; everything sits on the pit side, `depth` metres beyond the lane. */
export function paddockSpan(track: Track) {
  const pit = track.pit;
  const from = pit.firstBox - 18,
    to = pit.firstBox + 11 * pit.boxSpacing + 18;
  return { from, to, side: pit.side, lateral: pit.offset + 9.5 };
}

/** Event-hall plaza radius (venue-landmark.ts LANDMARK.plazaRadius). */
export const PLAZA_RADIUS = 27.5;
const landmarks = new WeakMap<Track, ReturnType<typeof findLandmark>>();
function findLandmark(track: Track) {
  const pit = track.pit,
    p = trackPoint(),
    near = trackPoint();
  const middle = pit.firstBox + 5.5 * pit.boxSpacing;
  for (const lateral of [110, 140, 175, 220, 280])
    for (const side of [pit.side, -pit.side])
      for (const shift of [0, -80, 80, -160, 160, 240]) {
        const s = mod(middle + shift, track.length);
        track.at(s, p);
        const x = p.x + p.nx * side * lateral,
          z = p.z + p.nz * side * lateral;
        let clear = true;
        for (let a = 0; a < 16 && clear; a++)
          for (const r of [0, PLAZA_RADIUS + 12]) {
            const wx = x + Math.cos((a / 16) * Math.PI * 2) * r,
              wz = z + Math.sin((a / 16) * Math.PI * 2) * r;
            const l = track.nearest(wx, wz, near);
            if (Math.abs(l) < track.boundary(near.s, l < 0 ? -1 : 1) + 45) clear = false;
          }
        if (clear) return { x, z, s, yaw: Math.atan2(p.tx, p.tz), y: p.y - 0.9 };
      }
  // Far behind the paddock as a last resort (always clear of the venue).
  track.at(middle, p);
  const lateral = pit.side * 420;
  return {
    x: p.x + p.nx * lateral,
    z: p.z + p.nz * lateral,
    s: middle,
    yaw: Math.atan2(p.tx, p.tz),
    y: p.y - 0.9,
  };
}
/** The catalogue venue's event-hall plaza: a clear, levelled site behind the
 * paddock (the kit terrain flattens it). */
export function catalogueLandmark(track: Track) {
  let site = landmarks.get(track);
  if (!site) landmarks.set(track, (site = findLandmark(track)));
  return site;
}

const plans = new WeakMap<Track, VenuePlan>();
/** VenuePlan for a catalogue layout, derived from its data: authored stands
 * (or the start straight and slowest corners), fictional signage, no
 * districts or service compounds (the kit dresses those itself). */
export function catalogueVenuePlan(track: Track): VenuePlan {
  const known = plans.get(track);
  if (known) return known;
  const meta = track.circuit.catalogue!,
    style = VENUE_THEMES[meta.theme],
    paddock = paddockSpan(track);
  const stands: StandSpec[] = [];
  const clearOfPaddock = (s: number, side: number) =>
    side !== paddock.side ||
    !inSpan({ from: paddock.from - 60, to: paddock.to + 60 }, s, track.length);
  // Main straight opposite the paddock.
  stands.push(
    { s: -60, side: -track.pit.side, length: 64 },
    { s: 40, side: -track.pit.side, length: 80 },
  );
  for (const span of meta.dressing.stands) {
    const s = mod(span.from + mod(span.to - span.from, track.length) / 2, track.length);
    if (!clearOfPaddock(s, span.side)) continue;
    if (
      stands.some(
        (o) => Math.abs(mod(o.s - s + track.length / 2, track.length) - track.length / 2) < 90,
      )
    )
      continue;
    stands.push({ s: Math.round(s), side: span.side, length: Math.round(span.length) });
    if (stands.length >= style.stands + 2) break;
  }
  const plan: VenuePlan = Object.freeze({
    grandstands: Object.freeze(stands.filter((site) => standClear(track, site))),
    serviceZones: Object.freeze([]),
    districts: Object.freeze([]),
    districtRelief: 0.5,
    plantingZones:
      style.planting ??
      Object.freeze([{ endFraction: 1, canopyRatio: 0.84, species: 'broadleaf' }]),
    signs: Object.freeze([
      {
        text: style.sponsor,
        s: 300,
        lateral: -(track.boundary(300, -1) + 6),
        width: 18,
        height: 2,
      },
    ]),
    brakingBoards: Object.freeze([]),
    gantryLabel: track.circuit.name,
    landmark: 'event-hall',
  } as VenuePlan);
  plans.set(track, plan);
  return plan;
}
/** A stand's deck must not overlap another section's corridor. */
function standClear(track: Track, site: StandSpec) {
  const p = track.at(mod(site.s, track.length), trackPoint()),
    near = trackPoint();
  const base = site.side * (track.boundary(site.s, site.side) + 7);
  for (const u of [-2, 6, 13])
    for (const v of [-site.length / 2, 0, site.length / 2]) {
      const l0 = base + site.side * u,
        x = p.x + p.nx * l0 + p.tx * v,
        z = p.z + p.nz * l0 + p.tz * v;
      const l = track.nearest(x, z, near);
      const gap = Math.abs(mod(near.s - p.s + track.length / 2, track.length) - track.length / 2);
      if (gap > 80 && Math.abs(l) < track.boundary(near.s, l < 0 ? -1 : 1) + 4) return false;
    }
  return true;
}
