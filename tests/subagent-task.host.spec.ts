import { describe, expect, it } from 'vitest'
import { createTaskHandler } from '../src/subagent-task.ts'
import { createServer } from 'node:http'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'

function httpPost(port: number, path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: text === '' ? null : JSON.parse(text) })
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify(payload))
  })
}

interface FakeAgent {
  followupCalls: Array<{ content: Array<{ type: string; text: string }> }>
  cancelled: boolean
  session: {
    id: string
    events: Array<{ type: string; data: Record<string, unknown> }>
  }
  followup(message: { content: Array<{ type: string; text: string }> }): void
  whenIdle(): Promise<void>
  cancel(options: { kind: string }): void
}

function fakeAgent(events: Array<{ type: string; data: Record<string, unknown> }>): FakeAgent {
  return {
    followupCalls: [],
    cancelled: false,
    session: { id: 'child-session-1', events },
    followup(message) {
      this.followupCalls.push({ content: message.content })
    },
    async whenIdle(): Promise<void> {},
    cancel(options: { kind: string }): void {
      this.cancelled = true
    },
  }
}

function fakeAgents(agent: FakeAgent): AgentRegistry & { createCalls: number } {
  return {
    createCalls: 0,
    async create(): Promise<{ agent: FakeAgent; dispose(): Promise<void> }> {
      this.createCalls += 1
      return { agent, dispose: async () => {} }
    },
    currentInitiator(): unknown {
      return undefined
    },
  } as unknown as AgentRegistry & { createCalls: number }
}

async function serve(agents: AgentRegistry): Promise<{ port: number; close: () => void }> {
  const server = createServer(createTaskHandler(agents, null, () => '/tmp/workspace'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { port, close: () => server.close() }
}

const completedEvents = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '写好了，hello.py 输出 42' }] } } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

const errorEvents = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'E_X' } } } },
]

describe('createTaskHandler', () => {
  it('runs a child agent and returns its final assistant text', async () => {
    const agent = fakeAgent(completedEvents)
    const agents = fakeAgents(agent)
    const proxy = await serve(agents)
    try {
      const result = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '帮我写 hello.py', session: 'sess-1' })
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({
        output: '写好了，hello.py 输出 42',
        sessionId: 'child-session-1',
        completed: true,
      })
      expect(agent.followupCalls).toHaveLength(1)
      expect(agent.followupCalls[0]?.content[0]?.text).toContain('任务：帮我写 hello.py')
      expect(agents.createCalls).toBe(1)
      expect(agent.cancelled).toBe(false)
    } finally {
      proxy.close()
    }
  })

  it('surfaces turn errors instead of an empty bubble', async () => {
    const agent = fakeAgent(errorEvents)
    const agents = fakeAgents(agent)
    const proxy = await serve(agents)
    try {
      const result = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '跑一下' })
      expect(result.status).toBe(200)
      expect(JSON.stringify(result.body)).toContain('boom')
      expect(result.body).toMatchObject({ completed: false })
    } finally {
      proxy.close()
    }
  })

  it('rejects empty prompts and missing bodies', async () => {
    const agents = fakeAgents(fakeAgent(completedEvents))
    const proxy = await serve(agents)
    try {
      const empty = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '   ' })
      expect(empty.status).toBe(400)
      const missing = await httpPost(proxy.port, '/api/whale-pet/task', { nope: true })
      expect(missing.status).toBe(400)
    } finally {
      proxy.close()
    }
  })
})
