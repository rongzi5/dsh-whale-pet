import { describe, expect, it } from 'vitest'
import { LlmBackend } from '../src/llm-backend.ts'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

/** Fake dsh-llm runtime: two providers, one reasoning model each. */
function fakeLlm(): LlmRuntime & { streamed: Array<Record<string, unknown>> } {
  const streamed: Array<Record<string, unknown>> = []
  const llm = {
    listProviders(): Array<{ id: string; name: string }> {
      return [
        { id: 'deepseek-official', name: 'DeepSeek 官方' },
        { id: 'other', name: '另一个' },
      ]
    },
    async listModels(provider: string): Promise<Array<{ id: string; name: string }>> {
      if (provider === 'deepseek-official') {
        return [
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
        ]
      }
      if (provider === 'other') return []
      throw new Error('unknown provider')
    },
    async resolveModelInfo(provider: string, model: string): Promise<{ reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> {
      if (provider === 'deepseek-official' && model === 'deepseek-reasoner') {
        return {
          reasoning: {
            efforts: [
              { id: 'low', name: '低' },
              { id: 'high', name: '高' },
            ],
            defaultEffort: 'low',
          },
        }
      }
      return {}
    },
    async *stream(options: Record<string, unknown>): AsyncGenerator<StreamChunk> {
      streamed.push(options)
      const chunks: StreamChunk[] = [
        { type: 'text-delta', index: 0, text: '你好' },
        { type: 'reasoning-delta', index: 0, text: '（思考中）' },
        { type: 'text-delta', index: 0, text: '呀！' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]
      for (const chunk of chunks) yield chunk
    },
  }
  return Object.assign(llm, { streamed }) as unknown as LlmRuntime & { streamed: Array<Record<string, unknown>> }
}

describe('LlmBackend.listModels', () => {
  it('aggregates providers, models and reasoning efforts', async () => {
    const llm = fakeLlm()
    const backend = new LlmBackend(llm)
    const catalog = await backend.listModels()
    expect(catalog.providers).toHaveLength(1)
    expect(catalog.providers[0]).toMatchObject({ id: 'deepseek-official', name: 'DeepSeek 官方' })
    const flash = catalog.providers[0]?.models.find(model => model.id === 'deepseek-v4-flash')
    const reasoner = catalog.providers[0]?.models.find(model => model.id === 'deepseek-reasoner')
    expect(flash?.efforts).toEqual([])
    expect(reasoner?.efforts).toEqual([
      { id: 'low', name: '低' },
      { id: 'high', name: '高' },
    ])
    expect(reasoner?.defaultEffort).toBe('low')
    expect(catalog.default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('memoizes the catalog', async () => {
    const llm = fakeLlm()
    const backend = new LlmBackend(llm)
    const first = await backend.listModels()
    const second = await backend.listModels()
    expect(second).toBe(first)
  })
})

describe('LlmBackend.chat', () => {
  it('streams one completion and aggregates visible text deltas', async () => {
    const llm = fakeLlm()
    const backend = new LlmBackend(llm)
    const { content } = await backend.chat(
      [
        { role: 'system', content: '你是鲸鲸' },
        { role: 'user', content: '你好' },
      ],
      { provider: 'deepseek-official', model: 'deepseek-reasoner', effort: 'high' },
    )
    expect(content).toBe('你好呀！')
    const request = llm.streamed[0]
    expect(request).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      system: '你是鲸鲸',
      reasoningEffort: 'high',
    })
    const messages = request?.messages as Array<{ role: string; content: Array<{ type: string; text: string }> }>
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content[0]).toEqual({ type: 'text', text: '你好' })
  })

  it('yields visible text deltas from streamChat', async () => {
    const llm = fakeLlm()
    const backend = new LlmBackend(llm)
    const deltas: string[] = []
    for await (const delta of backend.streamChat([{ role: 'user', content: 'hi' }])) {
      deltas.push(delta)
    }
    expect(deltas).toEqual(['你好', '呀！'])
  })

  it('defaults provider/model from the catalog', async () => {
    const llm = fakeLlm()
    const backend = new LlmBackend(llm)
    await backend.chat([{ role: 'user', content: 'hi' }])
    expect(llm.streamed[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('throws on an errored finish', async () => {
    const llm = {
      listProviders: () => [{ id: 'p', name: 'P' }],
      listModels: async () => [{ id: 'm', name: 'M' }],
      resolveModelInfo: async () => ({}),
      async *stream(): AsyncGenerator<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'X' } as never } }
      },
    } as unknown as LlmRuntime
    const backend = new LlmBackend(llm)
    await expect(backend.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/error/)
  })
})

describe('readSseDeltas', () => {
  it('yields deltas and surfaces stream errors', async () => {
    const { readSseDeltas } = await import('../src/client/llm.ts')
    const encode = (text: string): ReadableStream<Uint8Array> =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        },
      })

    const deltas: string[] = []
    for await (const delta of readSseDeltas(encode('data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\ndata: {"done":true}\n\n'))) {
      deltas.push(delta)
    }
    expect(deltas).toEqual(['你', '好'])

    await expect(async () => {
      for await (const _ of readSseDeltas(encode('data: {"error":"上游挂了"}\n\n'))) {
        void _
      }
    }).rejects.toThrow('上游挂了')
  })
})
