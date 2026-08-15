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
  listModels(): Promise<WhaleModelCatalog>
  /**
   * Optional fine-grained session progress from the host event log. Absent
   * transports degrade to the observer's coarse snapshot.
   */
  getProgress?(sessionId: string): Promise<WhaleSessionProgress>
}

export const CHAT_PROXY_PATH = '/api/whale-pet/chat'
export const MODELS_PROXY_PATH = '/api/whale-pet/models'
export const PROGRESS_PROXY_PATH = '/api/whale-pet/progress'
export const CHAT_TIMEOUT_MS = 60_000
/** Fine progress is best-effort: keep the chat snappy when it is slow. */
export const PROGRESS_TIMEOUT_MS = 1_500

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
}
