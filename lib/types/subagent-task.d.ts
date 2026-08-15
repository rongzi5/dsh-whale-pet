/**
 * Host-side task dispatch for the whale pet: when the user asks the pet for
 * something that needs real execution (writing code, running commands,
 * research…), the pet's host entry runs a dedicated agent conversation in the
 * current workspace and returns its final output plus the session id.
 *
 * Unlike `ctx.subagents.start` (whose children are marked `origin: subagent`
 * and therefore hidden from the workspace session list, and which hang under
 * an invisible parent), this module creates the child agent directly with a
 * normal session origin — so the conversation appears in the workspace
 * session list and stays there after the run. The child inherits the DSH
 * agent machinery (tools, model, preset), so it really executes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets';
import { type SessionStore } from '@deepseek-ai/dsh-session';
/** How long a pet-dispatched task may run before reporting "still running". */
export declare const TASK_TIMEOUT_MS = 60000;
/** Final-output text cap returned to the pet bubble. */
export declare const TASK_OUTPUT_LIMIT = 1200;
export interface TaskResponse {
    /** The child agent's final output text. */
    output: string;
    /** The child session id — openable in the DSH UI. */
    sessionId: string;
    /** Whether the child finished within the timeout. */
    completed: boolean;
    /** Diagnostic: how the child settled and how many events it produced. */
    debug?: {
        stopReason: string;
        eventCount: number;
        eventTypes?: string[];
        turnEndReason?: unknown;
        presetMounted?: boolean;
        presetMountError?: string;
    };
}
/** Bound body-size guard for task requests (64 KiB). */
export declare const TASK_MAX_BODY_BYTES: number;
/**
 * Build the `POST /api/whale-pet/task` handler.
 *
 * The child is created directly via the agent registry (workspace cwd from
 * the caller session header, deployment preset and default model), given one
 * user message, and awaited until idle. The child session is deliberately
 * NOT disposed so it stays in the workspace session list.
 */
export declare function createTaskHandler(agents: AgentRegistry, agentPresets: AgentPresets | null, sessions: SessionStore | null, workspaceRoot: () => string | undefined, defaultPreset?: () => string | undefined, defaultModel?: () => {
    provider?: string;
    model?: string;
} | undefined, timeoutMs?: number): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
