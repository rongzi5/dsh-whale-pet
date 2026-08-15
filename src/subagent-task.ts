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

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SessionId, type SessionStore } from '@deepseek-ai/dsh-session'

/** How long a pet-dispatched task may run before reporting "still running". */
export const TASK_TIMEOUT_MS = 60_000
/** Final-output text cap returned to the pet bubble. */
export const TASK_OUTPUT_LIMIT = 1_200

export interface TaskRequest {
  /** The task description given to the child agent. */
  prompt: string
  /** Optional label shown in the subagent UI. */
  label?: string
}

export interface TaskResponse {
  /** The child agent's final output text. */
  output: string
  /** The child session id — openable in the DSH UI. */
  sessionId: string
  /** Whether the child finished within the timeout. */
  completed: boolean
}

/** Extract the plain text from a result's content blocks. */
function textOf(blocks: ReadonlyArray<{ type?: string; text?: unknown }> | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
    .trim()
}

/** Default persona for pet-dispatched child agents. */
function taskPersona(prompt: string): string {
  return [
    '你是 DeepSeek Harness 里的任务助手，桌宠鲸鲸替用户派发了这个任务。',
    '请独立完成它：可以调用工具（bash、文件、搜索等）实际执行，不要只给方案。',
    '任务完成后，用一段简洁的总结说明你做了什么和最终结果（含关键输出）。',
    `任务：${prompt}`,
  ].join('\n')
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/** Bound body-size guard for task requests (64 KiB). */
export const TASK_MAX_BODY_BYTES = 64 * 1024

async function readJsonBody(
  req: IncomingMessage,
  limit = TASK_MAX_BODY_BYTES,
): Promise<unknown | null> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit) return null
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

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
export function createTaskHandler(
  subagents: SubagentRuntime,
  agents: AgentRegistry,
  sessions: SessionStore | null,
  workspaceRoot: () => string | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/api/whale-pet/task') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    const body = await readJsonBody(req)
    if (body === null || typeof body !== 'object') {
      sendJson(res, 400, { error: 'request body must be JSON: { prompt: string, session?: string }' })
      return
    }
    const record = body as { prompt?: unknown; label?: unknown; session?: unknown }
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    if (prompt === '') {
      sendJson(res, 400, { error: 'missing prompt' })
      return
    }
    const label = typeof record.label === 'string' && record.label !== '' ? record.label.slice(0, 40) : '鲸鲸的任务'
    const callerSessionId = typeof record.session === 'string' && record.session !== '' ? record.session : undefined
    const providers = subagents.list()
    const provider = providers[0]
    if (provider === undefined) {
      sendJson(res, 503, { error: 'no subagent provider registered' })
      return
    }

    let parent = agents.currentInitiator() ?? undefined
    let parentHandle: { dispose(): Promise<void> } | null = null
    try {
      if (parent === undefined) {
        // No active agent: create a fresh parent identity in the caller's
        // workspace (cwd from the caller session header when known, so the
        // child session lands in the right workspace directory and shows in
        // the session list).
        const cwd = callerSessionId !== undefined && sessions !== null
          ? (() => {
            try {
              return sessions.get(SessionId(callerSessionId))?.header.cwd
            } catch {
              return undefined
            }
          })()
          : undefined
        const handle = await agents.create({
          sessionId: SessionId(randomUUID()),
          meta: {
            ...(cwd !== undefined ? { cwd } : {}),
            ...(cwd === undefined && workspaceRoot() !== undefined ? { cwd: workspaceRoot() } : {}),
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        parentHandle = handle
        parent = handle.agent
      }
      const signal = AbortSignal.timeout(TASK_TIMEOUT_MS)
      const run = await subagents.start(provider, {
        label,
        prompt: [{ type: 'text', text: taskPersona(prompt) }],
        parent,
        signal,
      })
      let output = ''
      let completed = true
      try {
        const result = await run.result
        output = textOf(result.output).slice(0, TASK_OUTPUT_LIMIT)
      } catch (error) {
        completed = false
        output = error instanceof Error ? error.message : String(error)
      }
      const response: TaskResponse = {
        output,
        sessionId: run.id,
        completed,
      }
      sendJson(res, 200, response)
    } finally {
      await parentHandle?.dispose().catch(() => {})
    }
  }
}
