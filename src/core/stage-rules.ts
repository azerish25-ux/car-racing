import type { RouteProgress } from '../simulation/route-graph.ts';

/** Rally-stage and rallycross-joker classification policies (WP42,
 * masterplan §11.2, §13.4, §14.2), built on route-graph progress. Each
 * competitor's legal route decides obligations; nothing infers them from
 * the horizontally nearest spline. */
export interface StageCompetitor {
  id: number;
  progress: RouteProgress;
  /** Split times at each checkpoint passed (s). */
  splits: number[];
  finishTime: number | null;
  /** Times the joker edge was entered. */
  jokers: number;
  lastEdge: string;
  penalties: number;
}
export function competitor(id: number, progress: RouteProgress): StageCompetitor {
  return {
    id,
    progress,
    splits: [],
    finishTime: null,
    jokers: 0,
    lastEdge: progress.edge,
    penalties: 0,
  };
}
/** Record checkpoint splits, joker entries and the finish from progress. */
export function observeStage(c: StageCompetitor, time: number, jokerEdge?: string) {
  const p = c.progress;
  const passed = p.laps * p.graph.spec.checkpoints.length + p.checkpoint + (p.finished ? 1 : 0);
  while (c.splits.length < passed) c.splits.push(time);
  if (jokerEdge && p.edge === jokerEdge && c.lastEdge !== jokerEdge) c.jokers++;
  c.lastEdge = p.edge;
  if (p.finished && c.finishTime === null) c.finishTime = time;
}
export interface JokerPolicy {
  /** Joker laps each competitor must take. */
  required: number;
  /** Time added per missing (or extra) joker (s). */
  penaltySeconds: number;
}
/** Classify finishers by time plus penalties; missing or extra jokers are
 * penalised, not silently ignored. Non-finishers follow by distance. */
export function classifyStage(field: readonly StageCompetitor[], joker?: JokerPolicy) {
  for (const c of field)
    c.penalties = joker ? Math.abs(c.jokers - joker.required) * joker.penaltySeconds : 0;
  const finished = field.filter((c) => c.finishTime !== null);
  const running = field.filter((c) => c.finishTime === null);
  finished.sort(
    (a, b) => a.finishTime! + a.penalties - (b.finishTime! + b.penalties) || a.id - b.id,
  );
  running.sort((a, b) => b.progress.distance - a.progress.distance || a.id - b.id);
  return [...finished, ...running].map((c, i) => ({
    position: i + 1,
    id: c.id,
    time: c.finishTime === null ? null : c.finishTime + c.penalties,
    penalties: c.penalties,
    reason:
      joker && c.jokers !== joker.required
        ? `joker taken ${c.jokers}/${joker.required}: +${c.penalties} s`
        : c.finishTime === null
          ? 'did not finish'
          : '',
  }));
}
