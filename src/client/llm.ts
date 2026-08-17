/**
 * Browser-side LLM transport for the whale pet.
 *
 * Talks to the same-origin host proxy (`/api/whale-pet/chat`,
 * `/api/whale-pet/models` and `/api/whale-pet/progress`) so no API key and no
 * cross-origin request ever leaves the harness page. The transport is
 * injectable so headless tests can fake the upstream.
 */

import type { WhaleSessionProgress } from './progress.ts'

export interface WhaleChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Per-request overrides chosen in the pet's chat bubble. */
export interface WhaleChatOptions {
  provider?: string
  model?: string
  /** Adapter-owned reasoning effort id, when the model exposes efforts. */
  effort?: string
}

/** One selectable reasoning effort for a model. */
export interface WhaleEffortOption {
  id: string
  name: string
}

/** One selectable model. */
export interface WhaleModelOption {
  id: string
  name: string
  description?: string
  efforts: readonly WhaleEffortOption[]
  defaultEffort?: string
}

/** One selectable provider route. */
export interface WhaleProviderOption {
  id: string
  name: string
  models: readonly WhaleModelOption[]
}

/** The catalog served at `/api/whale-pet/models`. */
export interface WhaleModelCatalog {
  providers: readonly WhaleProviderOption[]
  default: { provider: string; model: string }
}

/** The chat surface the coordinator depends on. */
export interface WhaleChatTransport {
  postChat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): Promise<string>
  /**
   * Optional token stream. When present the coordinator updates the bubble
   * incrementally; absent transports keep the one-shot `postChat` path.
   */
  streamChat?(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): AsyncIterable<string>
  listModels(): Promise<WhaleModelCatalog>
  /**
   * Optional fine-grained session progress from the host event log. Absent
   * transports degrade to the observer's coarse snapshot.
   */
  getProgress?(sessionId: string): Promise<WhaleSessionProgress>
  /**
   * Optional subagent task dispatch: spawn a real child conversation in the
   * workspace and wait for its final output. `sessionId` anchors the child
   * to the caller's workspace (cwd from the session header).
   */
  runTask?(prompt: string, label?: string, sessionId?: string): Promise<WhaleTaskResult>
}

/** Result of a pet-dispatched subagent task. */
export interface WhaleTaskResult {
  /** The child agent's final output text. */
  output: string
  /** The child session id — openable in the DSH UI. */
  sessionId: string
  /** Whether the child finished within the host timeout. */
  completed: boolean
}

export const CHAT_PROXY_PATH = '/api/whale-pet/chat'
export const MODELS_PROXY_PATH = '/api/whale-pet/models'
export const PROGRESS_PROXY_PATH = '/api/whale-pet/progress'
export const TASK_PROXY_PATH = '/api/whale-pet/task'
export const CHAT_TIMEOUT_MS = 60_000
/** Fine progress is best-effort: keep the chat snappy when it is slow. */
export const PROGRESS_TIMEOUT_MS = 1_500
/** Task dispatch may run a real child agent; outlast the host timeout so the
 * "still running" response (with the child session id) reaches the pet. */
export const TASK_TIMEOUT_MS = 70_000

async function proxyJson<T>(path: string, init: RequestInit, timeoutMs = CHAT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(path, { ...init, signal: controller.signal })
    const payload = await res.json().catch(() => null) as (T & { error?: unknown }) | null
    if (!res.ok) {
      const detail = typeof payload?.error === 'string' ? payload.error : `HTTP ${res.status}`
      throw new Error(detail)
    }
    if (payload === null) throw new Error(`HTTP ${res.status}`)
    return payload
  } finally {
    clearTimeout(timer)
  }
}

/** Parse `text/event-stream` chat deltas from the host proxy. */
export async function* readSseDeltas(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const events = buffer.split('\n\n')
      buffer = done ? '' : (events.pop() ?? '')
      for (const event of events) {
        const data = event.split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n')
        if (data === '') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        if (typeof parsed !== 'object' || parsed === null) continue
        const record = parsed as { delta?: unknown; done?: unknown; error?: unknown }
        if (typeof record.error === 'string' && record.error !== '') throw new Error(record.error)
        if (typeof record.delta === 'string' && record.delta !== '') yield record.delta
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}

/** Default transport: same-origin fetch to the host-side chat proxy. */
export const localChatTransport: WhaleChatTransport = {
  async postChat(messages, options): Promise<string> {
    const payload = await proxyJson<{ content?: unknown }>(CHAT_PROXY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, ...options }),
    })
    if (typeof payload.content !== 'string' || payload.content === '') {
      throw new Error('空回复')
    }
    return payload.content
  },

  async *streamChat(messages, options): AsyncIterable<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
    try {
      const res = await fetch(CHAT_PROXY_PATH, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ messages, ...options }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: unknown } | null
        const detail = typeof payload?.error === 'string' ? payload.error : `HTTP ${res.status}`
        throw new Error(detail)
      }
      if (res.body === null) throw new Error('空回复')
      yield* readSseDeltas(res.body)
    } finally {
      clearTimeout(timer)
    }
  },

  async listModels(): Promise<WhaleModelCatalog> {
    return proxyJson<WhaleModelCatalog>(MODELS_PROXY_PATH, { method: 'GET' })
  },

  async getProgress(sessionId): Promise<WhaleSessionProgress> {
    return proxyJson<WhaleSessionProgress>(
      `${PROGRESS_PROXY_PATH}?session=${encodeURIComponent(sessionId)}`,
      { method: 'GET' },
      PROGRESS_TIMEOUT_MS,
    )
  },

  async runTask(prompt, label, sessionId): Promise<WhaleTaskResult> {
    return proxyJson<WhaleTaskResult>(
      TASK_PROXY_PATH,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, ...(label !== undefined ? { label } : {}), ...(sessionId !== undefined ? { session: sessionId } : {}) }),
      },
      TASK_TIMEOUT_MS,
    )
  },
}
