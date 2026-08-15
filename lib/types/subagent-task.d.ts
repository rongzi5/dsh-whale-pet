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
/** How long a pet-dispatched task may run before reporting "still running". */
export declare const TASK_TIMEOUT_MS = 240000;
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
}
/** Bound body-size guard for task requests (64 KiB). */
export declare const TASK_MAX_BODY_BYTES: number;
/**
 * Build the `POST /api/whale-pet/task` handler.
 *
 * Parent agent: the current initiator when one is active; otherwise a fresh
 * agent is created for the workspace as the parent identity. The provider is
 * whatever subagent backend is registered first (spawn/fork in-process).
 */
export declare function createTaskHandler(subagents: SubagentRuntime, agents: AgentRegistry, workspaceRoot: () => string | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
