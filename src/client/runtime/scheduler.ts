/**
 * Frame scheduler for the whale pet runtime.
 *
 * Owns the single `requestAnimationFrame` chain and the exact frame-clock
 * semantics the pet originally implemented inside its React effect:
 * the first tick always advances by 1/60s, later ticks clamp the measured
 * delta to [0.004, 0.04]s, and elapsed time integrates those clamped deltas
 * so changing frame rate cannot jump the animation phase.
 *
 * The scheduler is deliberately free of React, Three.js and motion code so
 * future work (sleep tiers, visibility pause, frame-rate capping) only has
 * to touch this module, and it can be unit-tested with a fake clock.
 */

export interface WhaleTick {
  /** Clamped frame delta in seconds, ready for motion and scene integration. */
  deltaSeconds: number
  /** Integrated clamped time in seconds since `start`. */
  elapsedSeconds: number
}

export interface WhaleFrameHost {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
}

export class WhaleRenderScheduler {
  private callback: ((tick: WhaleTick) => void) | null = null
  private frameHandle = 0
  private lastTime = 0
  private elapsed = 0
  private running = false

  public constructor(private readonly host: WhaleFrameHost) {}

  /**
   * Start the loop. Calling start on an already-running scheduler is a no-op.
   * @param callback - receives one clamped tick per animation frame.
   */
  public start(callback: (tick: WhaleTick) => void): void {
    if (this.running) return
    this.callback = callback
    this.lastTime = 0
    this.elapsed = 0
    this.running = true
    this.frameHandle = this.host.requestAnimationFrame(this.tick)
  }

  /**
   * Stop the loop and cancel any scheduled frame. The clock resets on the
   * next start, matching the original effect-local clock semantics.
   */
  public stop(): void {
    if (!this.running) return
    this.running = false
    this.callback = null
    this.host.cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
  }

  /** Whether a frame is scheduled or currently executing. */
  public get active(): boolean {
    return this.running
  }

  private readonly tick = (time: number): void => {
    if (!this.running) return
    const deltaSeconds = this.lastTime === 0
      ? 1 / 60
      : Math.max(0.004, Math.min(0.04, (time - this.lastTime) / 1000))
    this.lastTime = time
    this.elapsed += deltaSeconds
    this.callback?.({ deltaSeconds, elapsedSeconds: this.elapsed })
    // A callback may call stop() (for example after a renderer failure); in
    // that case no next frame is scheduled.
    if (this.running) {
      this.frameHandle = this.host.requestAnimationFrame(this.tick)
    }
  }
}
