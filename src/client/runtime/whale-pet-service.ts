/**
 * Whale pet runtime service: the single owner of motion, scene mount,
 * transient effect counters, recap history and persisted user state. The
 * React overlay only renders {@link WhalePetViewSnapshot}; session state and
 * other future plugins drive the same service through {@link setActivity},
 * {@link playEffect} and {@link pushRecap}.
 */

import { IDLE_ACTIVITY, sameActivity, type WhaleActivity, type WhaleBridgeState, type WhaleEffect, type WhaleEffectKind, type WhaleMood, type WhalePetViewSnapshot, type WhaleRecap } from '../activity.ts'
import type { WhaleDragResult } from '../motion.ts'
import { WhalePetController, type WhalePetControllerHooks, type WhalePetTargets } from './whale-pet-controller.ts'
import type { SessionWhaleObserver } from './session-observer.ts'
import { daysSince, loadWhalePetState, localDayKey, saveWhalePetState, type StorageLike, type WhalePetPersistedState } from '../persistence.ts'

/** Clickable pet regions routed by the view to zone-specific reactions. */
export type WhaleHitZone = 'body' | 'tail' | 'dorsal' | 'fin'

const EFFECT_TTL_MS: Record<WhaleEffectKind, number> = {
  heart: 950,
  bubble: 1700,
  sweat: 2600,
}

const CELEBRATION_HEART_INTERVAL_MS = 650
const CELEBRATION_EFFECTS_MS = 7_000

export const DIZZY_DURATION_MS = 4_000
export const DIZZY_LONG_DRAG_MS = 4_500
export const DIZZY_MIN_REAL_DRAG_PX = 24
export const DIZZY_FAST_DRAG_DISTANCE_PX = 420
export const DIZZY_FAST_DRAG_SPEED_PX_PER_SECOND = 550

/** Whether one completed drag is forceful or prolonged enough to cause dizziness. */
export function shouldEnterDizzy(drag: WhaleDragResult): boolean {
  if (drag.cancelled) return false
  if (!Number.isFinite(drag.durationMs) || !Number.isFinite(drag.distance) || !Number.isFinite(drag.averageSpeed)) return false
  const prolonged = drag.durationMs >= DIZZY_LONG_DRAG_MS && drag.distance >= DIZZY_MIN_REAL_DRAG_PX
  const forceful = drag.distance >= DIZZY_FAST_DRAG_DISTANCE_PX && drag.averageSpeed >= DIZZY_FAST_DRAG_SPEED_PX_PER_SECOND
  return prolonged || forceful
}

/** Fresh sweat drops keep dripping through the whole error window. */
const ERROR_SWEAT_INTERVAL_MS = 1_400

/** How long one recap bubble stays visible after a click. */
const RECAP_TTL_MS = 3_200
/** Cap for one bubble's text: long enough for task summaries, short enough
 * to stay readable as an overlay. */
const BUBBLE_TEXT_LIMIT = 600
/** How many session events the click recap keeps around. */
const RECAP_HISTORY_LIMIT = 8

export class WhalePetService {
  private readonly controller = new WhalePetController()
  private readonly listeners = new Set<() => void>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly persisted: WhalePetPersistedState
  private activity: WhaleActivity = IDLE_ACTIVITY
  private baseActivity: WhaleActivity = IDLE_ACTIVITY
  private effects: readonly WhaleEffect[] = []
  private bridge: WhaleBridgeState = 'off'
  private recapHistory: readonly WhaleRecap[] = []
  private recapIndex = 0
  private recapCurrent: WhaleRecap | null = null
  private recapTimer: ReturnType<typeof setTimeout> | null = null
  private nextEffectId = 1
  private nextRecapId = 1
  private observer: SessionWhaleObserver | null = null
  private external: { mood: WhaleMood; until: number } | null = null
  private dizzyTimer: ReturnType<typeof setTimeout> | null = null
  private snapshot!: WhalePetViewSnapshot
  private disposed = false

  public constructor(private readonly storage: StorageLike | null = null) {
    const loaded = loadWhalePetState(storage)
    if (loaded.since === '') {
      loaded.since = new Date().toISOString()
      saveWhalePetState(storage, { since: loaded.since })
    }
    this.persisted = loaded
    this.snapshot = this.buildSnapshot()
    this.controller.setHidden(loaded.hidden)
    this.controller.motionController.setSnapToCorner(loaded.snapToCorner)
  }

  /** Mount the view's DOM handles; restores the persisted position. Delegates to the controller unchanged. */
  public mount(targets: WhalePetTargets, hooks: WhalePetControllerHooks): boolean {
    if (this.disposed) return false
    const started = this.controller.start(targets, {
      ...hooks,
      onRelease: (x, y, drag) => {
        hooks.onRelease?.(x, y, drag)
        if (shouldEnterDizzy(drag)) this.enterDizzy()
      },
    })
    if (started && this.persisted.x !== null && this.persisted.y !== null) {
      this.controller.motionController.restorePosition(this.persisted.x, this.persisted.y)
    }
    return started
  }

  /** Unmount the current view surface without dropping the service or motion state. */
  public unmount(): void {
    this.controller.dispose()
  }

  /** Attach the session bridge for user-activity wake notifications. */
  public bindObserver(observer: SessionWhaleObserver): void {
    this.observer = observer
  }

  /** Wake a sleeping pet on hover/drag and refresh the session idle clock. */
  public wake(): void {
    if (this.isDizzy()) return
    this.observer?.noteUserActivity()
    // setActivity already forwards the mood to the motion controller.
    this.setActivity(IDLE_ACTIVITY)
  }

  /** Whether dizziness currently owns the pose and blocks pointer interaction. */
  public isDizzy(): boolean {
    return this.activity.mood === 'dizzy'
  }

  /** The user is composing a reply (view-driven DOM focus); wakes the pet. */
  public setUserTyping(typing: boolean): void {
    if (typing) this.wake()
    this.observer?.setUserTyping(typing)
  }

  /** View-delegated interaction passthroughs. */
  public setHover(hovering: boolean): void {
    if (this.isDizzy()) return
    this.controller.setHover(hovering)
  }

  public beginDrag(pointerX: number, pointerY: number, startedAt?: number): void {
    if (this.isDizzy()) return
    this.controller.beginDrag(pointerX, pointerY, startedAt)
  }

  public wasClick(maximumDrag = 7): boolean {
    return this.controller.wasClick(maximumDrag)
  }

  /**
   * Handle a click that stayed under the drag threshold. The view routes
   * each hit zone here; the body zone falls through so the view keeps its
   * original click behavior (progress bubble / recap cycle).
   * @returns true when the zone click was handled; false for a real drag or
   * the body zone (let the view run its own click handling).
   */
  public handleZoneClick(zone: WhaleHitZone): boolean {
    if (this.disposed) return false
    if (this.isDizzy()) return true
    if (!this.wasClick()) return false
    switch (zone) {
      case 'tail':
        // 爱心 + 立刻巡游（下一档），不进入 celebration 绕圈。
        this.playEffect('heart')
        this.controller.patrolNow()
        return true
      case 'dorsal':
        // 背鳍：立刻巡游。
        this.controller.patrolNow()
        return true
      case 'fin':
        this.playEffect('bubble')
        return true
      case 'body':
        // 进度逻辑属于 view/chat，这里不处理，让 view 走原 click。
        return false
    }
  }

  /** Replace the session mood unless an unexpired interaction mood owns the pose. */
  public setActivity(activity: WhaleActivity): void {
    this.baseActivity = activity
    if (this.external !== null) {
      if (Date.now() < this.external.until) return
      this.external = null
    }
    this.applyActivity(activity)
  }

  /** Update the session-bridge lifecycle state (observer-owned). */
  public setBridgeState(bridge: WhaleBridgeState): void {
    if (this.bridge === bridge) return
    this.bridge = bridge
    this.publish()
  }

  /** Rename the pet; persists and publishes the new name. */
  public setName(name: string): void {
    const trimmed = name.trim().slice(0, 32)
    if (trimmed === '' || trimmed === this.persisted.name) return
    this.persisted.name = trimmed
    saveWhalePetState(this.storage, { name: trimmed })
    this.publish()
  }

  /** Hide or show the pet; persists the choice and pauses rendering while hidden. */
  public setHidden(hidden: boolean): void {
    if (this.persisted.hidden === hidden) return
    this.persisted.hidden = hidden
    saveWhalePetState(this.storage, { hidden })
    this.controller.setHidden(hidden)
    this.publish()
  }

  /** Toggle visibility; returns the new hidden state. */
  public toggleHidden(): boolean {
    this.setHidden(!this.persisted.hidden)
    return this.persisted.hidden
  }

  /** Toggle corner snapping for released drags; persists the choice. */
  public setSnapToCorner(enabled: boolean): void {
    if (this.persisted.snapToCorner === enabled) return
    this.persisted.snapToCorner = enabled
    saveWhalePetState(this.storage, { snapToCorner: enabled })
    this.controller.motionController.setSnapToCorner(enabled)
    this.publish()
  }

  /** Glide to the nearest corner immediately (context-menu action). */
  public snapToCornerNow(): void {
    this.controller.motionController.snapToCornerNow()
  }

  /**
   * One unsolicited greeting per local calendar day. Returns true when the
   * bubble was shown so callers can skip a second nudge on the same day.
   */
  public greetOnceToday(now: number = Date.now()): boolean {
    if (this.disposed || this.persisted.hidden) return false
    const today = localDayKey(now)
    if (this.persisted.lastGreetDay === today) return false
    this.persisted.lastGreetDay = today
    saveWhalePetState(this.storage, { lastGreetDay: today })
    const days = daysSince(this.persisted.since, now)
    const text = days <= 0 ? '今天也在～' : `又见面啦，第 ${days + 1} 天`
    this.showBubble(text, 4_500)
    return true
  }

  /** Persist the pet position after a drag release. */
  public persistPosition(x: number, y: number): void {
    this.persisted.x = Math.round(x)
    this.persisted.y = Math.round(y)
    saveWhalePetState(this.storage, { x: this.persisted.x, y: this.persisted.y })
  }

  /** Record one session/interaction event for the click recap (dedupes repeats). */
  public pushRecap(text: string): number | null {
    if (this.disposed || text === '') return null
    const last = this.recapHistory[this.recapHistory.length - 1]
    if (last !== undefined && last.text === text) return last.id
    const id = this.nextRecapId
    this.recapHistory = [...this.recapHistory, { id, text }].slice(-RECAP_HISTORY_LIMIT)
    this.nextRecapId += 1
    return id
  }

  /** Remove stale recap entries that were superseded by a later successful turn. */
  public discardRecaps(ids: ReadonlySet<number>): void {
    if (this.disposed || ids.size === 0) return
    const history = this.recapHistory.filter(entry => !ids.has(entry.id))
    const current = this.recapCurrent
    if (history.length === this.recapHistory.length && (current === null || !ids.has(current.id))) return
    this.recapHistory = history
    if (current !== null && ids.has(current.id)) this.recapCurrent = null
    this.publish()
  }

  /**
   * Show a long-lived speech bubble (chat replies and API output) without
   * entering the session-event recap history. Truncated to a bubble-safe
   * length; the bubble auto-clears after `ttlMs`.
   */
  public showBubble(text: string, ttlMs = RECAP_TTL_MS, options?: { replace?: boolean }): void {
    if (this.disposed || text === '') return
    const clipped = text.slice(0, BUBBLE_TEXT_LIMIT)
    if (options?.replace === true && this.recapCurrent !== null) {
      this.recapCurrent = { id: this.recapCurrent.id, text: clipped }
    } else {
      this.recapCurrent = { id: this.nextRecapId, text: clipped }
      this.nextRecapId += 1
    }
    this.publish()
    this.scheduleRecapClear(ttlMs)
  }

  /**
   * Override the pet's mood from outside the session observer (e.g. chat
   * thinking). The observer checks {@link externalMood} every tick and lets it
   * win until it expires, so session activity cannot stomp an interaction in
   * flight.
   */
  public setExternalMood(mood: WhaleMood, until: number): void {
    if (this.disposed) return
    // Dizziness owns the pose until recovery; an actual error may still win.
    if (this.external?.mood === 'dizzy' && Date.now() < this.external.until && mood !== 'dizzy' && mood !== 'error') return
    this.external = { mood, until }
    this.applyActivity({ mood, intensity: 1 })
  }

  /** Drop the matching external mood and restore the latest session activity. */
  public clearExternalMood(expectedMood?: WhaleMood): void {
    if (this.external === null || (expectedMood !== undefined && this.external.mood !== expectedMood)) return
    this.external = null
    this.applyActivity(this.baseActivity)
  }

  /** Enter or refresh the fixed-duration dizzy reaction. */
  public enterDizzy(now = Date.now()): void {
    if (this.disposed) return
    const until = now + DIZZY_DURATION_MS
    this.setExternalMood('dizzy', until)
    if (this.external?.mood !== 'dizzy' || this.external.until !== until) return
    if (this.dizzyTimer !== null) clearTimeout(this.dizzyTimer)
    const activeOverride = this.external
    this.dizzyTimer = setTimeout(() => {
      this.dizzyTimer = null
      if (this.disposed || this.external !== activeOverride) return
      this.clearExternalMood('dizzy')
    }, DIZZY_DURATION_MS)
  }

  /** The active external mood override, or null. */
  public externalMood(): { mood: WhaleMood; until: number } | null {
    return this.external
  }

  /** Cycle to the next recap bubble (name/days entry first, then recent events). */
  public nextRecap(): void {
    if (this.disposed) return
    const pool = [this.nameRecap(), ...this.recapHistory]
    const first = pool[0]
    if (first === undefined) return
    this.recapIndex = (this.recapIndex + 1) % pool.length
    const entry = pool[this.recapIndex]
    if (entry === undefined) return
    this.recapCurrent = entry
    this.publish()
    this.scheduleRecapClear()
  }

  /** Current stable view snapshot for useSyncExternalStore. */
  public getSnapshot(): WhalePetViewSnapshot {
    return this.snapshot
  }

  /** Subscribe to snapshot changes. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Add one transient DOM effect (heart, bubble or sweat drop). */
  public playEffect(kind: WhaleEffectKind): void {
    if (this.disposed) return
    const effect: WhaleEffect = {
      id: this.nextEffectId,
      kind,
      ...(kind === 'bubble' ? { origin: this.bubbleOrigin() } : {}),
    }
    this.nextEffectId += 1
    this.effects = [...this.effects, effect]
    this.publish()
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.effects = this.effects.filter(candidate => candidate.id !== effect.id)
      this.publish()
    }, EFFECT_TTL_MS[kind])
    this.timers.add(timer)
  }

  /**
   * Anchor bubbles at the mouth side implied by the current model yaw.
   * yaw 0 faces left, π faces right; intermediate yaw faces toward/away.
   */
  private bubbleOrigin(): { x: number; y: number } {
    const forwardX = -Math.cos(this.controller.currentYaw)
    const x = Math.min(286, Math.max(34, 160 + forwardX * 126))
    const y = 70
    return { x, y }
  }

  /** Celebration: hearts keep appearing for the whole loop, plus bubbles. */
  public celebrate(): void {
    if (this.disposed) return
    this.playEffect('heart')
    this.playEffect('bubble')
    this.playEffect('bubble')
    this.scheduleCelebrationHearts()
    this.controller.celebrate()
  }

  /**
   * Error reaction: one sweat drop now, then a fresh drop every
   * {@link ERROR_SWEAT_INTERVAL_MS} until `until`, so the failure stays
   * clearly visible instead of a single drop that blends into the idle
   * bubbles.
   */
  public playErrorReaction(until: number): void {
    if (this.disposed) return
    this.playEffect('sweat')
    this.intervalUntil(until, ERROR_SWEAT_INTERVAL_MS, () => {
      if (Date.now() < until) this.playEffect('sweat')
    })
  }

  private scheduleCelebrationHearts(): void {
    const deadline = Date.now() + CELEBRATION_EFFECTS_MS
    this.intervalUntil(deadline, CELEBRATION_HEART_INTERVAL_MS, () => {
      this.playEffect('heart')
    })
  }

  /**
   * Run `emit` on a fixed interval until `deadline`, tracking each timer in
   * `this.timers` so `dispose()` can always clear the chain.
   */
  private intervalUntil(deadline: number, intervalMs: number, emit: () => void): void {
    let timer: ReturnType<typeof setTimeout>
    const tick = (): void => {
      this.timers.delete(timer)
      if (this.disposed) return
      emit()
      if (Date.now() < deadline) {
        timer = setTimeout(tick, intervalMs)
        this.timers.add(timer)
      }
    }
    timer = setTimeout(tick, intervalMs)
    this.timers.add(timer)
  }

  private scheduleRecapClear(ttlMs = RECAP_TTL_MS): void {
    if (this.recapTimer !== null) clearTimeout(this.recapTimer)
    this.recapTimer = setTimeout(() => {
      this.recapTimer = null
      if (this.disposed) return
      this.recapCurrent = null
      this.publish()
    }, ttlMs)
  }

  private nameRecap(): WhaleRecap {
    const days = daysSince(this.persisted.since)
    const text = days > 0
      ? `我是 ${this.persisted.name}，已陪伴 ${days} 天`
      : `我是 ${this.persisted.name}，今天第一次见面`
    return { id: 0, text }
  }

  /** Release timers, listeners and the WebGL surface. */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.recapTimer !== null) clearTimeout(this.recapTimer)
    if (this.dizzyTimer !== null) clearTimeout(this.dizzyTimer)
    this.recapTimer = null
    this.dizzyTimer = null
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
    this.controller.dispose()
    this.effects = []
    this.activity = IDLE_ACTIVITY
    this.baseActivity = IDLE_ACTIVITY
    this.bridge = 'off'
    this.recapCurrent = null
    this.external = null
    this.observer = null
    this.snapshot = this.buildSnapshot()
  }

  private applyActivity(activity: WhaleActivity): void {
    if (sameActivity(this.activity, activity)) return
    this.activity = activity
    this.controller.setActivity(activity)
    this.publish()
  }

  private buildSnapshot(): WhalePetViewSnapshot {
    return Object.freeze({
      activity: this.activity,
      effects: this.effects,
      bridge: this.bridge,
      name: this.persisted.name,
      hidden: this.persisted.hidden,
      snapToCorner: this.persisted.snapToCorner,
      recap: this.recapCurrent,
    })
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of [...this.listeners]) listener()
  }
}
