/**
 * Whale pet session-progress vocabulary: a read-only summary of what the DSH
 * agent is doing right now, derived from the same session snapshot the mood
 * observer consumes. Pure functions so the bubble text and the prompt block
 * stay unit-testable.
 *
 * This never writes to the DSH session — the pet only reads progress so long
 * chats are not disturbed.
 */
/** One read-only snapshot of the bound session's live state. */
export interface WhaleSessionProgress {
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
}
/** One-line human bubble: "正在跑 bash，已经 3 分钟" / "刚跑完 bash". */
export declare function progressToText(progress: WhaleSessionProgress | null): string | null;
/**
 * Structured progress block appended to the pet's system prompt so the LLM
 * can truthfully answer "进度如何了" without ever touching the session.
 */
export declare function buildProgressContext(progress: WhaleSessionProgress | null): string | null;
