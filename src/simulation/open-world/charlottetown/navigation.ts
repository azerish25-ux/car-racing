import type { StreetSurvey, SurveyPoint } from '../survey.ts';

export type CampusDirection = 'forward' | 'return';
export type CampusTurn = 'left' | 'right' | 'arrive';
export interface CampusGuidance {
  valid: boolean;
  direction: CampusDirection;
  destination: string;
  street: string;
  nextStreet: string;
  turn: CampusTurn;
  distanceToTurn: number;
  remaining: number;
  progress: number;
  reference: number;
  offRoute: boolean;
  routeDistance: number;
  wrongWay: boolean;
  arrived: boolean;
}
const LEGS = [
  { at: 0, street: 'Maloney Drive' },
  { at: 9, street: 'Queen Street' },
  { at: 40, street: 'Kent Street' },
  { at: 58, street: 'Weymouth Street' },
] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Guide along the imported 62-vertex campus route, not a straight-line arrow
 * through buildings. This never updates race gates, rewards, or vehicle state.
 * Distances are map estimates. World X points WEST and Z points NORTH. */
export class CampusNavigator {
  readonly length: number;
  private readonly distances: number[] = [0];
  private readonly stations: { id: number; s: number }[];
  constructor(
    private readonly route: readonly SurveyPoint[],
    stations: StreetSurvey['stations'],
  ) {
    if (route.length !== 62 || route.some((p) => !Number.isFinite(p[0] + p[1])))
      throw new Error('Campus navigation needs the versioned 62-vertex route');
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i];
      this.distances.push(this.distances[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.length = this.distances.at(-1)!;
    if (!(this.length > 0)) throw new Error('Campus route must have positive length');
    this.stations = stations
      .filter((p) => Number.isFinite(p.x + p.z))
      .map((p) => ({ id: p.id, s: this.project(p.x, p.z).s }));
  }
  private project(x: number, z: number) {
    let distance2 = Infinity,
      s = 0,
      segment = 0;
    for (let i = 0; i < this.route.length - 1; i++) {
      const a = this.route[i],
        b = this.route[i + 1];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        l2 = dx * dx + dz * dz;
      if (l2 < 1e-10) continue;
      const u = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
      const d2 = (x - a[0] - dx * u) ** 2 + (z - a[1] - dz * u) ** 2;
      if (d2 < distance2) {
        distance2 = d2;
        s = this.distances[i] + u * Math.sqrt(l2);
        segment = i;
      }
    }
    return { s, segment, distance: Math.sqrt(distance2) };
  }
  private pointAt(distance: number): SurveyPoint {
    const s = clamp(distance, 0, this.length);
    for (let i = 1; i < this.route.length; i++) {
      if (s > this.distances[i]) continue;
      const t =
        (s - this.distances[i - 1]) / Math.max(1e-8, this.distances[i] - this.distances[i - 1]);
      const a = this.route[i - 1],
        b = this.route[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    return this.route.at(-1)!;
  }
  sample(
    x: number,
    z: number,
    heading: number,
    speedKmh: number,
    direction: CampusDirection = 'forward',
  ): CampusGuidance {
    const destination = direction === 'forward' ? 'Holland College' : 'Maloney Drive';
    const base: CampusGuidance = {
      valid: false,
      direction,
      destination,
      street: '',
      nextStreet: '',
      turn: 'arrive',
      distanceToTurn: 0,
      remaining: this.length,
      progress: 0,
      reference: 0,
      offRoute: false,
      routeDistance: 0,
      wrongWay: false,
      arrived: false,
    };
    if (![x, z, heading, speedKmh].every(Number.isFinite)) return base;
    const pose = this.project(x, z),
      reverse = direction === 'return';
    const sign = reverse ? -1 : 1;
    const progress = reverse ? this.length - pose.s : pose.s;
    let leg = 0;
    for (let i = 1; i < LEGS.length; i++) if (pose.s >= this.distances[LEGS[i].at]) leg = i;
    const targetLeg = reverse ? leg : leg + 1;
    const hasTurn = reverse ? leg > 0 : targetLeg < LEGS.length;
    const targetS = hasTurn ? this.distances[LEGS[targetLeg].at] : reverse ? 0 : this.length;
    let turn: CampusTurn = 'arrive';
    let nextStreet = destination;
    if (hasTurn) {
      const a = this.pointAt(targetS - 8 * sign),
        b = this.pointAt(targetS),
        c = this.pointAt(targetS + 8 * sign);
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      turn = cross > 0 ? 'right' : 'left'; // X-west coordinate convention, not X-east.
      nextStreet = LEGS[reverse ? targetLeg - 1 : targetLeg].street;
    }
    const a = this.route[pose.segment],
      b = this.route[pose.segment + 1];
    const dx = (b[0] - a[0]) * sign,
      dz = (b[1] - a[1]) * sign;
    const along =
      (Math.sin(heading) * dx + Math.cos(heading) * dz) / Math.max(1e-8, Math.hypot(dx, dz));
    const end = reverse ? this.route[0] : this.route.at(-1)!;
    const remaining = Math.max(0, this.length - progress);
    const arrived = remaining < 8 && Math.hypot(x - end[0], z - end[1]) < 10;
    const offRoute = pose.distance > 12;
    let reference = 0,
      nearestStation = Infinity;
    for (const station of this.stations) {
      const distance = Math.abs(station.s - pose.s);
      if (distance < nearestStation) {
        nearestStation = distance;
        reference = station.id;
      }
    }
    return {
      ...base,
      valid: true,
      street: LEGS[leg].street,
      nextStreet,
      turn,
      distanceToTurn: Math.abs(targetS - pose.s),
      remaining,
      progress: progress / this.length,
      reference,
      offRoute,
      routeDistance: pose.distance,
      wrongWay: !offRoute && !arrived && speedKmh > 8 && along < -0.35,
      arrived,
    };
  }
}
