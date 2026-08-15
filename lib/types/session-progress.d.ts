/**
 * Host-side fine-grained session progress for the whale pet.
 *
 * Reads the live dsh session event log (read-only) and summarizes what the
 * agent is doing right now: current step number, tools still in flight,
 * last activity and last tool-result summary. Served at
 * `GET /api/whale-pet/progress?session=<id>`; the browser pet merges this
 * with its own coarse projection snapshot.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type SessionEvent, type SessionStore } from '@deepseek-ai/dsh-session';
export interface SessionProgressSummary {
    active: boolean;
    running: boolean;
    tools: readonly string[];
    step: number;
    turnMs: number;
    nodeCount: number;
    lastTool?: string;
    lastActivity?: string;
    lastSummary?: string;
}
/**
 * Summarize one session's event log into a fine-grained progress snapshot.
 * Pure and deterministic so it is unit-testable against fixtures.
 */
export declare function summarizeSession(events: readonly SessionEvent[], now: number): SessionProgressSummary;
/** HTTP handler for `GET /api/whale-pet/progress?session=<id>`. */
export declare function createProgressHandler(store: SessionStore | null): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
