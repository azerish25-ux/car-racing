/**
 * Per-pass accounting for the ULTRA modules.
 *
 * The frame-level DrawLedger attributes draws to fixed phases (environment,
 * probe, mirrors, wet, shadow, composer, other); the ULTRA passes all run
 * inside `composer` (their shadow cascade inside `shadow`), so its phase totals
 * stay exact and comparable with the pinned baselines. This sub-ledger splits
 * that work per ULTRA pass - draw calls, triangles, frames run - and, where the
 * browser exposes GPU timestamps (EXT_disjoint_timer_query_webgl2 with
 * QUERY_COUNTER_BITS > 0), the GPU milliseconds of each pass, read back
 * asynchronously a few frames later. Without timestamps `gpuMs` stays null:
 * RAF time is never substituted. Frame totals still come from GpuTimer.
 */
export interface RenderInfoLike {
  calls: number;
  triangles: number;
}
interface TimerExtension {
  TIMESTAMP_EXT: number;
  QUERY_COUNTER_BITS_EXT: number;
  GPU_DISJOINT_EXT: number;
  queryCounterEXT(query: WebGLQuery, target: number): void;
}
interface PassRecord {
  calls: number;
  triangles: number;
  frames: number;
  gpuMs: number | null;
  /** Static estimate: texture fetches per frame at the current size (millions). */
  fetchesM: number;
}
interface PendingQuery {
  name: string;
  start: WebGLQuery;
  end: WebGLQuery;
}

export class GpuPassTimer {
  readonly supported: boolean;
  private readonly ext: TimerExtension | null;
  private readonly pending: PendingQuery[] = [];
  private disposed = false;
  constructor(private readonly gl: WebGL2RenderingContext | null) {
    const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as
      | TimerExtension
      | null
      | undefined;
    let bits = 0;
    try {
      bits =
        ext && gl ? Number(gl.getQuery(ext.TIMESTAMP_EXT, ext.QUERY_COUNTER_BITS_EXT)) || 0 : 0;
    } catch {
      bits = 0;
    }
    this.ext = ext && bits > 0 ? ext : null;
    this.supported = !!this.ext;
  }
  /** Bracket `fn` with timestamps; results arrive via `poll`. */
  measure(name: string, fn: () => void) {
    const gl = this.gl,
      ext = this.ext;
    if (!gl || !ext || this.disposed || this.pending.length > 48) return fn();
    const start = gl.createQuery(),
      end = gl.createQuery();
    if (!start || !end) return fn();
    ext.queryCounterEXT(start, ext.TIMESTAMP_EXT);
    try {
      fn();
    } finally {
      ext.queryCounterEXT(end, ext.TIMESTAMP_EXT);
      this.pending.push({ name, start, end });
    }
  }
  /** Collect finished queries: calls `report(name, ms)` for each. */
  poll(report: (name: string, ms: number) => void) {
    const gl = this.gl,
      ext = this.ext;
    if (!gl || !ext) return;
    const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q.end, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) {
        const ns =
          Number(gl.getQueryParameter(q.end, gl.QUERY_RESULT)) -
          Number(gl.getQueryParameter(q.start, gl.QUERY_RESULT));
        if (Number.isFinite(ns) && ns >= 0) report(q.name, ns / 1e6);
      }
      gl.deleteQuery(q.start);
      gl.deleteQuery(q.end);
      this.pending.shift();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.gl && !this.gl.isContextLost())
      for (const q of this.pending) {
        this.gl.deleteQuery(q.start);
        this.gl.deleteQuery(q.end);
      }
    this.pending.length = 0;
  }
}

export class PassLedger {
  private readonly records = new Map<string, PassRecord>();
  constructor(
    private readonly info: RenderInfoLike,
    private readonly timer: GpuPassTimer | null = null,
  ) {}
  private record(name: string) {
    let r = this.records.get(name);
    if (!r) {
      r = { calls: 0, triangles: 0, frames: 0, gpuMs: null, fetchesM: 0 };
      this.records.set(name, r);
    }
    return r;
  }
  /** Run `fn` as pass `name` of this frame (counts replace last frame's). */
  measure<R>(name: string, fn: () => R): R {
    const r = this.record(name);
    const calls = this.info.calls,
      triangles = this.info.triangles;
    let result!: R;
    const run = () => {
      result = fn();
    };
    try {
      if (this.timer) this.timer.measure(name, run);
      else run();
    } finally {
      r.calls = this.info.calls - calls;
      r.triangles = this.info.triangles - triangles;
      r.frames++;
    }
    return result;
  }
  /** Static per-frame fetch estimate (millions of texture fetches). */
  estimate(name: string, fetches: number) {
    this.record(name).fetchesM = Number.isFinite(fetches) ? fetches / 1e6 : 0;
  }
  /** Mark a pass idle this frame (its counts read zero). */
  idle(name: string) {
    const r = this.record(name);
    r.calls = 0;
    r.triangles = 0;
  }
  poll() {
    this.timer?.poll((name, ms) => {
      const r = this.record(name);
      // Exponential average over ~10 samples; null until the first result.
      r.gpuMs = r.gpuMs === null ? ms : r.gpuMs * 0.9 + ms * 0.1;
    });
  }
  snapshot() {
    const out: Record<string, PassRecord> = {};
    for (const [name, r] of this.records) out[name] = { ...r };
    return out;
  }
}

/** Wrap an object's `render` method so every call is measured as `name`. */
export function instrumentRender<O extends { render: (...args: never[]) => unknown }>(
  object: O,
  name: string,
  ledger: PassLedger,
) {
  const original = object.render.bind(object) as (...args: unknown[]) => unknown;
  (object as unknown as { render: (...args: unknown[]) => unknown }).render = (
    ...args: unknown[]
  ) => ledger.measure(name, () => original(...args));
  return object;
}
