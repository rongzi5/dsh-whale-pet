/**
 * Whale pet runtime service: the single owner of motion, scene mount and
 * transient effect counters. The React overlay only renders
 * {@link WhalePetViewSnapshot}; session state and other future plugins drive
 * the same service through {@link setActivity} and {@link playEffect}.
 */

import { IDLE_ACTIVITY, sameActivity, type WhaleActivity, type WhaleBridgeState, type WhaleEffect, type WhaleEffectKind, type WhalePetViewSnapshot } from '../activity.ts'
import { WhalePetController, type WhalePetControllerHooks, type WhalePetTargets } from './whale-pet-controller.ts'
import type { SessionWhaleObserver } from './session-observer.ts'

const EFFECT_TTL_MS: Record<WhaleEffectKind, number> = {
  heart: 950,
  bubble: 1700,
  sweat: 5000,
}

export class WhalePetService {
  private readonly controller = new WhalePetController()
  private readonly listeners = new Set<() => void>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private activity: WhaleActivity = IDLE_ACTIVITY
  private effects: readonly WhaleEffect[] = []
  private bridge: WhaleBridgeState = 'off'
  private snapshot: WhalePetViewSnapshot = { activity: this.activity, effects: this.effects, bridge: this.bridge }
  private nextEffectId = 1
  private observer: SessionWhaleObserver | null = null
  private disposed = false

  /** Mount the view's DOM handles. Delegates to the controller unchanged. */
  public mount(targets: WhalePetTargets, hooks: WhalePetControllerHooks): boolean {
    if (this.disposed) return false
    return this.controller.start(targets, hooks)
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
    this.observer?.noteUserActivity()
    this.setActivity(IDLE_ACTIVITY)
    this.controller.setActivity(IDLE_ACTIVITY)
  }

  /** View-delegated interaction passthroughs. */
  public setHover(hovering: boolean): void {
    this.controller.setHover(hovering)
  }

  public beginDrag(pointerX: number, pointerY: number): void {
    this.controller.beginDrag(pointerX, pointerY)
  }

  public wasClick(maximumDrag = 7): boolean {
    return this.controller.wasClick(maximumDrag)
  }

  /** Replace the current mood; no-op for identical activity. */
  public setActivity(activity: WhaleActivity): void {
    if (sameActivity(this.activity, activity)) return
    this.activity = activity
    this.controller.setActivity(activity)
    this.publish()
  }

  /** Update the session-bridge lifecycle state (observer-owned). */
  public setBridgeState(bridge: WhaleBridgeState): void {
    if (this.bridge === bridge) return
    this.bridge = bridge
    this.publish()
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
    const effect: WhaleEffect = { id: this.nextEffectId, kind }
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

  /** Short celebration: hearts + bubbles, and the motion layer runs a victory lap. */
  public celebrate(): void {
    this.playEffect('heart')
    this.playEffect('bubble')
    this.playEffect('bubble')
    this.controller.celebrate()
  }

  /** Release timers, listeners and the WebGL surface. */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
    this.controller.dispose()
    this.effects = []
    this.activity = IDLE_ACTIVITY
    this.bridge = 'off'
    this.observer = null
    this.snapshot = { activity: this.activity, effects: this.effects, bridge: this.bridge }
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      activity: this.activity,
      effects: this.effects,
      bridge: this.bridge,
    })
    for (const listener of [...this.listeners]) listener()
  }
}
