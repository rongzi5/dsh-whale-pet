import { describe, expect, it } from 'vitest'
import { createTaskHandler } from '../src/subagent-task.ts'
import { createServer } from 'node:http'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
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

function fakeAgents(initiator = true): AgentRegistry & { created: number } {
  const agent = { id: 'parent-agent' } as never
  const created = { count: 0 }
  return {
    created: 0,
    currentInitiator(): unknown {
      return initiator ? agent : undefined
    },
    async create(options: { sessionId: unknown }): Promise<{ agent: unknown; dispose(): Promise<void> }> {
      created.count += 1
      this.created = created.count
      return { agent, dispose: async () => {} }
    },
  } as unknown as AgentRegistry & { created: number }
}

function fakeSubagents(resultText: string, fail = false): SubagentRuntime & { calls: Array<{ label?: string; prompt: unknown; parent: unknown }> } {
  const calls: Array<{ label?: string; prompt: unknown; parent: unknown }> = []
  return {
    calls,
    list(): string[] {
      return ['in-process']
    },
    async start(_name: string, request: { label?: string; prompt: unknown; parent: unknown; signal: AbortSignal }) {
      calls.push({ label: request.label, prompt: request.prompt, parent: request.parent })
      const result = fail
        ? Promise.reject(new Error('child crashed'))
        : Promise.resolve({ output: [{ type: 'text', text: resultText }], stopReason: 'completed' })
      return { id: 'child-session-1', localAgent: undefined, result, dispose: async () => {} }
    },
  } as unknown as SubagentRuntime & { calls: Array<{ label?: string; prompt: unknown; parent: unknown }> }
}

async function serve(subagents: SubagentRuntime, agents: AgentRegistry): Promise<{ port: number; close: () => void }> {
  const server = createServer(createTaskHandler(subagents, agents, null, () => '/tmp/workspace'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { port, close: () => server.close() }
}

describe('createTaskHandler', () => {
  it('dispatches a subagent task with the current initiator as parent', async () => {
    const subagents = fakeSubagents('任务完成：写了 hello.py')
    const agents = fakeAgents(true)
    const proxy = await serve(subagents, agents)
    try {
      const result = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '帮我写一个 hello.py' })
      expect(result.status).toBe(200)
      expect(result.body).toEqual({
        output: '任务完成：写了 hello.py',
        sessionId: 'child-session-1',
        completed: true,
      })
      expect(subagents.calls).toHaveLength(1)
      expect(subagents.calls[0]?.label).toBe('鲸鲸的任务')
      expect(agents.created).toBe(0)
    } finally {
      proxy.close()
    }
  })

  it('creates a fresh parent agent when no initiator is active', async () => {
    const subagents = fakeSubagents('ok')
    const agents = fakeAgents(false)
    const proxy = await serve(subagents, agents)
    try {
      const result = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '调研一下' })
      expect(result.status).toBe(200)
      expect(agents.created).toBe(1)
      expect(result.body).toMatchObject({ completed: true })
    } finally {
      proxy.close()
    }
  })

  it('reports still-running with the child session id on failure', async () => {
    const subagents = fakeSubagents('', true)
    const agents = fakeAgents(true)
    const proxy = await serve(subagents, agents)
    try {
      const result = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '跑个长任务' })
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ completed: false, sessionId: 'child-session-1' })
      expect(JSON.stringify(result.body)).toContain('child crashed')
    } finally {
      proxy.close()
    }
  })

  it('rejects empty prompts and missing bodies', async () => {
    const subagents = fakeSubagents('x')
    const agents = fakeAgents(true)
    const proxy = await serve(subagents, agents)
    try {
      const empty = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: '   ' })
      expect(empty.status).toBe(400)
      const missing = await httpPost(proxy.port, '/api/whale-pet/task', { nope: true })
      expect(missing.status).toBe(400)
    } finally {
      proxy.close()
    }
  })

  it('reports 503 without a subagent provider', async () => {
    const subagents = { list: () => [] } as unknown as SubagentRuntime
    const agents = fakeAgents(true)
    const proxy = await serve(subagents, agents)
    try {
      const result = await httpPost(proxy.port, '/api/whale-pet/task', { prompt: 'hi' })
      expect(result.status).toBe(503)
    } finally {
      proxy.close()
    }
  })
})
