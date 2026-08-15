/**
 * Whale pet long-term memory: facts about the user plus a bounded recent
 * conversation, persisted through the same guarded StorageLike channel as the
 * rest of the pet state.
 *
 * Memory protocol: the system prompt asks the model to end a reply with
 * `[记住] <fact>` lines when the user reveals something worth keeping. The
 * chat coordinator strips those markers before showing the bubble and stores
 * the extracted facts here.
 */

import type { StorageLike } from './persistence.ts'
import type { WhaleChatMessage } from './llm.ts'
import { buildProgressContext, type WhaleSessionProgress } from './progress.ts'

export interface WhaleMemory {
  /** Long-term facts about the user, newest last. */
  facts: string[]
  /** Recent turns in chronological order (user/assistant interleaved). */
  turns: Array<{ role: 'user' | 'assistant'; text: string }>
}

export const WHALE_MEMORY_KEY = 'dsh.whale-pet.memory.v1'
export const FACTS_LIMIT = 64
export const TURNS_LIMIT = 12
export const FACT_MAX_LENGTH = 120
export const TURN_MAX_LENGTH = 600

export const WHALE_MEMORY_DEFAULTS: Readonly<WhaleMemory> = Object.freeze({
  facts: [],
  turns: [],
})

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.slice(0, maxLength)
}

/** Read and validate the persisted memory; any failure falls back to defaults. */
export function loadWhaleMemory(storage: StorageLike | null): WhaleMemory {
  if (storage === null) return { facts: [], turns: [] }
  let raw: string | null
  try {
    raw = storage.getItem(WHALE_MEMORY_KEY)
  } catch {
    return { facts: [], turns: [] }
  }
  if (raw === null) return { facts: [], turns: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { facts: [], turns: [] }
  }
  if (typeof parsed !== 'object' || parsed === null) return { facts: [], turns: [] }
  const record = parsed as Record<string, unknown>
  const facts: string[] = []
  if (Array.isArray(record.facts)) {
    for (const fact of record.facts) {
      const text = cleanText(fact, FACT_MAX_LENGTH)
      if (text !== null && !facts.includes(text)) facts.push(text)
      if (facts.length >= FACTS_LIMIT) break
    }
  }
  const turns: WhaleMemory['turns'] = []
  if (Array.isArray(record.turns)) {
    for (const turn of record.turns) {
      if (typeof turn !== 'object' || turn === null) continue
      const role = (turn as { role?: unknown }).role
      if (role !== 'user' && role !== 'assistant') continue
      const text = cleanText((turn as { text?: unknown }).text, TURN_MAX_LENGTH)
      if (text === null) continue
      turns.push({ role, text })
      if (turns.length >= TURNS_LIMIT) break
    }
  }
  return { facts, turns }
}

/** Persist the memory; storage failures degrade silently (keep running). */
export function saveWhaleMemory(storage: StorageLike | null, memory: WhaleMemory): void {
  if (storage === null) return
  try {
    storage.setItem(WHALE_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // Storage unavailable (private mode / quota): keep running in-memory.
  }
}

/** Add new facts (deduped, capped at {@link FACTS_LIMIT}, oldest dropped). */
export function rememberFacts(memory: WhaleMemory, facts: readonly string[]): WhaleMemory {
  const merged = [...memory.facts]
  for (const fact of facts) {
    const text = cleanText(fact, FACT_MAX_LENGTH)
    if (text === null || merged.includes(text)) continue
    merged.push(text)
  }
  return { facts: merged.slice(-FACTS_LIMIT), turns: memory.turns }
}

/** Append one conversation turn (capped at {@link TURNS_LIMIT}, oldest dropped). */
export function appendTurn(memory: WhaleMemory, role: 'user' | 'assistant', text: string): WhaleMemory {
  const clean = cleanText(text, TURN_MAX_LENGTH)
  if (clean === null) return memory
  return { facts: memory.facts, turns: [...memory.turns, { role, text: clean }].slice(-TURNS_LIMIT) }
}

/**
 * The pet persona + memory block handed to the model as the system prompt.
 * Instructs the model to report memorable facts with the `[记住]` protocol.
 * When the agent is busy, a live progress block is appended so the pet can
 * truthfully answer "进度如何了" (the block is read-only session state; the
 * DSH conversation itself is never touched).
 */
export function buildSystemPrompt(
  memory: WhaleMemory,
  meta: { name: string; days: number },
  progress: WhaleSessionProgress | null = null,
): string {
  const base = [
    `你是运行在 DeepSeek Harness 界面角落的 3D 虎鲸桌宠「${meta.name}」，已经陪伴用户 ${meta.days} 天。`,
    '你性格温柔俏皮，回复简短可爱，不超过 60 字，不使用 markdown。',
    `关于用户的记忆：\n${memory.facts.length > 0 ? memory.facts.map(fact => `- ${fact}`).join('\n') : '（还没有关于用户的记忆）'}`,
    '如果用户告诉了你值得长期记住的事实（名字、喜好、习惯、安排等），在你的回复末尾单独一行输出「[记住] 事实内容」。',
  ]
  const progressBlock = buildProgressContext(progress)
  return progressBlock === null ? base.join('\n') : [...base, progressBlock].join('\n\n')
}

/** Extract `[记住] <fact>` lines from a model reply. */
export function extractFacts(reply: string): string[] {
  const facts: string[] = []
  const pattern = /\[记住\]\s*([^\n]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(reply)) !== null) {
    const fact = match[1]?.trim()
    if (fact !== undefined && fact !== '') facts.push(fact)
  }
  return facts
}

/** Strip `[记住] ...` marker lines so they never show in the bubble. */
export function stripMemoryMarkers(reply: string): string {
  return reply.replace(/\s*\[记住\]\s*[^\n]*/g, '').trim()
}

/** Assemble the full request: system persona + recent turns + the new input. */
export function buildChatMessages(
  memory: WhaleMemory,
  meta: { name: string; days: number },
  input: string,
  progress: WhaleSessionProgress | null = null,
): WhaleChatMessage[] {
  const messages: WhaleChatMessage[] = [{ role: 'system', content: buildSystemPrompt(memory, meta, progress) }]
  for (const turn of memory.turns) {
    messages.push({ role: turn.role, content: turn.text })
  }
  messages.push({ role: 'user', content: input })
  return messages
}
