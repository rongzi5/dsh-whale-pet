/**
 * Session activity bridge: polls the current DSH session's conversation and
 * projection snapshots and maps them onto whale moods and transient effects.
 *
 * The observer intentionally depends only on structural interfaces (the
 * ObservableSnapshot contract), not on value imports from the runtime
 * package, so the client bundle stays inside the platform purity rules and
 * the derivation logic can be unit-tested with plain fixtures.
 */

import type { WhaleActivity, WhaleEffectKind } from '../activity.ts'
import { WhalePetService } from './whale-pet-service.ts'

const POLL_MS = 200
const FOCUS_AFTER_MS = 20_000
const LONG_TURN_MS = 15_000
const IDLE_SLEEP_MS = 60_000
const CELEBRATE_MS = 5_000
const ERROR_MS = 4_000
const ACTIVE_BUBBLE_MS = 3_500
const ERROR_SETTLE_MS = 2_500

export interface ObservableLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionListLike {
  current?: string
}

interface ConversationLike {
  running: boolean
  partial: { blocks: readonly unknown[] } | null
  runningCalls: readonly unknown[]
  nodes: readonly ConversationNodeLike[]
  lastAgentError?: string | null
}

interface ConversationNodeLike {
  kind?: string
  seq?: number
  isError?: boolean
}

interface GoalProjectionLike {
  goal?: { phase?: string }
}

interface PlanProjectionLike {
  active?: boolean
}

interface SessionFaceLike extends ObservableLike<ConversationLike> {
  projections?: {
    faceOf(key: string): ObservableLike<unknown>
  }
}

interface SessionBindingLike {
  session: SessionFaceLike
}

interface SessionsLike {
  list: ObservableLike<SessionListLike>
  binding(id: string): SessionBindingLike | undefined
}

export interface WhaleSessionClientContext {
  sessions?: SessionsLike
}

interface TransientMood {
  mood: 'celebrating' | 'error'
  until: number
}

function latestErrorSeq(nodes: readonly ConversationNodeLike[]): number {
  let seq = -1
  for (const node of nodes) {
    if (node.kind === 'turn-error' || (node.kind === 'tool-result' && node.isError === true)) {
      seq = Math.max(seq, node.seq ?? 0)
    }
  }
  return seq
}

/**
 * Pure mood derivation, separated for tests.
 * @returns the non-transient mood for the sampled session state.
 */
export function deriveWhaleActivity(
  now: number,
  state: {
    active: boolean
    running: boolean
    turnStartedAt: number
    lastActivityAt: number
  },
): WhaleActivity {
  if (state.active) {
    const runningMs = state.running ? now - state.turnStartedAt : 0
    if (runningMs >= FOCUS_AFTER_MS) return { mood: 'focused', intensity: 1 }
    return { mood: state.running ? 'working' : 'thinking', intensity: 0.7 }
  }
  if (!state.running && now - state.lastActivityAt >= IDLE_SLEEP_MS) {
    return { mood: 'sleeping', intensity: 1 }
  }
  return { mood: 'idle', intensity: 0 }
}

export class SessionWhaleObserver {
  private listDispose: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private sessions: SessionsLike | null = null
  private sessionId: string | undefined
  private session: SessionFaceLike | null = null
  private goalFace: ObservableLike<unknown> | null = null
  private planFace: ObservableLike<unknown> | null = null

  private wasRunning = false
  private turnStartedAt = 0
  private lastActivityAt = Date.now()
  private lastErrorSeq = -1
  private lastAgentError: string | null = null
  private knownGoalPhase: string | undefined
  private knownPlanActive: boolean | undefined
  private transient: TransientMood | null = null
  private lastActivityBubbleAt = 0
  private lastMood: WhaleActivity['mood'] | null = null
  private boundAt = 0
  private disposed = false

  public constructor(
    private readonly ctx: WhaleSessionClientContext,
    private readonly service: WhalePetService,
  ) {}

  /**
   * Start the sample loop. The sessions service may activate after this
   * plugin, so the bridge keeps retrying every poll until `ctx.sessions`
   * becomes available.
   */
  public start(): void {
    if (this.disposed) return
    this.service.setBridgeState('waiting')
    this.resolveSessions()
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      this.tick()
    }, POLL_MS)
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listDispose?.()
    this.listDispose = null
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.sessions = null
    this.session = null
    this.goalFace = null
    this.planFace = null
    this.service.setBridgeState('off')
  }

  private tick(): void {
    if (this.disposed) return
    if (this.sessions === null) {
      this.resolveSessions()
      return
    }
    this.sample(this.sessions)
  }

  private resolveSessions(): void {
    if (this.sessions !== null || this.disposed) return
    let sessions: SessionsLike | undefined
    try {
      sessions = this.ctx.sessions
    } catch {
      sessions = undefined
    }
    if (sessions === undefined) return
    this.sessions = sessions
    this.service.setBridgeState('bound')
    this.listDispose = sessions.list.subscribe(() => {
      this.rebind(sessions)
    })
    this.rebind(sessions)
  }

  private rebind(sessions: SessionsLike): void {
    if (this.disposed) return
    const current = sessions.list.getSnapshot().current
    if (current !== this.sessionId) {
      this.sessionId = current
      this.session = null
      this.goalFace = null
      this.planFace = null
      this.wasRunning = false
      this.turnStartedAt = 0
      this.lastActivityAt = Date.now()
      this.lastErrorSeq = -1
      this.lastAgentError = null
      this.knownGoalPhase = undefined
      this.knownPlanActive = undefined
      this.transient = null
      this.boundAt = 0
      if (current === undefined) {
        this.applyActivity({ mood: 'idle', intensity: 0 })
      }
    }
    if (current === undefined) return
    if (this.session !== null) return
    const binding = sessions.binding(current)
    if (binding === undefined) return
    this.session = binding.session
    this.goalFace = safeProjection(binding.session, 'goal')
    this.planFace = safeProjection(binding.session, 'plan')
    this.seedProjections()
    const snapshot = binding.session.getSnapshot()
    this.boundAt = Date.now()
    this.wasRunning = snapshot.running
    this.turnStartedAt = snapshot.running ? Date.now() : 0
    this.lastActivityAt = Date.now()
    this.lastErrorSeq = latestErrorSeq(snapshot.nodes)
    this.lastAgentError = snapshot.lastAgentError ?? null
    console.debug('[ui-whale-pet] session bridge bound', current, {
      running: snapshot.running,
      calls: snapshot.runningCalls.length,
      partial: snapshot.partial !== null,
    })
  }

  private sample(sessions: SessionsLike): void {
    if (this.disposed) return
    const current = sessions.list.getSnapshot().current
    if (current !== this.sessionId) {
      this.rebind(sessions)
      return
    }
    if (this.sessionId === undefined) return
    if (this.session === null) {
      this.rebind(sessions)
      if (this.session === null) return
    }

    const session = this.session
    const snapshot = session.getSnapshot()
    const now = Date.now()
    const hasPartial = snapshot.partial !== null && snapshot.partial.blocks.length > 0
    const hasCalls = snapshot.runningCalls.length > 0
    const active = snapshot.running || hasPartial || hasCalls
    if (active) this.lastActivityAt = now

    // Tool/turn failures: react once per new failure node. History windows
    // load asynchronously after binding, so the first ERROR_SETTLE_MS only
    // absorb late-arriving old nodes without reacting to them.
    const errorSeq = latestErrorSeq(snapshot.nodes)
    const agentError = snapshot.lastAgentError ?? null
    if (errorSeq > this.lastErrorSeq) {
      const settled = now - this.boundAt >= ERROR_SETTLE_MS
      this.lastErrorSeq = errorSeq
      this.lastAgentError = agentError
      if (settled) {
        this.transient = { mood: 'error', until: now + ERROR_MS }
        this.service.playEffect('sweat')
      }
    }

    // Turn boundaries: celebrate long completed turns, goals, and plans.
    if (snapshot.running && !this.wasRunning) this.turnStartedAt = now
    if (!snapshot.running && this.wasRunning) {
      const turnMs = now - this.turnStartedAt
      if (turnMs >= LONG_TURN_MS && (this.transient === null || this.transient.mood !== 'error')) {
        this.celebrate(now)
      }
    }

    const goalPhase = readGoalPhase(this.goalFace)
    if (goalPhase !== undefined && this.knownGoalPhase !== undefined && goalPhase !== this.knownGoalPhase) {
      if (this.knownGoalPhase !== 'complete' && goalPhase === 'complete') this.celebrate(now)
    }
    if (goalPhase !== undefined) this.knownGoalPhase = goalPhase

    const planActive = readPlanActive(this.planFace)
    if (planActive !== undefined && this.knownPlanActive !== undefined && planActive !== this.knownPlanActive) {
      if (this.knownPlanActive && !planActive) this.celebrate(now)
    }
    if (planActive !== undefined) this.knownPlanActive = planActive

    this.wasRunning = snapshot.running

    // Transient moods win until they expire.
    if (this.transient !== null) {
      if (now < this.transient.until) {
        this.applyActivity({ mood: this.transient.mood, intensity: 1 })
        return
      }
      this.transient = null
    }

    const mood = deriveWhaleActivity(now, {
      active,
      running: snapshot.running,
      turnStartedAt: this.turnStartedAt,
      lastActivityAt: this.lastActivityAt,
    })

    // Thinking/working/focused keeps a slow stream of bubbles so the
    // activity is visible even while the pet is resting at the edge.
    if (
      (mood.mood === 'thinking' || mood.mood === 'working' || mood.mood === 'focused')
      && now - this.lastActivityBubbleAt >= ACTIVE_BUBBLE_MS
    ) {
      this.lastActivityBubbleAt = now
      this.service.playEffect('bubble')
    }

    this.applyActivity(mood)
  }

  private applyActivity(activity: WhaleActivity): void {
    if (this.lastMood !== activity.mood) {
      console.debug('[ui-whale-pet] mood ->', activity.mood)
      this.lastMood = activity.mood
    }
    this.service.setActivity(activity)
  }

  private seedProjections(): void {
    const goalPhase = readGoalPhase(this.goalFace)
    if (goalPhase !== undefined) this.knownGoalPhase = goalPhase
    const planActive = readPlanActive(this.planFace)
    if (planActive !== undefined) this.knownPlanActive = planActive
  }

  private celebrate(now: number): void {
    this.transient = { mood: 'celebrating', until: now + CELEBRATE_MS }
    this.service.setActivity({ mood: 'celebrating', intensity: 1 })
    this.service.celebrate()
  }
}

function safeProjection(session: SessionFaceLike, key: string): ObservableLike<unknown> | null {
  try {
    return session.projections?.faceOf(key) ?? null
  } catch {
    return null
  }
}

function readGoalPhase(face: ObservableLike<unknown> | null): string | undefined {
  if (face === null) return undefined
  try {
    const value = face.getSnapshot() as GoalProjectionLike | null | undefined
    return value?.goal?.phase
  } catch {
    return undefined
  }
}

function readPlanActive(face: ObservableLike<unknown> | null): boolean | undefined {
  if (face === null) return undefined
  try {
    const value = face.getSnapshot() as PlanProjectionLike | undefined
    return value?.active
  } catch {
    return undefined
  }
}

export const SESSION_BRIDGE_THRESHOLDS = Object.freeze({
  POLL_MS,
  FOCUS_AFTER_MS,
  LONG_TURN_MS,
  IDLE_SLEEP_MS,
  CELEBRATE_MS,
  ERROR_MS,
  ACTIVE_BUBBLE_MS,
  ERROR_SETTLE_MS,
})

export type { WhaleEffectKind }
