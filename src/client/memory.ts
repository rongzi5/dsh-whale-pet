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
  /**
   * Compacted digest of turns evicted by the turn cap: instead of dropping
   * old turns outright, their text is folded into this bounded summary so
   * long conversations keep a coarse memory of what was discussed.
   */
  summary?: string
}

/**
 * Bounded pet context: keep the pet's own LLM request compact so it never
 * grows unwieldy in long conversations. Worst case ≈ 24 facts × 80 chars +
 * 8 turns × 240 chars + 400-char summary + persona ≈ 4.4 KB (~1.3k tokens).
 */
export const WHALE_MEMORY_KEY = 'dsh.whale-pet.memory.v1'
export const FACTS_LIMIT = 24
export const TURNS_LIMIT = 8
export const FACT_MAX_LENGTH = 80
export const TURN_MAX_LENGTH = 240
export const SUMMARY_MAX_LENGTH = 400

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
  const summary = typeof record.summary === 'string' && record.summary.trim() !== ''
    ? record.summary.trim().slice(0, SUMMARY_MAX_LENGTH)
    : undefined
  return { facts, turns, ...(summary !== undefined ? { summary } : {}) }
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
  return { facts: merged.slice(-FACTS_LIMIT), turns: memory.turns, ...(memory.summary !== undefined ? { summary: memory.summary } : {}) }
}

/**
 * Fold a batch of evicted turns into the compacted summary, bounded to
 * {@link SUMMARY_MAX_LENGTH} (prefix-kept; the summary is coarse context).
 */
function compactSummary(previous: string | undefined, evicted: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>): string {
  const parts = [
    ...(previous !== undefined ? [previous] : []),
    ...evicted.map(turn => turn.text),
  ]
  let merged = parts.join('；')
  if (merged.length > SUMMARY_MAX_LENGTH) merged = `${merged.slice(0, SUMMARY_MAX_LENGTH - 1)}…`
  return merged
}

/**
 * Append one conversation turn. When the turn cap is exceeded the evicted
 * oldest turns are compacted into {@link WhaleMemory.summary} instead of
 * being dropped outright, so long conversations keep a coarse digest.
 */
export function appendTurn(memory: WhaleMemory, role: 'user' | 'assistant', text: string): WhaleMemory {
  const clean = cleanText(text, TURN_MAX_LENGTH)
  if (clean === null) return memory
  const turns = [...memory.turns, { role, text: clean }]
  if (turns.length <= TURNS_LIMIT) {
    return { facts: memory.facts, turns, ...(memory.summary !== undefined ? { summary: memory.summary } : {}) }
  }
  const evicted = turns.slice(0, turns.length - TURNS_LIMIT)
  return {
    facts: memory.facts,
    summary: compactSummary(memory.summary, evicted),
    turns: turns.slice(-TURNS_LIMIT),
  }
}

/** Questions that ask about task progress → switch the pet to report mode. */
export const PROGRESS_QUERY_PATTERN = /进度|进展|如何了|怎么样了|跑到哪|进行到|在干嘛|忙什么|status|progress/i

/**
 * The pet persona + memory block handed to the model as the system prompt.
 * Instructs the model to report memorable facts with the `[记住]` protocol.
 * When the agent is busy, a live progress block is appended so the pet can
 * truthfully answer "进度如何了" (the block is read-only session state; the
 * DSH conversation itself is never touched).
 *
 * `progressQuery` switches the persona to report mode: the default persona
 * (cute, ≤60 chars) tends to compress probed data into vague cuteness, so a
 * progress question gets a persona that quotes the concrete numbers instead.
 */
export function buildSystemPrompt(
  memory: WhaleMemory,
  meta: { name: string; days: number },
  progress: WhaleSessionProgress | null = null,
  progressQuery = false,
): string {
  const persona = progressQuery
    ? [
        `你是运行在 DeepSeek Harness 界面角落的 3D 虎鲸桌宠「${meta.name}」。用户正在询问任务进度，请切换到汇报模式：`,
        '直接引用下方「当前 DSH 会话状态」里的数据逐条回答（第几步、正在运行或刚完成的命令、最新动态、最近结果、后台任务输出），简洁如实，不卖萌、不省略数字、不虚构；可以超过 60 字，但不要超过 150 字。',
      ]
    : [
        `你是运行在 DeepSeek Harness 界面角落的 3D 虎鲸桌宠「${meta.name}」，已经陪伴用户 ${meta.days} 天。`,
        '你性格温柔俏皮，回复简短可爱，不超过 60 字，不使用 markdown。',
      ]
  const base = [
    ...persona,
    `关于用户的记忆：\n${memory.facts.length > 0 ? memory.facts.map(fact => `- ${fact}`).join('\n') : '（还没有关于用户的记忆）'}`,
    '如果用户告诉了你值得长期记住的事实（名字、喜好、习惯、安排等），在你的回复末尾单独一行输出「[记住] 事实内容」。',
    '如果用户请求的是需要实际执行的任务（写代码、跑命令、查资料、做研究、修 bug 等），不要尝试直接回答，而是在回复开头单独一行输出「[TASK] <任务描述>」，描述要完整清晰（可以附带你已知的上下文）；闲聊或简单问答则正常回答。',
  ]
  const blocks = [...base]
  if (memory.summary !== undefined) {
    blocks.push(`早前对话的压缩摘要（不必复述细节）：\n${memory.summary}`)
  }
  const progressBlock = buildProgressContext(progress)
  return progressBlock === null ? blocks.join('\n\n') : [...blocks, progressBlock].join('\n\n')
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
  progressQuery = PROGRESS_QUERY_PATTERN.test(input),
): WhaleChatMessage[] {
  const messages: WhaleChatMessage[] = [{ role: 'system', content: buildSystemPrompt(memory, meta, progress, progressQuery) }]
  for (const turn of memory.turns) {
    messages.push({ role: turn.role, content: turn.text })
  }
  messages.push({ role: 'user', content: input })
  return messages
}
