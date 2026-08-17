/**
 * Whale pet runtime service: the single owner of motion, scene mount,
 * transient effect counters, recap history and persisted user state. The
 * React overlay only renders {@link WhalePetViewSnapshot}; session state and
 * other future plugins drive the same service through {@link setActivity},
 * {@link playEffect} and {@link pushRecap}.
 */
import { type WhaleActivity, type WhaleBridgeState, type WhaleEffectKind, type WhaleMood, type WhalePetViewSnapshot } from '../activity.ts';
import type { WhaleDragResult } from '../motion.ts';
import { type WhalePetControllerHooks, type WhalePetTargets } from './whale-pet-controller.ts';
import type { SessionWhaleObserver } from './session-observer.ts';
import { type StorageLike } from '../persistence.ts';
/** Clickable pet regions routed by the view to zone-specific reactions. */
export type WhaleHitZone = 'body' | 'tail' | 'dorsal' | 'fin';
export declare const DIZZY_DURATION_MS = 4000;
export declare const DIZZY_LONG_DRAG_MS = 4500;
export declare const DIZZY_MIN_REAL_DRAG_PX = 24;
export declare const DIZZY_FAST_DRAG_DISTANCE_PX = 420;
export declare const DIZZY_FAST_DRAG_SPEED_PX_PER_SECOND = 550;
/** Whether one completed drag is forceful or prolonged enough to cause dizziness. */
export declare function shouldEnterDizzy(drag: WhaleDragResult): boolean;
export declare class WhalePetService {
    private readonly storage;
    private readonly controller;
    private readonly listeners;
    private readonly timers;
    private readonly persisted;
    private activity;
    private baseActivity;
    private effects;
    private bridge;
    private recapHistory;
    private recapIndex;
    private recapCurrent;
    private recapTimer;
    private nextEffectId;
    private nextRecapId;
    private observer;
    private external;
    private dizzyTimer;
    private snapshot;
    private disposed;
    constructor(storage?: StorageLike | null);
    /** Mount the view's DOM handles; restores the persisted position. Delegates to the controller unchanged. */
    mount(targets: WhalePetTargets, hooks: WhalePetControllerHooks): boolean;
    /** Unmount the current view surface without dropping the service or motion state. */
    unmount(): void;
    /** Attach the session bridge for user-activity wake notifications. */
    bindObserver(observer: SessionWhaleObserver): void;
    /** Wake a sleeping pet on hover/drag and refresh the session idle clock. */
    wake(): void;
    /** Whether dizziness currently owns the pose and blocks pointer interaction. */
    isDizzy(): boolean;
    /** The user is composing a reply (view-driven DOM focus); wakes the pet. */
    setUserTyping(typing: boolean): void;
    /** View-delegated interaction passthroughs. */
    setHover(hovering: boolean): void;
    beginDrag(pointerX: number, pointerY: number, startedAt?: number): void;
    wasClick(maximumDrag?: number): boolean;
    /**
     * Handle a click that stayed under the drag threshold. The view routes
     * each hit zone here; the body zone falls through so the view keeps its
     * original click behavior (progress bubble / recap cycle).
     * @returns true when the zone click was handled; false for a real drag or
     * the body zone (let the view run its own click handling).
     */
    handleZoneClick(zone: WhaleHitZone): boolean;
    /** Replace the session mood unless an unexpired interaction mood owns the pose. */
    setActivity(activity: WhaleActivity): void;
    /** Update the session-bridge lifecycle state (observer-owned). */
    setBridgeState(bridge: WhaleBridgeState): void;
    /** Rename the pet; persists and publishes the new name. */
    setName(name: string): void;
    /** Hide or show the pet; persists the choice and pauses rendering while hidden. */
    setHidden(hidden: boolean): void;
    /** Toggle visibility; returns the new hidden state. */
    toggleHidden(): boolean;
    /** Toggle corner snapping for released drags; persists the choice. */
    setSnapToCorner(enabled: boolean): void;
    /** Glide to the nearest corner immediately (context-menu action). */
    snapToCornerNow(): void;
    /**
     * One unsolicited greeting per local calendar day. Returns true when the
     * bubble was shown so callers can skip a second nudge on the same day.
     */
    greetOnceToday(now?: number): boolean;
    /** Persist the pet position after a drag release. */
    persistPosition(x: number, y: number): void;
    /** Record one session/interaction event for the click recap (dedupes repeats). */
    pushRecap(text: string): number | null;
    /** Remove stale recap entries that were superseded by a later successful turn. */
    discardRecaps(ids: ReadonlySet<number>): void;
    /**
     * Show a long-lived speech bubble (chat replies and API output) without
     * entering the session-event recap history. Truncated to a bubble-safe
     * length; the bubble auto-clears after `ttlMs`.
     */
    showBubble(text: string, ttlMs?: number, options?: {
        replace?: boolean;
    }): void;
    /**
     * Override the pet's mood from outside the session observer (e.g. chat
     * thinking). The observer checks {@link externalMood} every tick and lets it
     * win until it expires, so session activity cannot stomp an interaction in
     * flight.
     */
    setExternalMood(mood: WhaleMood, until: number): void;
    /** Drop the matching external mood and restore the latest session activity. */
    clearExternalMood(expectedMood?: WhaleMood): void;
    /** Enter or refresh the fixed-duration dizzy reaction. */
    enterDizzy(now?: number): void;
    /** The active external mood override, or null. */
    externalMood(): {
        mood: WhaleMood;
        until: number;
    } | null;
    /** Cycle to the next recap bubble (name/days entry first, then recent events). */
    nextRecap(): void;
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
    /**
     * Error reaction: one sweat drop now, then a fresh drop every
     * {@link ERROR_SWEAT_INTERVAL_MS} until `until`, so the failure stays
     * clearly visible instead of a single drop that blends into the idle
     * bubbles.
     */
    playErrorReaction(until: number): void;
    private scheduleCelebrationHearts;
    /**
     * Run `emit` on a fixed interval until `deadline`, tracking each timer in
     * `this.timers` so `dispose()` can always clear the chain.
     */
    private intervalUntil;
    private scheduleRecapClear;
    private nameRecap;
    /** Release timers, listeners and the WebGL surface. */
    dispose(): void;
    private applyActivity;
    private buildSnapshot;
    private publish;
}
