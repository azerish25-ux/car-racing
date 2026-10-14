/** Bound the normal presentation loop to one unfinished GPU submission.
 * Polling never waits: physics, input and the browser compositor keep running
 * while the next draw coalesces to the latest available simulation snapshot.
 *
 * The wait is also bounded in time (F01 root cause). Browsers refresh a
 * WebGL fence's status only as further GL work and frames flow; when the gate
 * itself withholds every draw (a held or seeking replay submits nothing
 * else), a zero-timeout poll can report TIMEOUT_EXPIRED indefinitely. That
 * deadlocked replay: playback and seeks waited forever for a fence nothing
 * would refresh. Once a fence has waited both `minWaitMs` and four times
 * the measured completion latency of recent frames, the gate drains with
 * `gl.finish()`: that returns at once when only the status was stale, and
 * otherwise waits for the real outstanding work. Either way at most one frame
 * is ever in flight, so a slow GPU is never handed a backlog and a stale
 * status cannot hold presentation forever.
 */
export class GpuFrameGate {
  private fence: WebGLSync | null = null;
  private disposed = false;
  private submitted = 0;
  private completed = 0;
  private deferred = 0;
  private expired = 0;
  private fencedAt = 0;
  /** Smoothed submit-to-observed-completion latency (ms); 0 until measured. */
  private latency = 0;
  /** Time of the previous poll of the current fence (or its submission). */
  private polledAt = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly now: () => number = () => performance.now(),
    readonly minWaitMs = 1000,
    readonly maxWaitMs = 10000,
  ) {}
  /** Current release bound for an unrefreshed fence (ms). */
  get waitBoundMs() {
    return Math.min(this.maxWaitMs, Math.max(this.minWaitMs, 4 * this.latency));
  }

  ready(): boolean {
    const gl = this.gl;
    if (this.disposed) return false;
    if (gl.isContextLost()) {
      // Context loss already invalidated the handle; do not use it again.
      this.fence = null;
      return false;
    }
    if (!this.fence) return true;
    const result = gl.clientWaitSync(this.fence, 0, 0),
      now = this.now(),
      // A completion is a latency sample only if it was polled continuously;
      // a fence first looked at after an idle period says nothing about GPU speed.
      continuous = now - this.polledAt < 250;
    this.polledAt = now;
    if (result === gl.TIMEOUT_EXPIRED) {
      if (now - this.fencedAt < this.waitBoundMs) {
        this.deferred++;
        return false;
      }
      this.expired++;
      const drainStart = this.now();
      gl.finish();
      // A drain that had to wait ended when the GPU work did: a real sample.
      // One that returned at once only found a stale status: not a sample.
      if (continuous && this.now() - drainStart > 2) this.sample(this.now() - this.fencedAt);
      this.release();
      this.completed = this.submitted;
      return true;
    }
    if (result !== gl.ALREADY_SIGNALED && result !== gl.CONDITION_SATISFIED) {
      this.release();
      throw new Error('Unable to check GPU frame completion');
    }
    if (continuous) this.sample(now - this.fencedAt);
    this.release();
    this.completed = this.submitted;
    return true;
  }

  /** Fence all passes of the completed submission, not just its main camera.
   * Explicit warmup/inspection draws may replace the fence; the newer fence
   * includes all preceding commands and still owns only one live GL handle.
   */
  submittedFrame(): void {
    const gl = this.gl;
    if (this.disposed) throw new Error('GPU frame gate is disposed');
    if (gl.isContextLost()) {
      this.fence = null;
      return;
    }
    this.release();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!this.fence) throw new Error('Unable to allocate GPU frame fence');
    this.fencedAt = this.polledAt = this.now();
    this.submitted++;
    // Nonblocking submission is required so later zero-timeout polls can
    // observe completion even when no additional draw is sent to the driver.
    gl.flush();
  }

  private sample(elapsed: number) {
    this.latency = this.latency ? this.latency * 0.8 + elapsed * 0.2 : elapsed;
  }

  diagnostics() {
    return {
      pending: this.fence !== null,
      submitted: this.submitted,
      completed: this.completed,
      deferredCallbacks: this.deferred,
      /** Fences resolved by an explicit drain after the bound, not by polling. */
      expiredFences: this.expired,
      latencyMs: this.latency,
    };
  }

  private release(): void {
    if (this.fence && !this.gl.isContextLost()) this.gl.deleteSync(this.fence);
    this.fence = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
  }
}
