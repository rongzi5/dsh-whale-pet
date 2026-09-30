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

import type { IncomingMessage, ServerResponse } from 'node:http'
import { SessionId, type SessionEvent, type SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { JobId, JobRegistry, JobView } from '@deepseek-ai/dsh-jobs'

/** Extracted plain text from message content blocks. */
function textOf(blocks: ReadonlyArray<{ type?: string; text?: unknown }> | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
    .trim()
}

/** One running background job, with its latest output tail. */
export interface SessionProgressJobsEntry {
  label: string
  startedAt: number
  outputTail?: string
}

export interface SessionProgressSummary {
  active: boolean
  running: boolean
  tools: readonly string[]
  step: number
  turnMs: number
  nodeCount: number
  lastTool?: string
  lastActivity?: string
  lastSummary?: string
  /** Running background jobs (finishedAt absent), newest first. */
  jobs?: readonly SessionProgressJobsEntry[]
}

const ACTIVITY_ARGS_LIMIT = 60
const ACTIVITY_TEXT_LIMIT = 60
const SUMMARY_TEXT_LIMIT = 140
const JOB_OUTPUT_TAIL_LIMIT = 120

/**
 * Summarize the running background jobs (pure, for tests). `readOutput`
 * returns the job's captured text; a settled job (finishedAt present) is
 * skipped.
 */
export function summarizeJobs(
  snapshots: readonly JobView[],
  readOutput: (id: JobId) => string | undefined,
  limit = 5,
): SessionProgressJobsEntry[] {
  const entries: SessionProgressJobsEntry[] = []
  for (const job of snapshots) {
    if (job.finishedAt !== undefined) continue
    if (entries.length >= limit) break
    let tail: string | undefined
    try {
      const output = readOutput(job.id)
      if (output !== undefined) {
        const trimmed = output.trim()
        if (trimmed !== '') tail = trimmed.slice(-JOB_OUTPUT_TAIL_LIMIT)
      }
    } catch {
      tail = undefined
    }
    entries.push({ label: job.label, startedAt: job.startedAt, ...(tail !== undefined ? { outputTail: tail } : {}) })
  }
  return entries
}

/**
 * Summarize one session's event log into a fine-grained progress snapshot.
 * Pure and deterministic so it is unit-testable against fixtures.
 */
export function summarizeSession(events: readonly SessionEvent[], now: number): SessionProgressSummary {
  let lastTurnStart = 0
  let lastTurnEnd = 0
  let lastStepStart = 0
  let lastStepEnd = 0
  let step = 0
  const openCalls = new Map<string, { name: string }>()
  const completedToolNames: string[] = []
  let lastToolCall: { name: string; args: string; seq: number } | null = null
  let lastResult: { text: string; isError: boolean; seq: number } | null = null
  let lastAssistantText = ''
  let nodeCount = 0

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        lastTurnStart = event.time
        break
      case 'turn/end':
        lastTurnEnd = event.time
        break
      case 'step/start':
        lastStepStart = event.time
        step = event.data.step
        break
      case 'step/end':
        lastStepEnd = event.time
        break
      case 'tool/call': {
        const name = event.data.name
        openCalls.set(event.data.callId, { name })
        lastToolCall = { name, args: event.data.arguments, seq: event.seq }
        break
      }
      case 'tool/result': {
        const resultMessage = event.data.message
        const callId = resultMessage.toolCallId
        if (callId !== undefined) {
          const call = openCalls.get(callId)
          if (call !== undefined) {
            openCalls.delete(callId)
            completedToolNames.push(call.name)
          }
        }
        lastResult = {
          text: textOf(resultMessage.content),
          isError: event.data.error !== undefined || resultMessage.isError === true,
          seq: event.seq,
        }
        nodeCount += 1
        break
      }
      case 'user/message':
        nodeCount += 1
        break
      case 'assistant/message':
        nodeCount += 1
        lastAssistantText = textOf(event.data.message.content)
        break
      default:
        break
    }
  }

  const running = lastTurnStart > lastTurnEnd || lastStepStart > lastStepEnd || openCalls.size > 0
  const active = running || events.length > 0
  const tools = [...openCalls.values()].map(call => call.name).slice(0, 5)

  let lastActivity: string | undefined
  let lastTool: string | undefined
  if (lastToolCall !== null) {
    lastTool = lastToolCall.name
    const args = lastToolCall.args.trim().slice(0, ACTIVITY_ARGS_LIMIT)
    lastActivity = args === '' ? `运行 ${lastToolCall.name}` : `运行 ${lastToolCall.name}：${args}`
  } else if (lastAssistantText !== '') {
    lastActivity = `正在输出：${lastAssistantText.slice(0, ACTIVITY_TEXT_LIMIT)}`
  }

  let lastSummary: string | undefined
  if (lastResult !== null) {
    const status = lastResult.isError ? '出错' : '完成'
    const text = lastResult.text.slice(0, SUMMARY_TEXT_LIMIT)
    lastSummary = text === '' ? `刚${status}` : `${status}：${text}`
  }

  return {
    active,
    running,
    tools,
    step,
    turnMs: running && lastTurnStart > 0 ? Math.max(0, now - lastTurnStart) : 0,
    nodeCount,
    ...(lastTool !== undefined ? { lastTool } : {}),
    ...(lastActivity !== undefined ? { lastActivity } : {}),
    ...(lastSummary !== undefined ? { lastSummary } : {}),
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/** HTTP handler for `GET /api/whale-pet/progress?session=<id>`. */
export function createProgressHandler(
  store: SessionStore | null,
  sessionQuery: SessionQueryEngine | null,
  jobs: JobRegistry | null = null,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/api/whale-pet/progress') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    if (store === null || sessionQuery === null) {
      sendJson(res, 503, { error: 'session store unavailable' })
      return
    }
    const rawId = url.searchParams.get('session')
    if (rawId === null || rawId === '') {
      sendJson(res, 400, { error: 'missing session id' })
      return
    }
    const sessionId = SessionId(rawId)
    const session = store.get(sessionId)
    if (session === undefined) {
      sendJson(res, 404, { error: 'session not found' })
      return
    }
    const observation = await sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    let summary: SessionProgressSummary
    try {
      summary = summarizeSession(observation.events, Date.now())
    } finally {
      observation[Symbol.dispose]()
    }
    // Probe the jobs registry for running background tasks (real state +
    // output tail) — the "主动探寻" part of a progress question.
    if (jobs !== null) {
      try {
        const caller = SessionId(rawId)
        const runningJobs = summarizeJobs(jobs.list(caller), id => {
          const job = jobs.get(id, caller)
          const from = Math.max(job.output.earliest, job.output.total - JOB_OUTPUT_TAIL_LIMIT)
          return jobs.readAt(id, from, caller).chunks.map(chunk => chunk.text).join('')
        })
        if (runningJobs.length > 0) summary.jobs = runningJobs
      } catch {
        // Jobs registry unavailable; the event-log summary still stands.
      }
    }
    sendJson(res, 200, summary)
  }
}
