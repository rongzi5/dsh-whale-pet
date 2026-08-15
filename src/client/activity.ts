/**
 * Pure vocabulary for whale pet behavior. Shared by the motion controller,
 * the Three.js scene and the runtime services without importing any platform
 * code, so the whole behavior state machine stays unit-testable.
 */

export type WhaleMood =
  /** No session activity: the original relaxed edge-habitat behavior. */
  | 'idle'
  /** Assistant text or reasoning is streaming in. */
  | 'thinking'
  /** At least one tool call is currently running. */
  | 'working'
  /** A single turn has been active for a long time. */
  | 'focused'
  /** A long turn, goal, or plan just completed. */
  | 'celebrating'
  /** A tool call or turn failed. */
  | 'error'
  /** No activity for a long time. */
  | 'sleeping'

export interface WhaleActivity {
  mood: WhaleMood
  /** 0..1 strength of the mood; sleep/error use it as a transient display weight. */
  intensity: number
}

export type WhaleEffectKind = 'heart' | 'bubble' | 'sweat'

export interface WhaleEffect {
  id: number
  kind: WhaleEffectKind
}

/** Stable view snapshot consumed through useSyncExternalStore. */
export interface WhalePetViewSnapshot {
  activity: WhaleActivity
  effects: readonly WhaleEffect[]
}

export const IDLE_ACTIVITY: WhaleActivity = Object.freeze({ mood: 'idle', intensity: 0 })

export function sameActivity(left: WhaleActivity, right: WhaleActivity): boolean {
  return left.mood === right.mood && left.intensity === right.intensity
}
