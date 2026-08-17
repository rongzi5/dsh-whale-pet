import { describe, expect, it, vi } from 'vitest'
import { WhalePetService } from '../src/client/runtime/whale-pet-service.ts'
import { WhalePetChat, CHAT_FAILURE_BUBBLE, extractTaskRequest, loadChatPreferences, saveChatPreferences, taskIntent } from '../src/client/runtime/whale-pet-chat.ts'
import { loadWhaleMemory } from '../src/client/memory.ts'
import type { StorageLike } from '../src/client/persistence.ts'
import type { WhaleChatMessage, WhaleChatTransport, WhaleModelCatalog } from '../src/client/llm.ts'
import type { WhaleSessionProgress } from '../src/client/progress.ts'

class FakeStorage implements StorageLike {
  private readonly map = new Map<string, string>()
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

const FAKE_CATALOG: WhaleModelCatalog = {
  providers: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek 官方',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', efforts: [] },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek Reasoner',
          efforts: [
            { id: 'low', name: '低' },
            { id: 'high', name: '高' },
          ],
          defaultEffort: 'low',
        },
      ],
    },
  ],
  default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
}

function fakeTransport(reply: string | ((messages: readonly WhaleChatMessage[]) => string), fail = false): WhaleChatTransport & { calls: number; lastOptions?: unknown } {
  const calls = { count: 0, lastOptions: undefined as unknown }
  return {
    calls: 0,
    lastOptions: undefined,
    async postChat(messages, options): Promise<string> {
      calls.count += 1
      this.calls = calls.count
      this.lastOptions = options
      if (fail) throw new Error('upstream down')
      return typeof reply === 'function' ? reply(messages) : reply
    },
    async listModels(): Promise<WhaleModelCatalog> {
      return FAKE_CATALOG
    },
  }
}

describe('WhalePetChat', () => {
  it('shows the reply bubble, persists memory facts and turns', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const transport = fakeTransport('你好呀！\n[记住] 用户喜欢蓝色')
    const chat = new WhalePetChat(service, storage, transport)

    await chat.ask('我喜欢蓝色')

    // The reply bubble shows the marker-free text.
    expect(service.getSnapshot().recap?.text).toBe('你好呀！')
    // The memory stores the extracted fact plus both turns.
    const memory = loadWhaleMemory(storage)
    expect(memory.facts).toEqual(['用户喜欢蓝色'])
    expect(memory.turns).toEqual([
      { role: 'user', text: '我喜欢蓝色' },
      { role: 'assistant', text: '你好呀！' },
    ])
    expect(chat.isBusy).toBe(false)
    service.dispose()
  })

  it('stores a first-person fact even when the model forgets the [记住] marker', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const transport = fakeTransport('好呀，我记住了～')
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('我叫小明，我喜欢蓝色')
    expect(loadWhaleMemory(storage).facts).toEqual(['用户叫小明', '用户喜欢蓝色'])
    service.dispose()
  })

  it('grows the reply bubble as stream deltas arrive', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const seen: string[] = []
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        throw new Error('stream path should not fall back')
      },
      async *streamChat(): AsyncIterable<string> {
        yield '你'
        seen.push(service.getSnapshot().recap?.text ?? '')
        yield '好呀！'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
    }
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('在吗')
    expect(seen[0]).toBe('你')
    expect(service.getSnapshot().recap?.text).toBe('你好呀！')
    service.dispose()
  })

  it('holds the thinking mood while the request is in flight', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        await gate
        return '好了'
      },
    }
    const chat = new WhalePetChat(service, storage, transport)

    const pending = chat.ask('在吗')
    expect(service.getSnapshot().activity.mood).toBe('thinking')
    expect(service.externalMood()).not.toBeNull()
    release?.()
    await pending
    expect(service.externalMood()).toBeNull()
    service.dispose()
  })

  it('reacts with an error bubble and sweat on upstream failure', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const chat = new WhalePetChat(service, storage, fakeTransport('', true))

    await chat.ask('在吗')
    expect(service.getSnapshot().recap?.text).toBe(CHAT_FAILURE_BUBBLE)
    expect(service.getSnapshot().activity.mood).toBe('error')
    expect(loadWhaleMemory(storage).turns).toHaveLength(0)
    service.dispose()
  })

  it('guards re-entry with a nudge bubble while a request is in flight', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        calls += 1
        await gate
        return '第一句'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
    }
    const chat = new WhalePetChat(service, storage, transport)

    const first = chat.ask('第一句')
    const second = chat.ask('第二句')
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    expect(service.getSnapshot().recap?.text).toBe('等我先把这句说完～')
    release?.()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    service.dispose()
  })

  it('ignores blank input', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const transport = fakeTransport('x')
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('')
    expect(transport.calls).toBe(0)
    service.dispose()
  })

  it('passes model/effort options through to the transport', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const transport = fakeTransport('收到')
    const chat = new WhalePetChat(service, storage, transport)

    await chat.ask('在吗', { provider: 'deepseek-official', model: 'deepseek-reasoner', effort: 'high' })
    expect(transport.lastOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner', effort: 'high' })
    service.dispose()
  })

  it('feeds the live session progress into the system prompt and click recap', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    let receivedMessages: readonly WhaleChatMessage[] | null = null
    const transport: WhaleChatTransport = {
      async postChat(messages): Promise<string> {
        receivedMessages = messages
        return '在跑 bash 呢'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
      async getProgress(sessionId): Promise<WhaleSessionProgress> {
        expect(sessionId).toBe('session-1')
        return {
          active: true,
          running: true,
          tools: ['bash'],
          turnMs: 150_000,
          nodeCount: 8,
          lastTool: 'bash',
          step: 4,
          lastActivity: '运行 bash：npm test',
          lastSummary: '完成：108 passed',
        }
      },
    }
    const progressProvider = () => ({
      sessionId: 'session-1',
      active: true,
      running: true,
      tools: ['bash'],
      turnMs: 150_000,
      nodeCount: 8,
      lastTool: 'bash',
      goalPhase: 'active',
    })
    const chat = new WhalePetChat(service, storage, transport, progressProvider)

    // Click recap reports the live progress line without any LLM call.
    expect(chat.getProgressText()).toBe('正在鼓捣终端（bash），已经 3 分钟')

    // The chat request merges the fine-grained host progress into the prompt.
    await chat.ask('进度如何了')
    const system = receivedMessages?.[0]?.content ?? ''
    expect(system).toContain('当前 DSH 会话状态')
    expect(system).toContain('正在运行：bash（第 4 步）')
    expect(system).toContain('8 个节点')
    expect(system).toContain('最新动态：运行 bash：npm test')
    expect(system).toContain('最近结果：完成：108 passed')
    expect(system).toContain('goal 阶段：active')
    service.dispose()
  })

  it('degrades to the coarse snapshot when the fine progress fetch fails', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    let receivedMessages: readonly WhaleChatMessage[] | null = null
    const transport: WhaleChatTransport = {
      async postChat(messages): Promise<string> {
        receivedMessages = messages
        return 'ok'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
      async getProgress(): Promise<WhaleSessionProgress> {
        throw new Error('host progress unavailable')
      },
    }
    const progressProvider = () => ({
      sessionId: 'session-1',
      active: true,
      running: true,
      tools: ['bash'],
      turnMs: 60_000,
      nodeCount: 3,
      goalPhase: 'active',
    })
    const chat = new WhalePetChat(service, storage, transport, progressProvider)
    await chat.ask('进度如何了')
    const system = receivedMessages?.[0]?.content ?? ''
    expect(system).toContain('正在运行：bash')
    expect(system).not.toContain('- 最新动态：')
    service.dispose()
  })

  it('upgrades the click bubble with the probed fine progress', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        return 'ok'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
      async getProgress(): Promise<WhaleSessionProgress> {
        return {
          active: true,
          running: true,
          tools: ['jobs'],
          turnMs: 210_000,
          nodeCount: 12,
          step: 2,
          jobs: [{ label: 'npm run build', startedAt: Date.now() - 300_000, outputTail: '进度 45%' }],
        }
      },
    }
    const progressProvider = () => ({
      sessionId: 'session-1',
      active: true,
      running: true,
      tools: ['jobs'],
      turnMs: 210_000,
      nodeCount: 12,
    })
    const chat = new WhalePetChat(service, storage, transport, progressProvider)

    // Coarse line first…
    expect(chat.getProgressText()).toBe('正在忙活（jobs），已经 4 分钟')
    // …then the probe upgrades the bubble to the running job.
    await chat.refreshProgressBubble()
    expect(service.getSnapshot().recap?.text).toBe('正在后台跑 npm run build（已 5 分钟）')
    service.dispose()
  })

  it('round-trips chat preferences through storage', () => {
    const storage = new FakeStorage()
    expect(loadChatPreferences(storage)).toBeNull()

    saveChatPreferences(storage, { provider: 'p', model: 'm', effort: 'high' })
    expect(loadChatPreferences(storage)).toEqual({ provider: 'p', model: 'm', effort: 'high' })

    saveChatPreferences(storage, { provider: 'p2', model: 'm2' })
    expect(loadChatPreferences(storage)).toEqual({ provider: 'p2', model: 'm2' })

    storage.setItem('dsh.whale-pet.chat-prefs.v1', '{broken')
    expect(loadChatPreferences(storage)).toBeNull()
  })
})

describe('WhalePetService external mood', () => {
  it('expires the override and publishes snapshot changes', () => {
    const service = new WhalePetService(new FakeStorage())
    const listener = vi.fn()
    service.subscribe(listener)

    service.setExternalMood('thinking', Date.now() + 10_000)
    expect(service.getSnapshot().activity.mood).toBe('thinking')
    expect(service.externalMood()).toMatchObject({ mood: 'thinking' })
    expect(listener).toHaveBeenCalled()

    service.clearExternalMood()
    expect(service.externalMood()).toBeNull()
    service.dispose()
  })

  it('showBubble renders long chat text without touching recap history', () => {
    const service = new WhalePetService(new FakeStorage())
    service.pushRecap('历史事件')
    service.showBubble('这是一条很长的回复'.repeat(40), 1_000)
    expect(service.getSnapshot().recap?.text.length).toBeLessThanOrEqual(600)

    // The click recap cycle still only sees session events + the name entry.
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('历史事件')
    service.dispose()
  })

  it('replaces the current bubble text without reminting the recap id', () => {
    const service = new WhalePetService(new FakeStorage())
    service.showBubble('你')
    const firstId = service.getSnapshot().recap?.id
    service.showBubble('你好呀！', 1_000, { replace: true })
    expect(service.getSnapshot().recap?.id).toBe(firstId)
    expect(service.getSnapshot().recap?.text).toBe('你好呀！')
    service.dispose()
  })
})

describe('WhalePetChat task dispatch', () => {
  it('extracts [TASK] markers from pet replies', () => {
    expect(extractTaskRequest('这个有点难\n[TASK] 帮我写一个排序算法\n附注')).toEqual({ prompt: '帮我写一个排序算法', note: '附注' })
    expect(extractTaskRequest('今天天气不错')).toBeNull()
    expect(extractTaskRequest('[TASK]   ')).toBeNull()
  })

  it('dispatches a subagent task when the pet emits [TASK]', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const taskCalls: Array<{ prompt: string }> = []
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        return '这需要真跑一下\n[TASK] 写一个能算斐波那契的脚本'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
      async runTask(prompt): Promise<{ output: string; sessionId: string; completed: boolean }> {
        taskCalls.push({ prompt })
        return { output: '写好了，fib.py 输出 55', sessionId: 'child-1', completed: true }
      },
    }
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('帮我写个斐波那契')
    expect(taskCalls).toHaveLength(1)
    expect(taskCalls[0]?.prompt).toContain('写一个能算斐波那契的脚本')
    expect(service.getSnapshot().recap?.text).toContain('写好了，fib.py 输出 55')
    // The dispatch result is remembered as a turn.
    expect(loadWhaleMemory(storage).turns.at(-1)?.text).toContain('fib.py')
    service.dispose()
  })

  it('falls back to the plain reply when no task transport exists', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        return '这需要真跑一下\n[TASK] 写个脚本'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
    }
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('写个脚本')
    // Without runTask the marker stays visible as the pet's bubble text.
    expect(service.getSnapshot().recap?.text).toContain('[TASK]')
    service.dispose()
  })
})

describe('WhalePetChat task intent heuristic', () => {
  it('detects execution intent even when the pet answers directly', () => {
    expect(taskIntent('写个冒泡排序')).toBe('写个冒泡排序')
    expect(taskIntent('帮我实现一个斐波那契')).toBe('帮我实现一个斐波那契')
    expect(taskIntent('今天天气怎么样')).toBeNull()
    expect(taskIntent('鲸鲸你叫什么')).toBeNull()
  })

  it('keeps the direct answer when intent matches but no [TASK] came back', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const taskCalls: Array<{ prompt: string }> = []
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        // The pet answered directly (no [TASK] marker).
        return '搞定！这是冒泡排序的代码：...'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
      async runTask(prompt): Promise<{ output: string; sessionId: string; completed: boolean }> {
        taskCalls.push({ prompt })
        return { output: '写好了，bubble_sort.py 已保存', sessionId: 'child-2', completed: true }
      },
    }
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('写个冒泡排序')
    // No [TASK] marker → no dispatch, even though the intent regex matches.
    expect(taskCalls).toHaveLength(0)
    expect(service.getSnapshot().recap?.text).toBe('搞定！这是冒泡排序的代码：...')
    // The direct answer is persisted as a normal assistant turn.
    expect(loadWhaleMemory(storage).turns.at(-1)?.text).toBe('搞定！这是冒泡排序的代码：...')
    service.dispose()
  })

  it('does not call runTask when the pet answers with code but no [TASK]', async () => {
    const service = new WhalePetService(new FakeStorage())
    const storage = new FakeStorage()
    const taskCalls: Array<{ prompt: string }> = []
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        // Casual-chat style answer: the pet just hands over code.
        return '搞定！\ndef bubble_sort(a):\n    return sorted(a)'
      },
      async listModels(): Promise<WhaleModelCatalog> {
        return FAKE_CATALOG
      },
      async runTask(prompt): Promise<{ output: string; sessionId: string; completed: boolean }> {
        taskCalls.push({ prompt })
        return { output: '写好了', sessionId: 'child-3', completed: true }
      },
    }
    const chat = new WhalePetChat(service, storage, transport)
    await chat.ask('写个冒泡排序')
    expect(taskCalls).toHaveLength(0)
    expect(service.getSnapshot().recap?.text).toContain('def bubble_sort')
    expect(loadWhaleMemory(storage).turns).toEqual([
      { role: 'user', text: '写个冒泡排序' },
      { role: 'assistant', text: '搞定！\ndef bubble_sort(a):\n    return sorted(a)' },
    ])
    service.dispose()
  })
})
