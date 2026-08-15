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
    deltaSeconds: number;
    /** Integrated clamped time in seconds since `start`. */
    elapsedSeconds: number;
}
export interface WhaleFrameHost {
    requestAnimationFrame(callback: FrameRequestCallback): number;
    cancelAnimationFrame(handle: number): void;
}
export declare class WhaleRenderScheduler {
    private readonly host;
    private callback;
    private frameHandle;
    private lastTime;
    private elapsed;
    private running;
    constructor(host: WhaleFrameHost);
    /**
     * Start the loop. Calling start on an already-running scheduler is a no-op.
     * @param callback - receives one clamped tick per animation frame.
     */
    start(callback: (tick: WhaleTick) => void): void;
    /**
     * Stop the loop and cancel any scheduled frame. The clock resets on the
     * next start, matching the original effect-local clock semantics.
     */
    stop(): void;
    /** Whether a frame is scheduled or currently executing. */
    get active(): boolean;
    private readonly tick;
}
