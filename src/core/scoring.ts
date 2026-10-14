/** Event-based scoring for drift/freestyle-style challenges (WP48, §9.6,
 * §11.2). A score is computed only from recorded events, so every point can
 * be explained afterwards, and repetition decays so one safe action cannot
 * be farmed indefinitely. Race timing never uses this code. */
export interface ScoreEvent {
  /** Simulation time the action completed (s). */
  time: number;
  /** Action kind, e.g. 'drift', 'whip', 'scrub'. */
  kind: string;
  /** Measured quality 0..1 (angle held, landing alignment...). */
  quality: number;
  /** Duration of the action (s). */
  duration: number;
  /** Landing/exit valid: a bailout scores nothing and breaks the combo. */
  valid: boolean;
}
export interface ScoreLine {
  time: number;
  kind: string;
  base: number;
  repetition: number;
  combo: number;
  points: number;
  reason: string;
}
export const SCORING = Object.freeze({
  basePerSecond: 100,
  /** Each recent repeat of the same kind keeps this fraction of value. */
  repetitionDecay: 0.6,
  /** Repeats older than this window no longer count against an action (s). */
  repetitionWindow: 20,
  comboStep: 0.25,
  comboMax: 3,
  /** A gap longer than this between actions ends the combo (s). */
  comboGap: 2.5,
  minQuality: 0.2,
});
export function scoreEvents(events: readonly ScoreEvent[]) {
  const lines: ScoreLine[] = [];
  const history: { kind: string; time: number }[] = [];
  let combo = 1,
    lastTime = -Infinity,
    total = 0;
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    if (!Number.isFinite(e.time) || !Number.isFinite(e.quality) || !Number.isFinite(e.duration))
      continue;
    if (!e.valid || e.quality < SCORING.minQuality) {
      combo = 1;
      lastTime = e.time;
      lines.push({
        time: e.time,
        kind: e.kind,
        base: 0,
        repetition: 0,
        combo: 1,
        points: 0,
        reason: e.valid ? 'quality below the scoring threshold' : 'bailout: no score, combo reset',
      });
      continue;
    }
    combo =
      e.time - lastTime <= SCORING.comboGap
        ? Math.min(SCORING.comboMax, combo + SCORING.comboStep)
        : 1;
    lastTime = e.time;
    const repeats = history.filter(
      (h) => h.kind === e.kind && e.time - h.time <= SCORING.repetitionWindow,
    ).length;
    const repetition = SCORING.repetitionDecay ** repeats;
    const base = SCORING.basePerSecond * Math.min(e.duration, 10) * Math.min(1, e.quality);
    const points = Math.round(base * repetition * combo);
    history.push({ kind: e.kind, time: e.time });
    total += points;
    lines.push({
      time: e.time,
      kind: e.kind,
      base: Math.round(base),
      repetition,
      combo,
      points,
      reason: `${Math.round(base)} base × ${repetition.toFixed(2)} repetition × ${combo.toFixed(2)} combo`,
    });
  }
  return { total, lines };
}
