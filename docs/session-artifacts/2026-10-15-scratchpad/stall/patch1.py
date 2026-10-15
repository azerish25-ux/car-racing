import re,sys
p='src/simulation/traffic.ts'
s=open(p).read()

s=s.replace("""import { approach, clamp, mod, Random } from '../core/math.ts';""","""import { approach, clamp, mod, Random, Vec3 } from '../core/math.ts';""")

s=s.replace("""export interface TrafficPlan {""","""/** A car ahead that has stayed below `speed` (m/s along the track) for
 * `seconds` (stalled on the grid, spun, recovering, crawling) will not clear
 * the lane by itself: following it would mean waiting behind it for ever.
 * Cars behind it hold `holdGap` back (bumper to bumper), room to steer out at
 * low speed, until a lane past it is free of traffic, then take that lane:
 * at `creep` while their nose still overlaps it, stopping `contactGap` short
 * of it should the swerve not have cleared it. A lane past it leaves
 * `sideMargin` beyond both bodies (its heading included: a spun car is wide).
 * A lane that ends behind it costs `blockedCost`, more than any lane change. */
export const STALLED = Object.freeze({
  speed: 3,
  seconds: 1.5,
  holdGap: 4,
  creep: 2,
  contactGap: 0.8,
  sideMargin: 0.8,
  blockedCost: 30,
});
export interface TrafficPlan {""")

s=s.replace("""  private candidates = new Float64Array(6);""","""  private candidates = new Float64Array(8);
  /** Last time each car (by id) was seen moving along the track (STALLED). */
  private movingAt = new Float64Array(0);
  /** Per car id: stalled ahead this evaluation (1), with its footprint. */
  private stalled = new Uint8Array(0);
  private across = new Float64Array(0);
  private along = new Float64Array(0);
  private axis = new Vec3();
  /** The stalled car being passed (its id) this evaluation, or -1. */
  bypass = -1;
  /** The stalled car this car is held behind, waiting for a free lane, or -1. */
  waiting = -1;""")
open(p,'w').write(s)
