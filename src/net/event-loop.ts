/** Deterministic discrete-event loop in simulated milliseconds. The online
 * slice runs one server and many clients in one process on this clock, so a
 * 60 s race under latency and loss is reproducible from its seed and does not
 * depend on wall-clock scheduling. Events at equal times run in the order
 * they were scheduled. */
interface Scheduled {
  time: number;
  seq: number;
  fn: () => void;
}
export class EventLoop {
  now = 0;
  private heap: Scheduled[] = [];
  private seq = 0;
  private cancelled = new Set<number>();
  /** Run `fn` at absolute time `time` (ms); returns a handle for `cancel`. */
  at(time: number, fn: () => void): number {
    if (!Number.isFinite(time)) throw new Error('Invalid event time');
    const event = { time: Math.max(time, this.now), seq: this.seq++, fn };
    this.push(event);
    return event.seq;
  }
  after(delayMs: number, fn: () => void) {
    return this.at(this.now + delayMs, fn);
  }
  cancel(handle: number) {
    this.cancelled.add(handle);
  }
  /** Repeat `fn` every `periodMs` from `start`, at exact multiples (no drift).
   * Returns a function that stops the repetition. */
  every(periodMs: number, fn: () => void, start = this.now): () => void {
    if (!(periodMs > 0)) throw new Error('Invalid period');
    let k = 0,
      stopped = false,
      handle = -1;
    const run = () => {
      if (stopped) return;
      fn();
      k++;
      if (!stopped) handle = this.at(start + k * periodMs, run);
    };
    handle = this.at(start, run);
    return () => {
      stopped = true;
      this.cancel(handle);
    };
  }
  get pending() {
    return this.heap.length;
  }
  /** Process every event due at or before `time`, then stand at `time`. */
  runUntil(time: number) {
    while (this.heap.length && this.heap[0].time <= time) {
      const event = this.pop();
      if (this.cancelled.delete(event.seq)) continue;
      this.now = event.time;
      event.fn();
    }
    this.now = Math.max(this.now, time);
  }
  /** Run until `done()` is true (checked after each event) or `limit` ms. */
  runWhile(keepGoing: () => boolean, limit: number) {
    while (keepGoing() && this.heap.length && this.heap[0].time <= limit) {
      const event = this.pop();
      if (this.cancelled.delete(event.seq)) continue;
      this.now = event.time;
      event.fn();
    }
  }
  private less(a: Scheduled, b: Scheduled) {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }
  private push(event: Scheduled) {
    const h = this.heap;
    h.push(event);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(h[i], h[parent])) break;
      [h[i], h[parent]] = [h[parent], h[i]];
      i = parent;
    }
  }
  private pop(): Scheduled {
    const h = this.heap,
      top = h[0],
      last = h.pop() as Scheduled;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Seeded xorshift32 for network conditions; independent of simulation RNG. */
export class NetRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  /** Standard normal (Box–Muller). */
  gaussian() {
    const u = Math.max(1e-12, this.next()),
      v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
