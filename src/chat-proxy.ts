/**
 * Host-side LLM chat proxy for the whale pet.
 *
 * The browser client talks to a same-origin endpoint (`/api/whale-pet/chat`)
 * and this module forwards OpenAI-compatible chat completions to the upstream
 * provider with a server-held API key, so the key never enters the browser.
 * Pure Node logic (no cordis imports) so it stays unit-testable against a
 * local fake upstream.
 *
 * The proxy is backend-agnostic: a `WhaleChatBackend` both lists the selectable
 * models (with their reasoning efforts) and executes one chat. Two backends
 * exist — the direct upstream proxy (`directBackend`) and the dsh LLM service
 * (`LlmBackend` in llm-backend.ts) — and the host entry picks one.
 */

export interface ChatProxyConfig {
  /** Upstream bearer token. */
  apiKey: string
  /** Upstream origin, e.g. https://api.deepseek.com. */
  baseUrl: string
  /** Default model name, e.g. deepseek-chat. */
  model: string
  /** Upstream request timeout in milliseconds. */
  timeoutMs?: number
}

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
  /** Reasoning efforts in display order; empty = fixed reasoning/no choice. */
  efforts: readonly WhaleEffortOption[]
  /** The effort used when the caller omits one. */
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

/** The execution surface the HTTP handler delegates to. */
export interface WhaleChatBackend {
  /** Whether a chat can currently succeed (key present / llm service up). */
  available(): boolean | Promise<boolean>
  listModels(): Promise<WhaleModelCatalog>
  chat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): Promise<{ content: string }>
  /**
   * Optional token stream. When present the HTTP handler can emit SSE
   * (`text/event-stream`) instead of a single JSON body. Backends without a
   * live upstream stream may yield the full reply as one delta.
   */
  streamChat?(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): AsyncIterable<string>
}

/** Upstream returned a non-2xx status; carries the observed status. */
export class UpstreamError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

/** No usable backend configuration (no key, no llm service). */
export class UnconfiguredError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'UnconfiguredError'
  }
}

/** Resolve the effective direct-proxy config from env + plugin config; null = unusable. */
export function resolveChatProxyConfig(
  env: { apiKey?: string; baseUrl?: string; model?: string },
  config?: { apiKey?: string; baseUrl?: string; model?: string },
): ChatProxyConfig | null {
  const apiKey = config?.apiKey ?? env.apiKey ?? ''
  if (apiKey.trim() === '') return null
  return {
    apiKey: apiKey.trim(),
    baseUrl: (config?.baseUrl ?? env.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: config?.model ?? env.model ?? 'deepseek-chat',
  }
}

/**
 * Forward one chat-completions request to the upstream provider and return
 * the assistant text. Throws {@link UpstreamError} on upstream failures.
 */
export async function forwardChat(
  config: ChatProxyConfig,
  messages: readonly WhaleChatMessage[],
  modelOverride?: string,
): Promise<{ content: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 60_000)
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: modelOverride ?? config.model,
        messages,
        stream: false,
        max_tokens: 300,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = await res.text()
      } catch {
        detail = ''
      }
      throw new UpstreamError(`upstream ${res.status}: ${detail.slice(0, 300)}`, res.status)
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      throw new UpstreamError('upstream returned an empty completion', 502)
    }
    return { content }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Direct-upstream backend: the API key is resolved per request from
 * env/plugin config/credentials, and the model catalog is the single
 * configured model (no efforts — the upstream adapter is a plain
 * OpenAI-compatible endpoint).
 */
export function directBackend(
  resolve: () => ChatProxyConfig | null | Promise<ChatProxyConfig | null>,
): WhaleChatBackend {
  const catalog = (config: ChatProxyConfig): WhaleModelCatalog => ({
    providers: [
      {
        id: 'direct',
        name: '直连',
        models: [
          {
            id: config.model,
            name: config.model,
            efforts: [],
          },
        ],
      },
    ],
    default: { provider: 'direct', model: config.model },
  })
  return {
    async available(): Promise<boolean> {
      return (await resolve()) !== null
    },
    async listModels(): Promise<WhaleModelCatalog> {
      const config = await resolve()
      if (config === null) throw new UnconfiguredError(
        'whale-pet chat: no API key configured (set DSH_WHALE_API_KEY / DEEPSEEK_API_KEY env or plugin config.apiKey)',
      )
      return catalog(config)
    },
    async chat(messages, options): Promise<{ content: string }> {
      const config = await resolve()
      if (config === null) throw new UnconfiguredError(
        'whale-pet chat: no API key configured (set DSH_WHALE_API_KEY / DEEPSEEK_API_KEY env or plugin config.apiKey)',
      )
      // The direct mode has a single model; effort is not mapped upstream.
      return forwardChat(config, messages, options?.model ?? config.model)
    },
    async *streamChat(messages, options): AsyncIterable<string> {
      const { content } = await this.chat(messages, options)
      if (content !== '') yield content
    },
  }
}

/** Bound body-size guard for proxy requests (64 KiB). */
export const PROXY_MAX_BODY_BYTES = 64 * 1024

/** Read and parse a JSON request body, respecting the size cap. */
export async function readJsonBody(
  req: { headers: Record<string, string | string[] | undefined>; [Symbol.asyncIterator](): AsyncIterator<Buffer> },
  limit = PROXY_MAX_BODY_BYTES,
): Promise<unknown | null> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit) return null
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > limit) return null
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function sendJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(text: string): unknown }, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * Build the HTTP handler for the `/api/whale-pet` prefix.
 * Endpoints:
 * - GET  /api/whale-pet/health → { ok, configured }
 * - GET  /api/whale-pet/models  → the selectable model catalog
 * - POST /api/whale-pet/chat   → { content } (with optional provider/model/effort)
 *   Accept: text/event-stream  → SSE `data: {"delta"}` then `data: {"done":true}`
 */
export function createChatProxyHandler(
  backend: WhaleChatBackend,
): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (pathname === '/api/whale-pet/health') {
      let configured = false
      try {
        configured = await backend.available()
      } catch {
        configured = false
      }
      sendJson(res, 200, { ok: true, configured })
      return
    }
    if (pathname === '/api/whale-pet/models') {
      if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        sendJson(res, 200, await backend.listModels())
      } catch (error) {
        sendJson(res, 503, { error: error instanceof Error ? error.message.slice(0, 300) : String(error) })
      }
      return
    }
    if (pathname !== '/api/whale-pet/chat') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      body = null
    }
    if (
      body === null
      || typeof body !== 'object'
      || !Array.isArray((body as { messages?: unknown }).messages)
      || (body as { messages: unknown[] }).messages.length === 0
    ) {
      sendJson(res, 400, { error: 'request body must be JSON: { messages: [{ role, content }], provider?, model?, effort? }' })
      return
    }
    const record = body as { messages: WhaleChatMessage[]; provider?: unknown; model?: unknown; effort?: unknown }
    const options: WhaleChatOptions = {
      ...(typeof record.provider === 'string' ? { provider: record.provider } : {}),
      ...(typeof record.model === 'string' ? { model: record.model } : {}),
      ...(typeof record.effort === 'string' ? { effort: record.effort } : {}),
    }
    const accept = String(req.headers.accept ?? '')
    const wantsStream = accept.includes('text/event-stream') && backend.streamChat !== undefined
    try {
      if (wantsStream) {
        await writeChatSse(res, backend.streamChat!(record.messages, options))
        return
      }
      const { content } = await backend.chat(record.messages, options)
      sendJson(res, 200, { ok: true, content })
    } catch (error) {
      if (error instanceof UnconfiguredError) {
        sendJson(res, 503, { ok: false, status: 503, error: error.message })
        return
      }
      const status = error instanceof UpstreamError ? error.status : 502
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, status, { ok: false, status, error: message.slice(0, 300) })
    }
  }
}

/** Write one SSE chat stream: delta events, then a terminal `{done:true}`. */
export async function writeChatSse(
  res: { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): unknown; end(text?: string): unknown },
  deltas: AsyncIterable<string>,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  try {
    for await (const delta of deltas) {
      if (delta === '') continue
      res.write(`data: ${JSON.stringify({ delta })}\n\n`)
    }
    res.write('data: {"done":true}\n\n')
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : String(error)
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    res.end()
  }
}
