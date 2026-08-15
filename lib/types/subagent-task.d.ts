/**
 * Host-side task dispatch for the whale pet: when the user asks the pet for
 * something that needs real execution (writing code, running commands,
 * research…), the pet's host entry spawns a DSH subagent — an independent
 * conversation in the current workspace, exactly like the agent's own
 * `subagent` tool — and returns the child's final output plus its session id
 * (so the user can open the child conversation in the UI).
 *
 * The child inherits the DSH agent machinery (tools, model, workspace), so
 * "让鲸鲸开个任务" runs a real agent loop without touching the main session.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import { type SessionStore } from '@deepseek-ai/dsh-session';
/** How long a pet-dispatched task may run before reporting "still running". */
export declare const TASK_TIMEOUT_MS = 60000;
/** Final-output text cap returned to the pet bubble. */
export declare const TASK_OUTPUT_LIMIT = 1200;
export interface TaskRequest {
    /** The task description given to the child agent. */
    prompt: string;
    /** Optional label shown in the subagent UI. */
    label?: string;
}
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
    };
}
/** Bound body-size guard for task requests (64 KiB). */
export declare const TASK_MAX_BODY_BYTES: number;
/**
 * Build the `POST /api/whale-pet/task` handler.
 *
 * Parent agent: the current initiator when one is active (so the child hangs
 * under the live conversation and shows in the subagent view); otherwise a
 * fresh parent agent is created with the cwd of the caller's session (taken
 * from the session header), so the child session lands in the user's
 * workspace and appears in the session list. The provider is whatever
 * subagent backend is registered first (spawn/fork in-process).
 */
export declare function createTaskHandler(subagents: SubagentRuntime, agents: AgentRegistry, sessions: SessionStore | null, workspaceRoot: () => string | undefined, defaultPreset?: () => string | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
