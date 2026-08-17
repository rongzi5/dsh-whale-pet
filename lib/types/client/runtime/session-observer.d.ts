/**
 * Session activity bridge: polls the current DSH session's conversation and
 * projection snapshots and maps them onto whale moods and transient effects.
 *
 * The observer intentionally depends only on structural interfaces (the
 * ObservableSnapshot contract), not on value imports from the runtime
 * package, so the client bundle stays inside the platform purity rules and
 * the derivation logic can be unit-tested with plain fixtures.
 */
import type { WhaleActivity, WhaleEffectKind } from '../activity.ts';
import { type WhalePendingInteraction, type WhaleSessionProgress } from '../progress.ts';
import { WhalePetService } from './whale-pet-service.ts';
export interface ObservableLike<T> {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
}
interface SessionSummaryLike {
    pendingInteraction?: WhalePendingInteraction;
}
interface SessionListLike {
    current?: string;
    byId?: Record<string, SessionSummaryLike>;
}
interface ConversationLike {
    running: boolean;
    partial: {
        blocks: readonly unknown[];
    } | null;
    runningCalls: readonly unknown[];
    nodes: readonly ConversationNodeLike[];
    lastAgentError?: string | null;
}
interface ConversationNodeLike {
    kind?: string;
    seq?: number;
    time?: number;
    isError?: boolean;
    resultView?: {
        exitCode?: number;
    };
    call?: {
        name?: string;
    } | null;
}
interface SessionFaceLike extends ObservableLike<ConversationLike> {
    projections?: {
        faceOf(key: string): ObservableLike<unknown>;
    };
}
interface SessionBindingLike {
    session: SessionFaceLike;
}
interface SessionsLike {
    list: ObservableLike<SessionListLike>;
    binding(id: string): SessionBindingLike | undefined;
}
export interface WhaleSessionClientContext {
    sessions?: SessionsLike;
}
/**
 * Pure mood derivation, separated for tests.
 * @returns the non-transient mood for the sampled session state.
 */
export declare function deriveWhaleActivity(now: number, state: {
    active: boolean;
    running: boolean;
    turnStartedAt: number;
    lastActivityAt: number;
    userTyping: boolean;
    pendingInteraction?: WhalePendingInteraction;
}): WhaleActivity;
export declare class SessionWhaleObserver {
    private readonly ctx;
    private readonly service;
    private listDispose;
    private sessionDispose;
    private timer;
    private sessions;
    private sessionId;
    private session;
    private goalFace;
    private planFace;
    private wasRunning;
    private turnStartedAt;
    private lastActivityAt;
    private lastErrorSeq;
    private knownGoalPhase;
    private knownPlanActive;
    private transient;
    private lastActivityBubbleAt;
    private lastMood;
    private boundAt;
    private lastNodeCount;
    private userTyping;
    private lastPending;
    private lastCompactionSeq;
    private lastNudgeAt;
    private disposed;
    constructor(ctx: WhaleSessionClientContext, service: WhalePetService);
    /**
     * Start the sample loop. The sessions service may activate after this
     * plugin, so the bridge keeps retrying every poll until `ctx.sessions`
     * becomes available.
     */
    start(): void;
    dispose(): void;
    /** Record direct user interaction so sleep can be interrupted. */
    noteUserActivity(): void;
    /**
     * A read-only progress snapshot of the bound session, for the pet's chat
     * and click recap. Returns null when no session is bound. Never writes to
     * the session.
     */
    getProgress(): WhaleSessionProgress | null;
    /**
     * Track whether the user is composing a reply. Driven by DOM focus events
     * on the chat input from the view; while typing, the pet stays in the
     * `listening` mood and the idle clock is held.
     */
    setUserTyping(typing: boolean): void;
    private tick;
    private resolveSessions;
    private rebind;
    private sample;
    private applyActivity;
    private seedProjections;
    private celebrate;
    /**
     * Extremely sparse unsolicited talk: one greeting per local day, plus a
     * compaction notice. Never calls the LLM. Rate-limited so two events in
     * the same minute cannot stack bubbles.
     */
    private maybeNudge;
}
export declare const SESSION_BRIDGE_THRESHOLDS: Readonly<{
    POLL_MS: 200;
    FOCUS_AFTER_MS: 20000;
    LONG_TURN_MS: 15000;
    IDLE_SLEEP_MS: 60000;
    CELEBRATE_MS: 7500;
    ERROR_MS: 3000;
    ACTIVE_BUBBLE_MS: 3500;
    ERROR_SETTLE_MS: 2500;
}>;
export type { WhaleEffectKind };
