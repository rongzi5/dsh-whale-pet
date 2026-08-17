import { describe, expect, it } from 'vitest'
import { createChatProxyHandler, directBackend, forwardChat, resolveChatProxyConfig, UpstreamError, writeChatSse } from '../src/chat-proxy.ts'
import { createServer, type Server } from 'node:http'
import { request } from 'node:http'

/** Minimal fake upstream: OpenAI-compatible /chat/completions. */
function startUpstream(handler: (body: unknown, headers: Record<string, string | undefined>) => { status?: number; body: unknown }): Promise<{ server: Server; port: number; requests: Array<{ body: unknown; auth: string | undefined }> }> {
  const requests: Array<{ body: unknown; auth: string | undefined }> = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      requests.push({ body, auth: req.headers.authorization })
      const result = handler(body, req.headers as Record<string, string | undefined>)
      res.writeHead(result.status ?? 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result.body))
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address !== null ? address.port : 0, requests })
    })
  })
}

function httpRequest(port: number, path: string, method: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: payload !== undefined ? { 'content-type': 'application/json' } : {},
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: text === '' ? null : JSON.parse(text) })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.end(JSON.stringify(payload))
    else req.end()
  })
}

/** Serve a backend under a real HTTP server and return its port. */
async function serve(backend: ReturnType<typeof directBackend>): Promise<{ port: number; close: () => void }> {
  const server = createServer(createChatProxyHandler(backend))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { port, close: () => server.close() }
}

describe('resolveChatProxyConfig', () => {
  it('prefers plugin config over env, then defaults', () => {
    expect(resolveChatProxyConfig({}, { apiKey: 'cfg-key', baseUrl: 'https://x.example/', model: 'm1' })).toEqual({
      apiKey: 'cfg-key',
      baseUrl: 'https://x.example',
      model: 'm1',
    })
    expect(resolveChatProxyConfig({ apiKey: 'env-key' })).toMatchObject({ apiKey: 'env-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
  })

  it('returns null without any key', () => {
    expect(resolveChatProxyConfig({})).toBeNull()
  })
})

describe('forwardChat', () => {
  it('posts OpenAI-compatible payload and returns the assistant content', async () => {
    const { server, port, requests } = await startUpstream(() => ({
      body: { choices: [{ message: { content: '你好呀！' } }] },
    }))
    try {
      const { content } = await forwardChat({ apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat' }, [
        { role: 'user', content: 'hi' },
      ])
      expect(content).toBe('你好呀！')
      expect(requests[0]?.auth).toBe('Bearer sk-test')
      expect(requests[0]?.body).toMatchObject({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], stream: false })
    } finally {
      server.close()
    }
  })

  it('honors the model override', async () => {
    const { server, port, requests } = await startUpstream(() => ({ body: { choices: [{ message: { content: 'x' } }] } }))
    try {
      await forwardChat({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'default' }, [], 'override-model')
      expect(requests[0]?.body).toMatchObject({ model: 'override-model' })
    } finally {
      server.close()
    }
  })

  it('throws UpstreamError on non-2xx with the upstream status', async () => {
    const { server, port } = await startUpstream(() => ({ status: 429, body: { error: { message: 'rate limited' } } }))
    try {
      await expect(forwardChat({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'm' }, [])).rejects.toMatchObject({
        name: 'UpstreamError',
        status: 429,
      })
    } finally {
      server.close()
    }
  })
})

describe('createChatProxyHandler (direct backend, end-to-end)', () => {
  it('proxies a chat request and returns { content }', async () => {
    const upstream = await startUpstream(() => ({ body: { choices: [{ message: { content: '喵' } }] } }))
    const proxy = await serve(directBackend(() => ({
      apiKey: 'sk-test',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      model: 'deepseek-chat',
    })))
    try {
      const result = await httpRequest(proxy.port, '/api/whale-pet/chat', 'POST', { messages: [{ role: 'user', content: '在吗' }] })
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ ok: true, content: '喵' })
      expect(upstream.requests[0]?.auth).toBe('Bearer sk-test')
    } finally {
      proxy.close()
      upstream.server.close()
    }
  })

  it('forwards the chosen model and ignores effort in direct mode', async () => {
    const upstream = await startUpstream(() => ({ body: { choices: [{ message: { content: 'x' } }] } }))
    const proxy = await serve(directBackend(() => ({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      model: 'default',
    })))
    try {
      await httpRequest(proxy.port, '/api/whale-pet/chat', 'POST', {
        messages: [{ role: 'user', content: 'hi' }],
        provider: 'direct',
        model: 'chosen-model',
        effort: 'high',
      })
      expect(upstream.requests[0]?.body).toMatchObject({ model: 'chosen-model' })
    } finally {
      proxy.close()
      upstream.server.close()
    }
  })

  it('reports 503 with a clear error when no key is configured', async () => {
    const proxy = await serve(directBackend(() => null))
    try {
      const result = await httpRequest(proxy.port, '/api/whale-pet/chat', 'POST', { messages: [{ role: 'user', content: 'hi' }] })
      expect(result.status).toBe(503)
      expect(JSON.stringify(result.body)).toContain('DSH_WHALE_API_KEY')
    } finally {
      proxy.close()
    }
  })

  it('serves the model catalog with the single configured model', async () => {
    const proxy = await serve(directBackend(() => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1', model: 'deepseek-chat' })))
    try {
      const result = await httpRequest(proxy.port, '/api/whale-pet/models', 'GET')
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({
        providers: [{ id: 'direct', name: '直连', models: [{ id: 'deepseek-chat', efforts: [] }] }],
        default: { provider: 'direct', model: 'deepseek-chat' },
      })
    } finally {
      proxy.close()
    }
  })

  it('rejects malformed bodies and wrong methods', async () => {
    const proxy = await serve(directBackend(() => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1', model: 'm' })))
    try {
      const bad = await httpRequest(proxy.port, '/api/whale-pet/chat', 'POST', { nope: true })
      expect(bad.status).toBe(400)
      const health = await httpRequest(proxy.port, '/api/whale-pet/health', 'GET')
      expect(health.status).toBe(200)
      expect(health.body).toEqual({ ok: true, configured: true })
      const missing = await httpRequest(proxy.port, '/api/whale-pet/chat', 'GET')
      expect(missing.status).toBe(405)
      const unknown = await httpRequest(proxy.port, '/api/whale-pet/nope', 'GET')
      expect(unknown.status).toBe(404)
    } finally {
      proxy.close()
    }
  })

  it('streams SSE deltas when Accept is text/event-stream', async () => {
    const upstream = await startUpstream(() => ({
      body: { choices: [{ message: { content: '你好呀！' } }] },
    }))
    const proxy = await serve(directBackend(() => ({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      model: 'm',
    })))
    try {
      const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const req = request({
          host: '127.0.0.1',
          port: proxy.port,
          path: '/api/whale-pet/chat',
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        }, res => {
          const chunks: Buffer[] = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject)
        req.end(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }))
      })
      expect(result.status).toBe(200)
      expect(result.text).toContain('"delta":"你好呀！"')
      expect(result.text).toContain('"done":true')
    } finally {
      proxy.close()
      upstream.server.close()
    }
  })

  it('surfaces upstream failures with the observed status', async () => {
    const upstream = await startUpstream(() => ({ status: 500, body: { error: 'boom' } }))
    const proxy = await serve(directBackend(() => ({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      model: 'm',
    })))
    try {
      const result = await httpRequest(proxy.port, '/api/whale-pet/chat', 'POST', { messages: [{ role: 'user', content: 'hi' }] })
      expect(result.status).toBe(500)
      expect(JSON.stringify(result.body)).toContain('boom')
    } finally {
      proxy.close()
      upstream.server.close()
    }
  })
})
