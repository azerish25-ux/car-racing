/** Longitudinal relief of an off-road course (WP37/WP39, masterplan §9.2):
 * jumps, tabletops, doubles/triples, step-ups, rollers, whoops and crests
 * are one piecewise-linear height profile along lap distance whose knots are
 * rounded by quadratic fillets (C1: no slope step anywhere, so a lip is a
 * tight radius, never a crease). The same profile feeds the contact query,
 * the rendered terrain, the AI jump planner and the landing licence survey.
 * Lengths in m along the lap, heights in m above the base ground, angles rad. */
export interface ProfileKnot {
  s: number;
  h: number;
  /** Fillet half-length (m) rounding the slope change at this knot. */
  r: number;
}
/** A surveyed jump: where the lip is, the face angle a rider leaves on, and
 * the landing zone on the far face (the career landing licence reads the
 * same `takeoff`/`landing`/`landingLength`/`landingPitch` fields). */
export interface JumpSurvey {
  name: string;
  kind: JumpKind;
  /** Lap distance of the foot of the take-off face. */
  start: number;
  /** Lap distance and height of the lip. */
  takeoff: number;
  lipHeight: number;
  /** Face angle at the lip (rad, nose-up +). */
  lipAngle: number;
  /** Centre of the landing zone, its length along the lap and its slope
   * (rad, nose-up +, so a downslope landing is negative). */
  landing: number;
  landingLength: number;
  landingPitch: number;
  /** Ground height at the landing zone centre. */
  landingHeight: number;
  /** Lap distance where the feature ends (back at base ground). */
  end: number;
  /** Lap distance and height of the safe short landing (tabletop deck or the
   * backside of a take-off mound) for a rider who cannot clear the gap. */
  rollEnd: number;
  /** Clearing is optional (tabletop deck, step-up deck): a short landing is safe. */
  forgiving: boolean;
}
export type JumpKind = 'tabletop' | 'double' | 'triple' | 'step-up' | 'kicker' | 'crest';
export interface JumpOptions {
  name: string;
  kind: JumpKind;
  /** Lap distance of the foot of the take-off face. */
  at: number;
  /** Lip height and face angle (degrees). */
  height: number;
  face: number;
  /** Tabletop deck / gap between mounds (m, horizontal). */
  gap: number;
  /** Landing mound height (defaults to the lip height) and landing face angle (degrees). */
  landingHeight?: number;
  landing?: number;
}
export interface WhoopsOptions {
  at: number;
  count: number;
  spacing: number;
  height: number;
}
const DEG = Math.PI / 180;

/** Fillet-rounded polyline profile with a binary-search lookup. */
export class LongitudinalProfile {
  readonly knots: readonly ProfileKnot[];
  private readonly s: Float64Array;
  private readonly h: Float64Array;
  private readonly r: Float64Array;
  private readonly slope: Float64Array;
  constructor(knots: readonly ProfileKnot[]) {
    const sorted = [...knots].sort((a, b) => a.s - b.s);
    for (let i = 1; i < sorted.length; i++)
      if (!(sorted[i].s > sorted[i - 1].s)) throw new Error('Profile knots must be distinct');
    // A fillet may use at most half the run to each neighbour.
    const fixed = sorted.map((k, i) => {
      const before = i > 0 ? k.s - sorted[i - 1].s : Infinity,
        after = i < sorted.length - 1 ? sorted[i + 1].s - k.s : Infinity;
      return { ...k, r: Math.max(0, Math.min(k.r, before / 2, after / 2)) };
    });
    this.knots = Object.freeze(fixed.map((k) => Object.freeze(k)));
    const n = fixed.length;
    this.s = Float64Array.from(fixed, (k) => k.s);
    this.h = Float64Array.from(fixed, (k) => k.h);
    this.r = Float64Array.from(fixed, (k) => k.r);
    this.slope = new Float64Array(Math.max(0, n - 1));
    for (let i = 0; i < n - 1; i++)
      this.slope[i] = (this.h[i + 1] - this.h[i]) / (this.s[i + 1] - this.s[i]);
  }
  /** Height and slope at lap distance s (0 outside the profile). */
  evaluate(s: number, out: { h: number; dh: number }) {
    const S = this.s,
      n = S.length;
    out.h = 0;
    out.dh = 0;
    if (n < 2 || s <= S[0] - this.r[0] || s >= S[n - 1] + this.r[n - 1]) return out;
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    // The nearest knot whose fillet contains s, else the straight run.
    for (const k of [lo, hi]) {
      const r = this.r[k];
      if (r > 0 && Math.abs(s - S[k]) < r) {
        const m1 = k > 0 ? this.slope[k - 1] : 0,
          m2 = k < n - 1 ? this.slope[k] : 0,
          d = s - S[k];
        out.h = this.h[k] + m1 * d + ((m2 - m1) * (d + r) * (d + r)) / (4 * r);
        out.dh = m1 + ((m2 - m1) * (d + r)) / (2 * r);
        return out;
      }
    }
    if (s < S[0] || s > S[n - 1]) return out;
    const m = this.slope[lo];
    out.h = this.h[lo] + m * (s - S[lo]);
    out.dh = m;
    return out;
  }
}

/** Builds a course profile and its jump survey from authored features. */
export class ProfileBuilder {
  readonly knots: ProfileKnot[] = [];
  readonly jumps: JumpSurvey[] = [];
  /** Spans that are rough enough to stand on the pegs (whoops, chop). */
  readonly rough: { from: number; to: number }[] = [];
  private last = -Infinity;
  private push(s: number, h: number, r: number) {
    if (!(s > this.last + 1e-6)) throw new Error(`Profile features overlap at ${s.toFixed(1)} m`);
    this.knots.push({ s, h, r });
    this.last = s;
  }
  /** One jump: take-off face, then a deck (tabletop/step-up) or a gap and a
   * landing mound (double/triple), then a landing face back to the ground. */
  jump(o: JumpOptions) {
    const face = o.face * DEG,
      run = o.height / Math.tan(face),
      landAngle = (o.landing ?? 28) * DEG,
      landH = o.landingHeight ?? o.height;
    const start = o.at,
      lip = start + run;
    // A long concave transition at the foot (the suspension takes the face
    // progressively) and a tight, defined lip.
    this.push(start, 0, 2.6);
    this.push(lip, o.height, o.kind === 'crest' ? 4 : 0.45);
    let landing: number,
      landingLength: number,
      landingHeight: number,
      end: number,
      rollEnd: number,
      forgiving: boolean;
    if (o.kind === 'tabletop' || o.kind === 'step-up' || o.kind === 'crest') {
      // Flat deck at the landing height, then the landing face.
      const deckEnd = lip + o.gap,
        down = landH / Math.tan(landAngle);
      if (Math.abs(landH - o.height) > 0.01) this.push(lip + 1.2, landH, 0.4);
      this.push(deckEnd, landH, o.kind === 'crest' ? 4 : 0.6);
      end = deckEnd + down;
      this.push(end, 0, 1.4);
      landing = deckEnd + down * 0.35;
      landingLength = down * 0.7;
      landingHeight = landH * 0.65;
      rollEnd = deckEnd;
      forgiving = true;
    } else if (o.kind === 'kicker') {
      // A short kicker with a backside: the landing is the flat ground beyond.
      const back = o.height / Math.tan(35 * DEG);
      this.push(lip + back, 0, 0.8);
      landing = lip + back + o.gap * 0.5;
      landingLength = Math.max(4, o.gap);
      landingHeight = 0;
      end = lip + back;
      rollEnd = lip + back;
      forgiving = true;
    } else {
      // Double / triple: the take-off mound's backside, the gap (with the
      // middle mounds of a triple), then the landing mound.
      const back = o.height / Math.tan(38 * DEG),
        up = landH / Math.tan(32 * DEG),
        down = landH / Math.tan(landAngle);
      this.push(lip + back, 0, 0.7);
      const gapEnd = lip + o.gap;
      if (o.kind === 'triple') {
        // A middle mound filling the gap: a short landing is a crash too.
        const mid = (lip + back + gapEnd - up) / 2,
          half = Math.min(landH / Math.tan(32 * DEG), (gapEnd - up - lip - back) / 2 - 0.5);
        if (half > 0.6) {
          this.push(mid - half, 0, 0.6);
          this.push(mid, Math.min(landH, half * Math.tan(32 * DEG)), 0.35);
          this.push(mid + half, 0, 0.6);
        }
      }
      this.push(gapEnd - up, 0, 0.8);
      this.push(gapEnd, landH, 0.45);
      end = gapEnd + down;
      this.push(end, 0, 1.4);
      landing = gapEnd + down * 0.4;
      landingLength = down * 0.7;
      landingHeight = landH * 0.6;
      rollEnd = lip + back;
      forgiving = false;
    }
    this.jumps.push({
      name: o.name,
      kind: o.kind,
      start,
      takeoff: lip,
      lipHeight: o.height,
      lipAngle: face,
      landing,
      landingLength,
      landingPitch: o.kind === 'kicker' ? 0 : -landAngle,
      landingHeight,
      end,
      rollEnd,
      forgiving,
    });
    return end;
  }
  /** Rollers: smooth bumps a rider can double or skim. */
  rollers(o: WhoopsOptions) {
    for (let i = 0; i < o.count; i++) {
      const a = o.at + i * o.spacing;
      this.push(a, 0, o.spacing * 0.25);
      this.push(a + o.spacing / 2, o.height, o.spacing * 0.25);
    }
    const end = o.at + o.count * o.spacing;
    this.push(end, 0, o.spacing * 0.25);
    this.rough.push({ from: o.at, to: end });
    return end;
  }
  /** Whoops: a row of close, steep bumps (skimmed at speed, standing). */
  whoops(o: WhoopsOptions) {
    for (let i = 0; i < o.count; i++) {
      const a = o.at + i * o.spacing;
      this.push(a, 0, o.spacing * 0.18);
      this.push(a + o.spacing / 2, o.height, o.spacing * 0.22);
    }
    const end = o.at + o.count * o.spacing;
    this.push(end, 0, o.spacing * 0.18);
    this.rough.push({ from: o.at, to: end });
    return end;
  }
  build() {
    return { profile: new LongitudinalProfile(this.knots), jumps: this.jumps, rough: this.rough };
  }
}
/** Ballistic take-off speed (m/s) that carries a point from a lip at angle
 * `angle` across `distance` metres to a landing `drop` metres below the lip
 * (negative: above). NaN when the target lies above the launch line. */
export function takeoffSpeed(distance: number, drop: number, angle: number, g = 9.80665) {
  const c = Math.cos(angle),
    rise = distance * Math.tan(angle) + drop;
  if (!(distance > 0) || !(rise > 0)) return NaN;
  return Math.sqrt((g * distance * distance) / (2 * c * c * rise));
}
/** Horizontal flight distance (m) from a lip at `angle` and `speed` to the
 * first point `drop` metres below the lip (negative: above). */
export function flightDistance(speed: number, drop: number, angle: number, g = 9.80665) {
  const vx = speed * Math.cos(angle),
    vy = speed * Math.sin(angle),
    disc = vy * vy + 2 * g * drop;
  if (disc < 0) return NaN;
  return (vx * (vy + Math.sqrt(disc))) / g;
}
