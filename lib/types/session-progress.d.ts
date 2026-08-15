/**
 * Host-side fine-grained session progress for the whale pet.
 *
 * Reads the live dsh session event log (read-only) and summarizes what the
 * agent is doing right now: current step number, tools still in flight,
 * last activity and last tool-result summary. Running background jobs from
 * the jobs registry are folded in too, so long tasks started with the
 * `jobs` tool report their real state and output tail. Served at
 * `GET /api/whale-pet/progress?session=<id>`; the browser pet merges this
 * with its own coarse projection snapshot.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type SessionEvent, type SessionStore } from '@deepseek-ai/dsh-session';
import type { JobRegistry, JobSnapshot } from '@deepseek-ai/dsh-jobs';
/** One running background job, with its latest output tail. */
export interface SessionProgressJobsEntry {
    label: string;
    startedAt: number;
    outputTail?: string;
}
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
    /** Running background jobs (finishedAt absent), newest first. */
    jobs?: readonly SessionProgressJobsEntry[];
}
/**
 * Summarize the running background jobs (pure, for tests). `readOutput`
 * returns the job's captured text; a settled job (finishedAt present) is
 * skipped.
 */
export declare function summarizeJobs(snapshots: readonly JobSnapshot[], readOutput: (id: JobSnapshot['id']) => string | undefined, limit?: number): SessionProgressJobsEntry[];
/**
 * Summarize one session's event log into a fine-grained progress snapshot.
 * Pure and deterministic so it is unit-testable against fixtures.
 */
export declare function summarizeSession(events: readonly SessionEvent[], now: number): SessionProgressSummary;
/** HTTP handler for `GET /api/whale-pet/progress?session=<id>`. */
export declare function createProgressHandler(store: SessionStore | null, jobs?: JobRegistry | null): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
