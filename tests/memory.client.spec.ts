import { describe, expect, it } from 'vitest'
import {
  appendTurn,
  buildChatMessages,
  buildSystemPrompt,
  extractFacts,
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

describe('rememberFacts / appendTurn', () => {
  it('dedupes facts and caps them at the limit', () => {
    const base = { facts: ['A'], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    const once = rememberFacts(base, ['B', 'A'])
    expect(once.facts).toEqual(['A', 'B'])
    const again = rememberFacts(once, ['B'])
    expect(again.facts).toEqual(['A', 'B'])
    const many = rememberFacts(once, Array.from({ length: 80 }, (_, i) => `F${i}`))
    expect(many.facts).toHaveLength(64)
    expect(many.facts[0]).toBe('F16')
  })

  it('appends turns chronologically and keeps the most recent window', () => {
    let memory = { facts: [] as string[], turns: [] as Array<{ role: 'user' | 'assistant'; text: string }> }
    for (let i = 0; i < 16; i += 1) {
      memory = appendTurn(memory, i % 2 === 0 ? 'user' : 'assistant', `turn-${i}`)
    }
    expect(memory.turns).toHaveLength(12)
    expect(memory.turns[0]).toEqual({ role: 'user', text: 'turn-4' })
    expect(memory.turns.at(-1)).toEqual({ role: 'assistant', text: 'turn-15' })
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
