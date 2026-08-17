/**
 * Whale pet session-progress vocabulary: a read-only summary of what the DSH
 * agent is doing right now, derived from the session projection (coarse,
 * observer) and the host event log (fine, `/api/whale-pet/progress`). Pure
 * functions so the bubble text and the prompt block stay unit-testable.
 *
 * This never writes to the DSH session — the pet only reads progress so long
 * chats are not disturbed.
 */
/** Session-list amber-dot: the user action currently blocking progress. */
export type WhalePendingInteraction = 'approval' | 'plan-review' | 'question';
/** One-line bubble / recap for a pending user interaction. */
export declare function pendingInteractionToText(kind: WhalePendingInteraction): string;
/** One read-only snapshot of the bound session's live state. */
export interface WhaleSessionProgress {
    /** Session id this snapshot belongs to (for the fine-grained host fetch). */
    sessionId?: string;
    /** Whether the agent is doing something right now (running/partial/calls). */
    active: boolean;
    /** Whether the turn is still streaming (vs. idle between turns). */
    running: boolean;
    /** Names of the tools currently in flight (unknown names become "tool"). */
    tools: readonly string[];
    /** Milliseconds the current turn has been running (0 while idle). */
    turnMs: number;
    /** Number of conversation nodes committed so far. */
    nodeCount: number;
    /** Name of the most recent tool call node, when known. */
    lastTool?: string;
    /** Current goal projection phase, when bound. */
    goalPhase?: string;
    /** Whether a plan is active, when bound. */
    planActive?: boolean;
    /** User interaction currently blocking this session (sidebar amber-dot). */
    pendingInteraction?: WhalePendingInteraction;
    /** Fine-grained: current step number within the turn (host event log). */
    step?: number;
    /** Fine-grained: human line for the latest activity (tool call / output). */
    lastActivity?: string;
    /** Fine-grained: truncated summary of the latest tool result. */
    lastSummary?: string;
    /** Fine-grained: running background jobs probed from the jobs registry. */
    jobs?: ReadonlyArray<{
        label: string;
        startedAt: number;
        outputTail?: string;
    }>;
}
/**
 * One-line human bubble. A running background job is the most concrete
 * "progress" the pet found, so it wins over the in-flight tool phrasing:
 * "正在后台跑 npm run build（已 5 分钟）" / "正在鼓捣终端（bash），已经 3 分钟" /
 * "正在深度思考…" / "刚跑完 bash".
 */
export declare function progressToText(progress: WhaleSessionProgress | null): string | null;
/**
 * Structured progress block appended to the pet's system prompt so the LLM
 * can truthfully answer "进度如何了" without ever touching the session.
 */
export declare function buildProgressContext(progress: WhaleSessionProgress | null): string | null;
