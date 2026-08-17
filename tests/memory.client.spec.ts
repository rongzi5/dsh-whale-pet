import { describe, expect, it } from 'vitest'
import {
  appendTurn,
  buildChatMessages,
  buildSystemPrompt,
  extractFacts,
  extractUserFacts,
  forgetFact,
  loadWhaleMemory,
  rememberFacts,
  saveWhaleMemory,
  stripMemoryMarkers,
} from '../src/client/memory.ts'
import type { StorageLike } from '../src/client/persistence.ts'

class FakeStorage implements StorageLike {
  private readonly map = new Map<string, string>()
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

const META = { name: '鲸鲸', days: 3 }

describe('buildSystemPrompt', () => {
  it('embeds the persona, companion days and remembered facts', () => {
    const prompt = buildSystemPrompt({ facts: ['用户叫小明', '用户喜欢蓝色'], turns: [] }, META)
    expect(prompt).toContain('鲸鲸')
    expect(prompt).toContain('3 天')
    expect(prompt).toContain('- 用户叫小明')
    expect(prompt).toContain('[记住]')
  })

  it('falls back to an empty-memory notice', () => {
    expect(buildSystemPrompt({ facts: [], turns: [] }, META)).toContain('还没有关于用户的记忆')
  })

  it('appends the live progress block only while the agent is busy', () => {
    const base = buildSystemPrompt({ facts: [], turns: [] }, META)
    expect(base).not.toContain('当前 DSH 会话状态')
    const busy = buildSystemPrompt(
      { facts: [], turns: [] },
      META,
      { active: true, running: true, tools: ['bash'], turnMs: 120_000, nodeCount: 5 },
    )
    expect(busy).toContain('当前 DSH 会话状态')
    expect(busy).toContain('bash')
    expect(busy).toContain('2 分钟')
  })

  it('switches to report mode for progress questions', () => {
    const cute = buildSystemPrompt({ facts: [], turns: [] }, META)
    expect(cute).toContain('简短可爱')
    expect(cute).toContain('60 字只限制给用户看的那句闲聊')
    expect(cute).toContain('不受 60 字限制')
    const reporting = buildSystemPrompt({ facts: [], turns: [] }, META, null, true)
    expect(reporting).toContain('汇报模式')
    expect(reporting).toContain('不卖萌、不省略数字')
    expect(reporting).not.toContain('简短可爱')
  })

  it('detects progress questions automatically', () => {
    const messages = buildChatMessages({ facts: [], turns: [] }, META, '进度如何了？')
    expect(messages[0]?.content).toContain('汇报模式')
    const normal = buildChatMessages({ facts: [], turns: [] }, META, '今天天气不错')
    expect(normal[0]?.content).not.toContain('汇报模式')
  })
})

describe('extractFacts / stripMemoryMarkers', () => {
  it('extracts every [记住] line and strips them from the display text', () => {
    const reply = '好的～\n[记住] 用户喜欢蓝色\n然后我又想了想\n[记住] 用户养了一只猫'
    expect(extractFacts(reply)).toEqual(['用户喜欢蓝色', '用户养了一只猫'])
    expect(stripMemoryMarkers(reply)).toBe('好的～\n然后我又想了想')
  })

  it('returns no facts without markers', () => {
    expect(extractFacts('今天天气不错')).toEqual([])
    expect(stripMemoryMarkers('今天天气不错')).toBe('今天天气不错')
  })
})

describe('extractUserFacts', () => {
  it('pulls name, likes and dislikes from the user message', () => {
    expect(extractUserFacts('我叫小明，我喜欢蓝色')).toEqual(['用户叫小明', '用户喜欢蓝色'])
    expect(extractUserFacts('我讨厌周一')).toEqual(['用户不喜欢周一'])
  })

  it('treats an explicit remember request as a fact', () => {
    expect(extractUserFacts('记住：周末要交报告')).toEqual(['周末要交报告'])
  })

  it('ignores small talk', () => {
    expect(extractUserFacts('今天天气不错')).toEqual([])
    expect(extractUserFacts('在吗')).toEqual([])
  })
})

describe('rememberFacts / appendTurn', () => {
  it('dedupes facts and caps them at the limit', () => {
    const base = { facts: ['A'], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    const once = rememberFacts(base, ['B', 'A'])
    expect(once.facts).toEqual(['A', 'B'])
    const again = rememberFacts(once, ['B'])
    expect(again.facts).toEqual(['A', 'B'])
    const many = rememberFacts(once, Array.from({ length: 80 }, (_, i) => `F${i}`))
    expect(many.facts).toHaveLength(24)
    expect(many.facts[0]).toBe('F56')
  })

  it('appends turns chronologically and keeps the most recent window', () => {
    let memory = { facts: [] as string[], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    for (let i = 0; i < 16; i += 1) {
      memory = appendTurn(memory, i % 2 === 0 ? 'user' : 'assistant', `turn-${i}`)
    }
    expect(memory.turns).toHaveLength(8)
    expect(memory.turns[0]).toEqual({ role: 'user', text: 'turn-8' })
    expect(memory.turns.at(-1)).toEqual({ role: 'assistant', text: 'turn-15' })
  })

  it('compacts evicted turns into a bounded summary instead of dropping them', () => {
    let memory = { facts: [] as string[], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    for (let i = 0; i < 10; i += 1) {
      memory = appendTurn(memory, i % 2 === 0 ? 'user' : 'assistant', `turn-${i}`)
    }
    // The two oldest turns were compacted, the 8 newest stay whole.
    expect(memory.turns).toHaveLength(8)
    expect(memory.turns[0]).toEqual({ role: 'user', text: 'turn-2' })
    expect(memory.summary).toBe('turn-0；turn-1')

    // Further evictions append to the existing summary.
    memory = appendTurn(memory, 'user', 'turn-10')
    expect(memory.summary).toBe('turn-0；turn-1；turn-2')
    expect(memory.turns[0]).toEqual({ role: 'assistant', text: 'turn-3' })

    // The summary itself stays bounded.
    let long = { facts: [] as string[], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    for (let i = 0; i < 30; i += 1) {
      long = appendTurn(long, 'user', `这是一段很长的对话内容用于测试压缩上限 ${'x'.repeat(200)} ${i}`)
    }
    expect(long.summary?.length).toBeLessThanOrEqual(400)
    expect(long.summary?.endsWith('…')).toBe(true)
  })

  it('drops blank turns', () => {
    const memory = { facts: [], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    expect(appendTurn(memory, 'user', '   ').turns).toHaveLength(0)
  })
})

describe('buildChatMessages', () => {
  it('orders system, recent turns and the new input', () => {
    const memory = {
      facts: ['用户叫小明'],
      turns: [
        { role: 'user' as const, text: '你好' },
        { role: 'assistant' as const, text: '你好呀' },
      ],
    }
    const messages = buildChatMessages(memory, META, '记得我叫什么吗')
    expect(messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messages[0]?.content).toContain('[记住]')
    expect(messages.at(-1)?.content).toBe('记得我叫什么吗')
  })

  it('embeds the compacted summary into the system prompt', () => {
    const memory = {
      facts: [] as string[],
      turns: [] as Array<{ role: 'user' | 'assistant'; text: string }>,
      summary: '早前聊过天气和午饭',
    }
    const system = buildChatMessages(memory, META, '在吗')[0]?.content ?? ''
    expect(system).toContain('早前对话的压缩摘要')
    expect(system).toContain('早前聊过天气和午饭')
  })
})

describe('forgetFact', () => {
  it('removes exactly one matching fact and keeps other facts, turns and summary', () => {
    const memory = {
      facts: ['用户叫小明', '用户喜欢蓝色', '用户养了一只猫'],
      turns: [
        { role: 'user' as const, text: '你好' },
        { role: 'assistant' as const, text: '你好呀' },
      ],
      summary: '早前聊过天气和午饭',
    }
    const next = forgetFact(memory, '用户喜欢蓝色')
    expect(next.facts).toEqual(['用户叫小明', '用户养了一只猫'])
    expect(next.turns).toEqual(memory.turns)
    expect(next.summary).toBe('早前聊过天气和午饭')
  })

  it('matches after trimming the search text', () => {
    const memory = { facts: ['用户叫小明'], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    expect(forgetFact(memory, '  用户叫小明  ').facts).toEqual([])
  })

  it('ignores blank facts and returns the memory unchanged', () => {
    const memory = { facts: ['用户叫小明'], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    expect(forgetFact(memory, '   ')).toBe(memory)
    expect(forgetFact(memory, '')).toBe(memory)
  })

  it('returns the same memory object when the fact is not present', () => {
    const memory = { facts: ['用户叫小明'], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    expect(forgetFact(memory, '用户喜欢红色')).toBe(memory)
  })
})

describe('persistence', () => {
  it('round-trips memory through StorageLike', () => {
    const storage = new FakeStorage()
    saveWhaleMemory(storage, { facts: ['用户喜欢蓝色'], turns: [{ role: 'user', text: 'hi' }] })
    expect(loadWhaleMemory(storage)).toEqual({ facts: ['用户喜欢蓝色'], turns: [{ role: 'user', text: 'hi' }] })
  })

  it('validates corrupted payloads back to empty memory', () => {
    const storage = new FakeStorage()
    storage.setItem('dsh.whale-pet.memory.v1', '{not json')
    expect(loadWhaleMemory(storage)).toEqual({ facts: [], turns: [] })
    storage.setItem('dsh.whale-pet.memory.v1', JSON.stringify({ facts: [42, 'ok'], turns: [{ role: 'bogus', text: 'x' }] }))
    expect(loadWhaleMemory(storage)).toEqual({ facts: ['ok'], turns: [] })
  })

  it('tolerates missing storage', () => {
    expect(loadWhaleMemory(null)).toEqual({ facts: [], turns: [] })
  })
})
