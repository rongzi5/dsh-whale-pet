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
import { pendingInteractionToText, type WhalePendingInteraction, type WhaleSessionProgress } from '../progress.ts'
import { WhalePetService } from './whale-pet-service.ts'

const POLL_MS = 200
const FOCUS_AFTER_MS = 20_000
const LONG_TURN_MS = 15_000
const IDLE_SLEEP_MS = 60_000
const CELEBRATE_MS = 7_500
const ERROR_MS = 3_000
const ACTIVE_BUBBLE_MS = 3_500
const ERROR_SETTLE_MS = 2_500

export interface ObservableLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionSummaryLike {
  pendingInteraction?: WhalePendingInteraction
}

interface SessionListLike {
  current?: string
  byId?: Record<string, SessionSummaryLike>
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
  time?: number
  isError?: boolean
  resultView?: { exitCode?: number }
  call?: { name?: string } | null
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

interface ErrorMark {
  seq: number
  time: number
  kind: 'tool-result' | 'turn-error'
  exitCode?: number
  toolName?: string
}

function latestError(nodes: readonly ConversationNodeLike[]): ErrorMark | null {
  let seq = -1
  let time = -Infinity
  let kind: ErrorMark['kind'] | undefined
  let exitCode: number | undefined
  let toolName: string | undefined
  for (const node of nodes) {
    const exit = node.resultView?.exitCode
    const failed = node.kind === 'turn-error'
      || (node.kind === 'tool-result' && (node.isError === true || (typeof exit === 'number' && exit !== 0)))
    if (failed) {
      const next = node.seq ?? 0
      if (next >= seq) {
        seq = next
        time = node.time ?? time
        kind = node.kind === 'turn-error' ? 'turn-error' : 'tool-result'
        exitCode = typeof exit === 'number' ? exit : undefined
        toolName = typeof node.call?.name === 'string' ? node.call.name : undefined
      }
    }
  }
  if (seq < 0 || kind === undefined) return null
  return { seq, time, kind, ...(exitCode !== undefined ? { exitCode } : {}), ...(toolName !== undefined ? { toolName } : {}) }
}

/** One-line recap text for a fresh failure node. */
function errorRecapText(mark: ErrorMark): string {
  if (mark.kind === 'turn-error') return '回合出错'
  const name = mark.toolName
  const exit = mark.exitCode
  if (name !== undefined && exit !== undefined) return `${name} 失败（exit ${exit}）`
  if (name !== undefined) return `${name} 失败`
  if (exit !== undefined) return `工具失败（exit ${exit}）`
  return '工具调用失败'
}

/**
 * Whether a failure node is fresh enough to react to. Timestamped nodes are
 * fresh when they arrived after the session bridge bound; untimestamped nodes
 * use the settle window as a proxy so late-arriving history is absorbed.
 */
function isFreshError(mark: ErrorMark, boundAt: number, now: number): boolean {
  const timestamped = Number.isFinite(mark.time)
  return timestamped
    ? mark.time >= boundAt
    : now - boundAt >= ERROR_SETTLE_MS
}

/** Whether a completed turn is long enough to celebrate, outside an error. */
function shouldCelebrateCompletedTurn(
  wasRunning: boolean,
  running: boolean,
  turnStartedAt: number,
  now: number,
  transient: TransientMood | null,
): boolean {
  if (!wasRunning || running) return false
  const turnMs = now - turnStartedAt
  return turnMs >= LONG_TURN_MS && (transient === null || transient.mood !== 'error')
}

/** Classify a goal projection transition for recap/celebration purposes. */
function classifyGoalTransition(
  previous: string | undefined,
  next: string | undefined,
): 'completed' | 'phase' | null {
  if (previous === undefined || next === undefined || previous === next) return null
  if (previous !== 'complete' && next === 'complete') return 'completed'
  if (next !== 'complete') return 'phase'
  return null
}

/** Classify a plan projection transition for recap/celebration purposes. */
function classifyPlanTransition(
  previous: boolean | undefined,
  next: boolean | undefined,
): 'exited' | null {
  if (previous === undefined || next === undefined || previous === next) return null
  if (previous && !next) return 'exited'
  return null
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
    userTyping: boolean
    pendingInteraction?: WhalePendingInteraction
  },
): WhaleActivity {
  // A pending user interaction (approval / question / plan-review) wins over
  // working/thinking: the turn is often still marked running while the agent
  // is blocked on the user. The pet should stare at the input, not swim as if
  // it were still executing.
  if (state.pendingInteraction !== undefined) return { mood: 'awaiting', intensity: 1 }
  if (state.active) {
    const runningMs = state.running ? now - state.turnStartedAt : 0
    if (runningMs >= FOCUS_AFTER_MS) return { mood: 'focused', intensity: 1 }
    return { mood: state.running ? 'working' : 'thinking', intensity: 0.7 }
  }
  // The user is composing a reply: the pet looks on expectantly and stays
  // awake regardless of the idle clock, until the input loses focus.
  if (state.userTyping) return { mood: 'listening', intensity: 0.6 }
  if (!state.running && now - state.lastActivityAt >= IDLE_SLEEP_MS) {
    return { mood: 'sleeping', intensity: 1 }
  }
  return { mood: 'idle', intensity: 0 }
}

export class SessionWhaleObserver {
  private listDispose: (() => void) | null = null
  private sessionDispose: (() => void) | null = null
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
  private knownGoalPhase: string | undefined
  private knownPlanActive: boolean | undefined
  private transient: TransientMood | null = null
  private lastActivityBubbleAt = 0
  private lastMood: WhaleActivity['mood'] | null = null
  private boundAt = 0
  private lastNodeCount = -1
  private userTyping = false
  private lastPending: WhalePendingInteraction | undefined
  private lastCompactionSeq = -1
  private lastNudgeAt = 0
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
    this.sessionDispose?.()
    this.sessionDispose = null
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.sessions = null
    this.session = null
    this.goalFace = null
    this.planFace = null
    this.service.setBridgeState('off')
  }

  /** Record direct user interaction so sleep can be interrupted. */
  public noteUserActivity(): void {
    this.lastActivityAt = Date.now()
  }

  /**
   * A read-only progress snapshot of the bound session, for the pet's chat
   * and click recap. Returns null when no session is bound. Never writes to
   * the session.
   */
  public getProgress(): WhaleSessionProgress | null {
    if (this.sessions === null || this.session === null || this.sessionId === undefined) return null
    let current: string | undefined
    try {
      current = this.sessions.list.getSnapshot().current
    } catch {
      return null
    }
    if (current !== this.sessionId) return null
    let snapshot: ConversationLike
    try {
      snapshot = this.session.getSnapshot()
    } catch {
      return null
    }
    const hasPartial = snapshot.partial !== null && snapshot.partial.blocks.length > 0
    const active = snapshot.running || hasPartial || snapshot.runningCalls.length > 0
    const tools = snapshot.runningCalls
      .map(call => (typeof (call as { name?: unknown }).name === 'string' ? (call as { name: string }).name : 'tool'))
      .slice(0, 5)
    const lastNode = snapshot.nodes[snapshot.nodes.length - 1]
    const lastTool = lastNode?.call?.name
    const pending = readPendingInteraction(this.sessions, this.sessionId)
    return {
      sessionId: this.sessionId,
      active,
      running: snapshot.running,
      tools,
      turnMs: snapshot.running ? Math.max(0, Date.now() - this.turnStartedAt) : 0,
      nodeCount: snapshot.nodes.length,
      ...(lastTool !== undefined ? { lastTool } : {}),
      ...(this.knownGoalPhase !== undefined ? { goalPhase: this.knownGoalPhase } : {}),
      ...(this.knownPlanActive !== undefined ? { planActive: this.knownPlanActive } : {}),
      ...(pending !== undefined ? { pendingInteraction: pending } : {}),
    }
  }

  /**
   * Track whether the user is composing a reply. Driven by DOM focus events
   * on the chat input from the view; while typing, the pet stays in the
   * `listening` mood and the idle clock is held.
   */
  public setUserTyping(typing: boolean): void {
    if (this.userTyping === typing || this.disposed) return
    this.userTyping = typing
    if (typing) {
      this.lastActivityAt = Date.now()
      this.service.pushRecap('在呢，我听着～')
    }
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
      this.sessionDispose?.()
      this.sessionDispose = null
      this.session = null
      this.goalFace = null
      this.planFace = null
      this.wasRunning = false
      this.turnStartedAt = 0
      this.lastActivityAt = Date.now()
      this.lastErrorSeq = -1
      this.lastNodeCount = -1
      this.knownGoalPhase = undefined
      this.knownPlanActive = undefined
      this.lastPending = undefined
      this.lastCompactionSeq = -1
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
    this.sessionDispose = binding.session.subscribe(() => {
      if (this.sessions === sessions) this.sample(sessions)
    })
    this.seedProjections()
    const snapshot = binding.session.getSnapshot()
    this.boundAt = Date.now()
    this.wasRunning = snapshot.running
    this.turnStartedAt = snapshot.running ? Date.now() : 0
    this.lastActivityAt = Date.now()
    this.lastErrorSeq = latestError(snapshot.nodes)?.seq ?? -1
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
    // load asynchronously after binding, so late-arriving OLD nodes (time
    // before the bind) are absorbed, while a genuinely new failure fires
    // immediately even inside the settle window.
    const mark = latestError(snapshot.nodes)
    if (snapshot.nodes.length !== this.lastNodeCount) {
      this.lastNodeCount = snapshot.nodes.length
      const tail = snapshot.nodes.slice(-4).map(node => ({
        kind: node.kind,
        seq: node.seq,
        time: node.time,
        isError: node.isError,
        exitCode: node.resultView?.exitCode,
      }))
      console.debug('[ui-whale-pet] conversation nodes ->', snapshot.nodes.length, JSON.stringify(tail))
    }
    if (mark !== null && mark.seq > this.lastErrorSeq) {
      const fresh = isFreshError(mark, this.boundAt, now)
      this.lastErrorSeq = mark.seq
      if (fresh) {
        this.transient = { mood: 'error', until: now + ERROR_MS }
        this.service.playErrorReaction(now + ERROR_MS)
        this.service.pushRecap(errorRecapText(mark))
      }
    }

    // Turn boundaries: celebrate long completed turns, goals, and plans.
    if (snapshot.running && !this.wasRunning) {
      this.turnStartedAt = now
    }
    if (shouldCelebrateCompletedTurn(this.wasRunning, snapshot.running, this.turnStartedAt, now, this.transient)) {
      this.celebrate(now)
      this.service.pushRecap('长回合完成 🎉')
    }

    const goalPhase = readGoalPhase(this.goalFace)
    const goalTransition = classifyGoalTransition(this.knownGoalPhase, goalPhase)
    if (goalTransition === 'completed') {
      this.celebrate(now)
      this.service.pushRecap('goal 达成 🎉')
    } else if (goalTransition === 'phase') {
      this.service.pushRecap(`goal 阶段：${goalPhase}`)
    }
    if (goalPhase !== undefined) this.knownGoalPhase = goalPhase

    const planActive = readPlanActive(this.planFace)
    const planTransition = classifyPlanTransition(this.knownPlanActive, planActive)
    if (planTransition === 'exited') {
      this.celebrate(now)
      this.service.pushRecap('退出 plan')
    }
    if (planActive !== undefined) this.knownPlanActive = planActive

    this.wasRunning = snapshot.running

    // External interactions (e.g. chat thinking) win over every
    // session-derived state until they expire.
    const external = this.service.externalMood()
    if (external !== null && now < external.until) {
      this.applyActivity({ mood: external.mood, intensity: 1 })
      return
    }

    // Transient moods win until they expire.
    if (this.transient !== null) {
      if (now < this.transient.until) {
        this.applyActivity({ mood: this.transient.mood, intensity: 1 })
        return
      }
      this.transient = null
    }

    const pending = readPendingInteraction(sessions, this.sessionId)
    if (pending !== undefined) this.lastActivityAt = now
    if (pending !== this.lastPending) {
      if (pending !== undefined) this.service.pushRecap(pendingInteractionToText(pending))
      this.lastPending = pending
    }

    const mood = deriveWhaleActivity(now, {
      active,
      running: snapshot.running,
      turnStartedAt: this.turnStartedAt,
      lastActivityAt: this.lastActivityAt,
      userTyping: this.userTyping,
      ...(pending !== undefined ? { pendingInteraction: pending } : {}),
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

    this.maybeNudge(now, snapshot.nodes, mood.mood)
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

  /**
   * Extremely sparse unsolicited talk: one greeting per local day, plus a
   * compaction notice. Never calls the LLM. Rate-limited so two events in
   * the same minute cannot stack bubbles.
   */
  private maybeNudge(now: number, nodes: readonly ConversationNodeLike[], mood: WhaleActivity['mood']): void {
    if (this.service.externalMood() !== null) return
    const compaction = latestCompaction(nodes)
    if (compaction !== null && compaction.seq > this.lastCompactionSeq) {
      this.lastCompactionSeq = compaction.seq
      if (compaction.seq > 0 && now - this.boundAt >= ERROR_SETTLE_MS) {
        this.service.showBubble('记忆被压扁了一点，我还在～', 4_500)
        this.lastNudgeAt = now
        return
      }
    }
    if (now - this.lastNudgeAt < 60_000) return
    if (mood !== 'idle' && mood !== 'sleeping') return
    if (this.service.greetOnceToday(now)) this.lastNudgeAt = now
  }
}

function latestCompaction(nodes: readonly ConversationNodeLike[]): { seq: number } | null {
  let seq = -1
  for (const node of nodes) {
    if (node.kind !== 'compaction') continue
    const next = node.seq ?? 0
    if (next >= seq) seq = next
  }
  return seq < 0 ? null : { seq }
}

function readPendingInteraction(
  sessions: SessionsLike,
  sessionId: string | undefined,
): WhalePendingInteraction | undefined {
  if (sessionId === undefined) return undefined
  let list: SessionListLike
  try {
    list = sessions.list.getSnapshot()
  } catch {
    return undefined
  }
  const pending = list.byId?.[sessionId]?.pendingInteraction
  if (pending === 'approval' || pending === 'plan-review' || pending === 'question') return pending
  return undefined
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
