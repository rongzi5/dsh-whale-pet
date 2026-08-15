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
  loadWhaleMemory,
  rememberFacts,
  saveWhaleMemory,
  stripMemoryMarkers,
} from '../memory.ts'
import { localChatTransport, type WhaleChatOptions, type WhaleChatTransport, type WhaleModelCatalog } from '../llm.ts'
import { progressToText, type WhaleSessionProgress } from '../progress.ts'
import { daysSince, loadWhalePetState, type StorageLike } from '../persistence.ts'

const THINKING_MS = 30_000
const REPLY_BUBBLE_MS = 12_000
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
      const reply = await this.transport.postChat(buildChatMessages(memory, meta, text, progress), options)
      const cleanReply = stripMemoryMarkers(reply)
      const next = rememberFacts(memory, extractFacts(reply))
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

  private meta(): { name: string; days: number } {
    const state = loadWhalePetState(this.storage)
    return { name: state.name, days: daysSince(state.since) }
  }
}
