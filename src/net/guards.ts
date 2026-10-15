/** Token bucket in simulated or real milliseconds (WP53/WP54 rate limits). */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    readonly perSecond: number,
    readonly burst: number,
    now = 0,
  ) {
    this.tokens = burst;
    this.last = now;
  }
  /** Spend one token at `now`; false when the caller is over its rate. */
  take(now: number, cost = 1) {
    const elapsed = Math.max(0, now - this.last);
    this.last = Math.max(this.last, now);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.perSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

export interface TickBudgetReport {
  budgetMs: number;
  ticks: number;
  meanMs: number;
  p99Ms: number;
  worstMs: number;
  /** Ticks whose step exceeded the budget. */
  overruns: number;
  /** Longest run of consecutive overruns. */
  longestOverrunStreak: number;
  /** 'degraded' once a streak reached `degradeAfter` ticks. */
  status: 'ok' | 'degraded';
}
/** Server tick budget monitor: one 120 Hz step must finish inside 8.33 ms or
 * the server falls behind real time. Keeps a fixed histogram (0.05 ms bins to
 * 50 ms) so long sessions do not grow memory. */
export class TickBudgetMonitor {
  private bins = new Uint32Array(1001);
  private sum = 0;
  private streak = 0;
  ticks = 0;
  worst = 0;
  overruns = 0;
  longestStreak = 0;
  degraded = false;
  constructor(
    readonly budgetMs = 1000 / 120,
    readonly degradeAfter = 12,
    /** Ignore this many first ticks (one-off contact mesh/BVH construction). */
    readonly warmupTicks = 120,
  ) {}
  record(ms: number) {
    this.ticks++;
    if (this.ticks <= this.warmupTicks || !Number.isFinite(ms)) return;
    this.sum += ms;
    this.bins[Math.min(1000, Math.floor(ms / 0.05))]++;
    this.worst = Math.max(this.worst, ms);
    if (ms > this.budgetMs) {
      this.overruns++;
      this.streak++;
      this.longestStreak = Math.max(this.longestStreak, this.streak);
      if (this.streak >= this.degradeAfter) this.degraded = true;
    } else this.streak = 0;
  }
  report(): TickBudgetReport {
    const counted = Math.max(0, this.ticks - this.warmupTicks);
    let p99 = 0,
      seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i];
      if (seen >= counted * 0.99) {
        p99 = (i + 1) * 0.05;
        break;
      }
    }
    return {
      budgetMs: this.budgetMs,
      ticks: this.ticks,
      meanMs: counted ? this.sum / counted : 0,
      p99Ms: p99,
      worstMs: this.worst,
      overruns: this.overruns,
      longestOverrunStreak: this.longestStreak,
      status: this.degraded ? 'degraded' : 'ok',
    };
  }
}

/** Summary statistics used by every report. */
export interface Distribution {
  samples: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
export function distribution(values: readonly number[]): Distribution {
  if (!values.length) return { samples: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b),
    at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    samples: sorted.length,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  };
}
