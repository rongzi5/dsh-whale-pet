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

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type SessionStore } from '@deepseek-ai/dsh-session'

/** How long a pet-dispatched task may run before reporting "still running". */
export const TASK_TIMEOUT_MS = 60_000
/** Final-output text cap returned to the pet bubble. */
export const TASK_OUTPUT_LIMIT = 1_200

export interface TaskResponse {
  /** The child agent's final output text. */
  output: string
  /** The child session id — openable in the DSH UI. */
  sessionId: string
  /** Whether the child finished within the timeout. */
  completed: boolean
  /** Diagnostic: how the child settled and how many events it produced. */
  debug?: { stopReason: string; eventCount: number; eventTypes?: string[]; turnEndReason?: unknown }
}

/** Extract the plain text from message content blocks. */
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
  // The first line seeds the session title ("鲸鲸的任务：…").
  const firstLine = prompt.split('\n')[0]?.trim() ?? prompt
  return [
    `鲸鲸的任务：${firstLine.slice(0, 40)}`,
    '',
    '你是 DeepSeek Harness 里的任务助手，桌宠鲸鲸替用户派发了这个任务。',
    '请独立完成它：可以调用工具（bash、文件、搜索等）实际执行，不要只给方案。',
    '任务完成后，用一段简洁的总结说明你做了什么和最终结果（含关键输出）。',
    `完整任务：${prompt}`,
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

/** Settle reason of a child turn, for diagnostics. */
function turnEndReasonOf(events: readonly SessionEvent[]): unknown {
  for (const event of [...events].reverse()) {
    if (event.type === 'turn/end') return event.data.reason
  }
  return undefined
}

/** Final assistant text of a child session, for the result. */
function finalAssistantText(events: readonly SessionEvent[]): string {
  for (const event of [...events].reverse()) {
    if (event.type === 'assistant/message') {
      const text = textOf(event.data.message.content)
      if (text !== '') return text
    }
  }
  return ''
}

/**
 * Build the `POST /api/whale-pet/task` handler.
 *
 * The child is created directly via the agent registry (workspace cwd from
 * the caller session header, deployment preset and default model), given one
 * user message, and awaited until idle. The child session is deliberately
 * NOT disposed so it stays in the workspace session list.
 */
export function createTaskHandler(
  agents: AgentRegistry,
  sessions: SessionStore | null,
  workspaceRoot: () => string | undefined,
  defaultPreset: () => string | undefined = () => undefined,
  defaultModel: () => { provider?: string; model?: string } | undefined = () => undefined,
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
    const callerSessionId = typeof record.session === 'string' && record.session !== '' ? record.session : undefined

    const cwd = callerSessionId !== undefined && sessions !== null
      ? (() => {
        try {
          return sessions.get(SessionId(callerSessionId))?.header.cwd
        } catch {
          return undefined
        }
      })()
      : undefined
    const resolvedCwd = cwd ?? workspaceRoot()
    const preset = defaultPreset()
    const model = defaultModel()
    const agentOptions = model?.provider !== undefined && model?.model !== undefined
      ? { provider: model.provider, model: model.model }
      : undefined

    let handle: { agent: Agent; dispose(): Promise<void> } | null = null
    try {
      handle = await agents.create({
        sessionId: SessionId(randomUUID()),
        meta: {
          ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
          ...(preset !== undefined ? { agentPreset: preset } : {}),
          ...(callerSessionId !== undefined ? { parentSession: SessionId(callerSessionId) } : {}),
          delegationDepth: 1,
        },
        ...(agentOptions !== undefined ? { agentOptions } : {}),
      })
      const child = handle.agent
      const signal = AbortSignal.timeout(TASK_TIMEOUT_MS)
      const onAbort = (): void => {
        try {
          child.cancel({ kind: 'parent' })
        } catch {
          // Already settled; cancellation is best-effort.
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      let stopReason = 'unknown'
      try {
        child.followup(createUserMessage({
          content: [{ type: 'text', text: taskPersona(prompt) }],
          source: { kind: 'user' },
        }))
        await child.whenIdle()
        stopReason = 'completed'
      } catch (error) {
        stopReason = error instanceof Error ? error.message : String(error)
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
      const events = child.session.events
      const reason = turnEndReasonOf(events)
      const reasonKind = typeof reason === 'object' && reason !== null && (reason as { kind?: unknown }).kind === 'error' ? 'error' : 'completed'
      let output = finalAssistantText(events).slice(0, TASK_OUTPUT_LIMIT)
      if (output === '' && reasonKind === 'error') {
        // Surface the failure detail instead of an empty bubble.
        const failure = (reason as { error?: { message?: string; code?: string } } | undefined)?.error
        output = failure !== undefined
          ? `子代理回合出错：${failure.code ?? ''} ${failure.message ?? ''}`.trim().slice(0, 300)
          : '子代理回合出错'
      }
      const response: TaskResponse = {
        output,
        sessionId: child.session.id,
        completed: reasonKind === 'completed' && output !== '',
        debug: {
          stopReason,
          eventCount: events.length,
          eventTypes: [...new Set(events.map(event => event.type))],
          turnEndReason: reason,
        },
      }
      sendJson(res, 200, response)
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message.slice(0, 300) : String(error) })
    }
    // Deliberately NOT disposing the child: it stays in the session store and
    // the workspace session list so the user can open the conversation.
  }
}
