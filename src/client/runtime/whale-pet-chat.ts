/**
 * Whale pet chat coordinator: ties the browser LLM transport to the runtime
 * service and the memory store.
 *
 * One `ask()` runs a full interaction: wake the pet, hold the `thinking`
 * mood through the request (via the service's external-mood override, which
 * the session observer respects), show the reply as a long-lived bubble,
 * extract `[记住]` facts into memory and persist the new turns.
 *
 * The selected model and reasoning effort are persisted per user and sent
 * with every request; the chat bubble UI reads/writes them through
 * {@link getPreferences} / {@link setPreferences}.
 */

import { WhalePetService } from './whale-pet-service.ts'
import {
  appendTurn,
  buildChatMessages,
  extractFacts,
  extractUserFacts,
  loadWhaleMemory,
  rememberFacts,
  saveWhaleMemory,
  stripMemoryMarkers,
  type WhaleMemory,
} from '../memory.ts'
import { localChatTransport, type WhaleChatOptions, type WhaleChatTransport, type WhaleModelCatalog } from '../llm.ts'
import { progressToText, type WhaleSessionProgress } from '../progress.ts'
import { daysSince, loadWhalePetState, type StorageLike } from '../persistence.ts'

const THINKING_MS = 30_000
const REPLY_BUBBLE_MS = 15_000
const BUSY_BUBBLE_MS = 2_500
const ERROR_BUBBLE_MS = 4_000
const PREFS_KEY = 'dsh.whale-pet.chat-prefs.v1'

/** Persisted chat preferences (model + reasoning effort). */
export interface WhaleChatPreferences {
  provider: string
  model: string
  effort?: string
}

/** How the pet addresses the failure bubble; shown verbatim. */
export const CHAT_FAILURE_BUBBLE = '呜…… 我连不上大脑了'

/** Read the persisted model/effort preferences, with validation. */
export function loadChatPreferences(storage: StorageLike | null): WhaleChatPreferences | null {
  if (storage === null) return null
  let raw: string | null
  try {
    raw = storage.getItem(PREFS_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return null
  if (record.provider === '' || record.model === '') return null
  return {
    provider: record.provider,
    model: record.model,
    ...(typeof record.effort === 'string' && record.effort !== '' ? { effort: record.effort } : {}),
  }
}

/** Persist the model/effort preferences. */
export function saveChatPreferences(storage: StorageLike | null, preferences: WhaleChatPreferences): void {
  if (storage === null) return
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(preferences))
  } catch {
    // Storage unavailable (private mode / quota): keep running in-memory.
  }
}

export class WhalePetChat {
  private busy = false

  public constructor(
    private readonly service: WhalePetService,
    private readonly storage: StorageLike | null = null,
    private readonly transport: WhaleChatTransport = localChatTransport,
    private readonly progressProvider: (() => WhaleSessionProgress | null) | null = null,
  ) {}

  /** Whether a chat request is currently in flight (guards re-entry). */
  public get isBusy(): boolean {
    return this.busy
  }

  /**
   * One-line live progress bubble ("正在跑 bash，已经 3 分钟"), or null when
   * the agent is idle. Used by the click recap so a long-running task can be
   * checked without typing.
   */
  public getProgressText(): string | null {
    if (this.progressProvider === null) return null
    return progressToText(this.progressProvider())
  }

  /**
   * Probe the fine-grained progress (host event log + jobs registry) and
   * refresh the bubble with the more concrete result. Fired after a click so
   * the bubble upgrades from the coarse line to the probed one (e.g. a
   * running background job) when available.
   */
  public async refreshProgressBubble(): Promise<void> {
    const progress = await this.probeProgress()
    const text = progressToText(progress)
    if (text !== null) this.service.showBubble(text, 6_000)
  }

  /**
   * Coarse projection snapshot upgraded with the fine-grained host probe
   * (event log + jobs registry); degrades to the coarse snapshot on failure.
   */
  private async probeProgress(): Promise<WhaleSessionProgress | null> {
    const coarse = this.progressProvider !== null ? this.progressProvider() : null
    if (coarse === null) return null
    if (coarse.sessionId !== undefined && this.transport.getProgress !== undefined) {
      try {
        const fine = await this.transport.getProgress(coarse.sessionId)
        const merged = { ...coarse, ...fine }
        console.debug('[ui-whale-pet] probed fine progress', {
          step: merged.step,
          tools: merged.tools,
          lastActivity: merged.lastActivity,
          lastSummary: merged.lastSummary,
          jobs: merged.jobs,
        })
        return merged
      } catch (error) {
        console.debug('[ui-whale-pet] fine progress probe failed, using coarse snapshot', error instanceof Error ? error.message : String(error))
        return coarse
      }
    }
    return coarse
  }

  /** The persisted model/effort preferences, or null. */
  public getPreferences(): WhaleChatPreferences | null {
    return loadChatPreferences(this.storage)
  }

  /** Persist model/effort preferences for future chats. */
  public setPreferences(preferences: WhaleChatPreferences): void {
    saveChatPreferences(this.storage, preferences)
  }

  /** The selectable model catalog from the host proxy. */
  public listModels(): Promise<WhaleModelCatalog> {
    return this.transport.listModels()
  }

  /** Run one chat turn; safe to call while busy (bubbles a gentle nudge). */
  public async ask(input: string, options?: WhaleChatOptions): Promise<void> {
    const text = input.trim()
    if (text === '') return
    if (this.busy) {
      this.service.showBubble('等我先把这句说完～', BUSY_BUBBLE_MS)
      return
    }
    this.busy = true
    this.service.wake()
    this.service.setExternalMood('thinking', Date.now() + THINKING_MS)
    this.service.playEffect('bubble')
    try {
      const memory = loadWhaleMemory(this.storage)
      const meta = this.meta()
      // Probe the fine-grained progress (host event log + jobs registry);
      // the coarse projection snapshot is the fallback.
      const progress = await this.probeProgress()
      const messages = buildChatMessages(memory, meta, text, progress)
      const reply = await this.collectReply(messages, options)
      // The pet may decide the request needs real execution: it replies with
      // a [TASK] marker, which dispatches a subagent conversation instead of
      // answering directly. Only the marker triggers dispatch — a client-side
      // keyword fallback is deliberately NOT applied here, so casual chat that
      // merely contains execution verbs ("写个…") stays a direct answer.
      const task = extractTaskRequest(reply)
      if (this.transport.runTask !== undefined && task !== null) {
        await this.dispatchTask(memory, text, task, progress?.sessionId, options)
        return
      }
      const cleanReply = stripMemoryMarkers(reply)
      const next = rememberFacts(memory, [...extractFacts(reply), ...extractUserFacts(text)])
      const persisted = appendTurn(appendTurn(next, 'user', text), 'assistant', cleanReply)
      saveWhaleMemory(this.storage, persisted)
      this.service.showBubble(cleanReply, REPLY_BUBBLE_MS)
    } catch {
      this.service.setExternalMood('error', Date.now() + 3_000)
      this.service.playErrorReaction(Date.now() + 3_000)
      this.service.showBubble(CHAT_FAILURE_BUBBLE, ERROR_BUBBLE_MS)
    } finally {
      this.busy = false
      this.service.clearExternalMood()
    }
  }

  /**
   * Prefer the token stream when the transport exposes one so the bubble can
   * grow as deltas arrive. Falls back to the one-shot POST for older fakes.
   */
  private async collectReply(messages: ReturnType<typeof buildChatMessages>, options?: WhaleChatOptions): Promise<string> {
    if (this.transport.streamChat === undefined) {
      return this.transport.postChat(messages, options)
    }
    let acc = ''
    for await (const delta of this.transport.streamChat(messages, options)) {
      acc += delta
      const visible = stripMemoryMarkers(acc)
      if (visible !== '') this.service.showBubble(visible, REPLY_BUBBLE_MS, { replace: true })
    }
    if (acc.trim() === '') throw new Error('空回复')
    return acc
  }

  /** Dispatch a [TASK] to a subagent conversation and report the outcome. */
  private async dispatchTask(
    memory: WhaleMemory,
    userText: string,
    task: { prompt: string; note?: string },
    sessionId: string | undefined,
    options?: WhaleChatOptions,
  ): Promise<void> {
    if (this.transport.runTask === undefined) return
    this.service.showBubble('这个有点难，我派个小助手去干活，稍等～', 8_000)
    this.service.playEffect('bubble')
    try {
      const result = await this.transport.runTask(task.prompt, '鲸鲸的任务', sessionId)
      const summary = result.completed
        ? `搞定！${result.output.slice(0, 600)}`
        : `任务还在跑（会话 ${result.sessionId}），我拿到的是：${result.output.slice(0, 300)}`
      const next = rememberFacts(memory, [])
      const persisted = appendTurn(appendTurn(next, 'user', userText), 'assistant', summary)
      saveWhaleMemory(this.storage, persisted)
      this.service.showBubble(summary, 30_000)
    } catch (error) {
      this.service.setExternalMood('error', Date.now() + 3_000)
      this.service.playErrorReaction(Date.now() + 3_000)
      this.service.showBubble('派任务失败了……' + (error instanceof Error ? error.message.slice(0, 100) : ''), 6_000)
    }
  }

  private meta(): { name: string; days: number } {
    const state = loadWhalePetState(this.storage)
    return { name: state.name, days: daysSince(state.since) }
  }
}

/** A task request the pet emitted instead of a direct answer. */
export interface WhaleTaskRequest {
  prompt: string
  note?: string
}

/**
 * Client-side execution-intent detection: strong execution verbs in the user's
 * request ("写个…/实现…/修复…/跑一下…"). Kept as a pure helper — `ask()` no
 * longer dispatches on it (only the `[TASK]` marker does), but tests and a
 * future opt-in setting may still use it. Returns the user text as the task
 * prompt, or null.
 */
const TASK_INTENT_PATTERN = /(写个|写一个|写一段|帮我写|帮我做|帮我实现|实现|编写|创建|开发|修复|重构|部署|跑一下|运行|执行|查一下|查资料|研究|调研|测试一下|调试|debug|fix|implement|create|write)/i

export function taskIntent(input: string): string | null {
  if (TASK_INTENT_PATTERN.test(input)) return input.trim()
  return null
}

/** Extract `[TASK] <description>` from a pet reply (first line wins). */
export function extractTaskRequest(reply: string): WhaleTaskRequest | null {
  const match = /^\s*\[TASK\]\s*([^\n]+)/m.exec(reply)
  if (match === null) return null
  const prompt = match[1]?.trim()
  if (prompt === undefined || prompt === '') return null
  const note = reply.slice((match.index ?? 0) + match[0].length).trim()
  return { prompt, ...(note !== '' ? { note } : {}) }
}
