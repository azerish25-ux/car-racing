/** Bound the normal presentation loop to one unfinished GPU submission.
 * Polling never waits: physics, input and the browser compositor keep running
 * while the next draw coalesces to the latest available simulation snapshot.
 *
 * The wait is also bounded in time (F01 root cause). Browsers refresh a
 * WebGL fence's status only as further GL work and frames flow; when the gate
 * itself withholds every draw (a held or seeking replay submits nothing
 * else), a zero-timeout poll can report TIMEOUT_EXPIRED indefinitely. That
 * deadlocked replay: playback and seeks waited forever for a fence nothing
 * would refresh. After `maxWaitMs` the fence is released and the frame
 * proceeds, so at most one extra submission per interval can be queued.
 */
export class GpuFrameGate {
  private fence: WebGLSync | null = null;
  private disposed = false;
  private submitted = 0;
  private completed = 0;
  private deferred = 0;
  private expired = 0;
  private fencedAt = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly now: () => number = () => performance.now(),
    readonly maxWaitMs = 500,
  ) {}

  ready(): boolean {
    const gl = this.gl;
    if (this.disposed) return false;
    if (gl.isContextLost()) {
      // Context loss already invalidated the handle; do not use it again.
      this.fence = null;
      return false;
    }
    if (!this.fence) return true;
    const result = gl.clientWaitSync(this.fence, 0, 0);
    if (result === gl.TIMEOUT_EXPIRED) {
      if (this.now() - this.fencedAt < this.maxWaitMs) {
        this.deferred++;
        return false;
      }
      this.expired++;
      this.release();
      return true;
    }
    if (result !== gl.ALREADY_SIGNALED && result !== gl.CONDITION_SATISFIED) {
      this.release();
      throw new Error('Unable to check GPU frame completion');
    }
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
    this.fencedAt = this.now();
    this.submitted++;
    // Nonblocking submission is required so later zero-timeout polls can
    // observe completion even when no additional draw is sent to the driver.
    gl.flush();
  }

  diagnostics() {
    return {
      pending: this.fence !== null,
      submitted: this.submitted,
      completed: this.completed,
      deferredCallbacks: this.deferred,
      /** Fences released by the time bound instead of observed completion. */
      expiredFences: this.expired,
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
