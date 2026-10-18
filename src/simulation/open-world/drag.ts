import type { DragSlip } from './festival-result.ts';

/** Drag racing on the Kestrel strip (FH6 ref 077/078/079), timed as a real
 * strip times it: a full ("sportsman") tree — pre-stage and stage lamps, an
 * automatic start after a random delay, three ambers 0.5 s apart and green
 * 0.5 s after the last — then, per lane, reaction time from green to the
 * front tyre leaving the stage beam (a car that leaves before green has red-
 * lit and is disqualified), 60 ft, eighth-mile and quarter-mile times from
 * leaving the line, and the trap speed over the last 66 ft before the
 * finish. Pure timing; the session drives the cars. */
export const DRAG = Object.freeze({
  /** The stage lamps light this long after the cars are placed (s). */
  stage: 1,
  /** Auto-start delay between staging and the first amber (s), drawn per
   * run so the green cannot be anticipated from the clock. */
  delay: Object.freeze([0.6, 1.4] as const),
  /** Full tree: three ambers this far apart, green one step after the last. */
  amber: 0.5,
  /** Lanes across the runway and their spacing (m). */
  lanes: 4,
  lane: 5,
  /** Roll-out (m): the front tyre leaves the stage beam after moving this far. */
  rollout: 0.3,
  /** Timing marks (m from the line). */
  sixtyFoot: 18.288,
  eighthMile: 201.168,
  /** Trap length before the finish (66 ft). */
  trap: 20.1168,
  /** A lane that has not left the line this long after green, or not
   * finished this long after green, is out of the run (s). */
  noShow: 10,
  limit: 45,
  /** Results wait at most this long after the player's finish for the
   * other lanes to finish (s). */
  settle: 4,
});

/** Simulation times of one run's tree. */
export interface DragTree {
  /** Pre-stage lamps from `prestage`, stage lamps from `staged`. */
  prestage: number;
  staged: number;
  ambers: readonly [number, number, number];
  green: number;
}
/** The tree for a run set up at `time`; `draw` in [0, 1) picks the
 * auto-start delay (deterministic per seed and run). */
export function dragTree(time: number, draw: number): DragTree {
  const [lo, hi] = DRAG.delay,
    staged = time + DRAG.stage,
    first = staged + lo + (hi - lo) * Math.min(0.999, Math.max(0, draw));
  return {
    prestage: time,
    staged,
    ambers: [first, first + DRAG.amber, first + 2 * DRAG.amber],
    green: first + 3 * DRAG.amber,
  };
}
/** Lamp rows of one lane's tree column, top to bottom. */
export const TREE_ROWS = Object.freeze([
  'prestage',
  'stage',
  'amber',
  'amber',
  'amber',
  'green',
  'red',
] as const);
/** Lit rows of a lane's column at `time` (TREE_ROWS order): pre-stage and
 * stage until the car rolls out of the beams, a full tree's ambers one at a
 * time down the tree, green at the start; a lane that left early shows red
 * from that moment and never its green. */
export function treeLamps(tree: DragTree, time: number, leftAt: number | null): boolean[] {
  const fouled = leftAt !== null && leftAt < tree.green;
  const launched = leftAt !== null && time >= leftAt;
  const amber = (k: number) =>
    time >= tree.ambers[k] && time < (k < 2 ? tree.ambers[k + 1] : tree.green);
  return [
    time >= tree.prestage && !launched,
    time >= tree.staged && !launched,
    amber(0),
    amber(1),
    amber(2),
    time >= tree.green && !fouled,
    fouled && launched,
  ];
}

/** One lane's timing: feed it the front bumper's distance past the line
 * every step; crossing times are interpolated between steps, so the slip
 * does not depend on the step rate. */
export class DragTimer {
  /** Simulation time the front left the stage beam (null: still staged). */
  leftAt: number | null = null;
  sixtyFoot: number | null = null;
  eighthMile: number | null = null;
  trapAt: number | null = null;
  finishAt: number | null = null;
  private lastTime = NaN;
  private lastDistance = NaN;
  constructor(readonly finish: number) {}
  /** The last distance fed (m; 0 before the first). */
  get distance() {
    return Number.isFinite(this.lastDistance) ? this.lastDistance : 0;
  }
  /** `distance`: front bumper past the start line (m), at `time`. */
  update(time: number, distance: number) {
    if (!Number.isFinite(time) || !Number.isFinite(distance)) return;
    const t0 = this.lastTime,
      d0 = this.lastDistance;
    this.lastTime = time;
    this.lastDistance = distance;
    if (!Number.isFinite(t0) || this.finishAt !== null) return;
    const cross = (mark: number) =>
      d0 < mark && distance >= mark
        ? t0 + ((mark - d0) / Math.max(1e-9, distance - d0)) * (time - t0)
        : null;
    this.leftAt ??= cross(DRAG.rollout);
    this.sixtyFoot ??= cross(DRAG.sixtyFoot);
    this.eighthMile ??= cross(Math.min(DRAG.eighthMile, this.finish));
    this.trapAt ??= cross(this.finish - DRAG.trap);
    this.finishAt ??= cross(this.finish);
  }
  /** The timing slip for this lane against the tree's green. */
  slip(lane: number, green: number): DragSlip {
    const from = this.leftAt,
      since = (t: number | null) => (t !== null && from !== null ? t - from : null);
    const trap =
      this.finishAt !== null && this.trapAt !== null && this.finishAt > this.trapAt
        ? (DRAG.trap / (this.finishAt - this.trapAt)) * 3.6
        : null;
    return {
      lane,
      reaction: from !== null ? from - green : null,
      redLight: from !== null && from < green,
      sixtyFoot: since(this.sixtyFoot),
      eighthMile: since(this.eighthMile),
      elapsed: since(this.finishAt),
      trapKmh: trap,
    };
  }
}
/** Lane centre offsets across the strip (m, positive left of travel) for a
 * field of `count` cars, kept to the middle lanes. */
export function dragLanes(count: number) {
  const n = Math.max(1, Math.min(DRAG.lanes, count)),
    first = Math.floor((DRAG.lanes - n) / 2);
  return Array.from({ length: n }, (_, i) => {
    const lane = first + i;
    return { lane, offset: ((DRAG.lanes - 1) / 2 - lane) * DRAG.lane };
  });
}
