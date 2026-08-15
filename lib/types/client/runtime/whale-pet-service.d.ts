/**
 * Whale pet runtime service: the single owner of motion, scene mount and
 * transient effect counters. The React overlay only renders
 * {@link WhalePetViewSnapshot}; session state and other future plugins drive
 * the same service through {@link setActivity} and {@link playEffect}.
 */
import { type WhaleActivity, type WhaleBridgeState, type WhaleEffectKind, type WhalePetViewSnapshot } from '../activity.ts';
import { type WhalePetControllerHooks, type WhalePetTargets } from './whale-pet-controller.ts';
import type { SessionWhaleObserver } from './session-observer.ts';
export declare class WhalePetService {
    private readonly controller;
    private readonly listeners;
    private readonly timers;
    private activity;
    private effects;
    private bridge;
    private snapshot;
    private nextEffectId;
    private observer;
    private disposed;
    /** Mount the view's DOM handles. Delegates to the controller unchanged. */
    mount(targets: WhalePetTargets, hooks: WhalePetControllerHooks): boolean;
    /** Unmount the current view surface without dropping the service or motion state. */
    unmount(): void;
    /** Attach the session bridge for user-activity wake notifications. */
    bindObserver(observer: SessionWhaleObserver): void;
    /** Wake a sleeping pet on hover/drag and refresh the session idle clock. */
    wake(): void;
    /** View-delegated interaction passthroughs. */
    setHover(hovering: boolean): void;
    beginDrag(pointerX: number, pointerY: number): void;
    wasClick(maximumDrag?: number): boolean;
    /** Replace the current mood; no-op for identical activity. */
    setActivity(activity: WhaleActivity): void;
    /** Update the session-bridge lifecycle state (observer-owned). */
    setBridgeState(bridge: WhaleBridgeState): void;
    /** Current stable view snapshot for useSyncExternalStore. */
    getSnapshot(): WhalePetViewSnapshot;
    /** Subscribe to snapshot changes. */
    subscribe(listener: () => void): () => void;
    /** Add one transient DOM effect (heart, bubble or sweat drop). */
    playEffect(kind: WhaleEffectKind): void;
    /**
     * Anchor bubbles at the mouth side implied by the current model yaw.
     * yaw 0 faces left, π faces right; intermediate yaw faces toward/away.
     */
    private bubbleOrigin;
    /** Celebration: hearts keep appearing for the whole loop, plus bubbles. */
    celebrate(): void;
    private scheduleCelebrationHearts;
    /** Release timers, listeners and the WebGL surface. */
    dispose(): void;
    private publish;
}
