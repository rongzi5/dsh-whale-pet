import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveWhaleActivity, SessionWhaleObserver, type ObservableLike } from '../src/client/runtime/session-observer.ts'
import { WhalePetService } from '../src/client/runtime/whale-pet-service.ts'

function createObservable<T>(initial: T): ObservableLike<T> & { set(value: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: T): void {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('deriveWhaleActivity', () => {
  it('derives working/thinking/focused from an active session', () => {
    const now = 100_000
    expect(deriveWhaleActivity(now, { active: true, running: true, turnStartedAt: now - 1_000, lastActivityAt: now, awaitingInput: false })).toEqual({ mood: 'working', intensity: 0.7 })
    expect(deriveWhaleActivity(now, { active: true, running: false, turnStartedAt: now, lastActivityAt: now, awaitingInput: false })).toEqual({ mood: 'thinking', intensity: 0.7 })
    expect(deriveWhaleActivity(now, { active: true, running: true, turnStartedAt: now - 21_000, lastActivityAt: now, awaitingInput: false })).toEqual({ mood: 'focused', intensity: 1 })
  })

  it('falls asleep only after a long quiet period', () => {
    const now = 100_000
    expect(deriveWhaleActivity(now, { active: false, running: false, turnStartedAt: 0, lastActivityAt: now - 10_000, awaitingInput: false })).toEqual({ mood: 'idle', intensity: 0 })
    expect(deriveWhaleActivity(now, { active: false, running: false, turnStartedAt: 0, lastActivityAt: now - 61_000, awaitingInput: false })).toEqual({ mood: 'sleeping', intensity: 1 })
  })

  it('derives listening while awaiting user input within the sleep window', () => {
    const now = 100_000
    expect(deriveWhaleActivity(now, { active: false, running: false, turnStartedAt: 0, lastActivityAt: now - 5_000, awaitingInput: true })).toEqual({ mood: 'listening', intensity: 0.6 })
    // Activity wins over the awaiting flag…
    expect(deriveWhaleActivity(now, { active: true, running: true, turnStartedAt: now - 1_000, lastActivityAt: now, awaitingInput: true })).toEqual({ mood: 'working', intensity: 0.7 })
    // …and so does the long-quiet sleep rule.
    expect(deriveWhaleActivity(now, { active: false, running: false, turnStartedAt: 0, lastActivityAt: now - 61_000, awaitingInput: true })).toEqual({ mood: 'sleeping', intensity: 1 })
  })
})

describe('SessionWhaleObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const list = createObservable<{ current?: string }>({ current: 'session-1' })
    const conversation = createObservable({
      running: false,
      partial: null as { blocks: readonly unknown[] } | null,
      runningCalls: [] as unknown[],
      nodes: [] as { kind?: string; seq?: number; isError?: boolean }[],
      lastAgentError: null as string | null,
    })
    const goal = createObservable<unknown>(null)
    const plan = createObservable<unknown>({ active: false })
    const session = {
      ...conversation,
      projections: {
        faceOf(key: string): ObservableLike<unknown> {
          if (key === 'goal') return goal
          if (key === 'plan') return plan
          throw new Error(`unexpected projection ${key}`)
        },
      },
    }
    const sessions = {
      list,
      binding(id: string): { session: typeof session } | undefined {
        return id === 'session-1' ? { session } : undefined
      },
    }
    const service = new WhalePetService()
    const observer = new SessionWhaleObserver({ sessions }, service)
    service.bindObserver(observer)
    return { conversation, goal, list, observer, plan, service, sessions }
  }

  it('keeps retrying until the sessions service appears', () => {
    const list = createObservable<{ current?: string }>({ current: 'session-1' })
    const conversation = createObservable({
      running: false,
      partial: null as { blocks: readonly unknown[] } | null,
      runningCalls: [] as unknown[],
      nodes: [] as { kind?: string; seq?: number; isError?: boolean }[],
      lastAgentError: null as string | null,
    })
    const sessions = {
      list,
      binding(id: string): { session: typeof conversation } | undefined {
        return id === 'session-1' ? { session: conversation } : undefined
      },
    }
    let provided: typeof sessions | undefined
    const ctx = {
      get sessions(): typeof sessions | undefined {
        if (provided === undefined) throw new Error('sessions service not available yet')
        return provided
      },
    }

    const service = new WhalePetService()
    const observer = new SessionWhaleObserver(ctx, service)
    observer.start()
    expect(service.getSnapshot().bridge).toBe('waiting')

    vi.advanceTimersByTime(400)
    expect(service.getSnapshot().bridge).toBe('waiting')

    provided = sessions
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().bridge).toBe('bound')

    observer.dispose()
    service.dispose()
  })

  it('maps running tool calls to working and long turns to focused', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: true,
      partial: { blocks: [1] },
      runningCalls: [{ name: 'bash' }],
      nodes: [],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().activity.mood).toBe('working')

    vi.advanceTimersByTime(20_000)
    expect(service.getSnapshot().activity.mood).toBe('focused')

    observer.dispose()
    service.dispose()
  })

  it('fires immediately for a genuinely new failure inside the settle window', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: true,
      partial: null,
      runningCalls: [],
      nodes: [{ kind: 'tool-result', seq: 2, time: Date.now(), isError: true }],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)

    expect(service.getSnapshot().activity.mood).toBe('error')
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'sweat')).toBe(true)

    observer.dispose()
    service.dispose()
  })

  it('shows a sweat effect and error mood for tool failures', () => {
    const { conversation, observer, service } = setup()
    observer.start()
    vi.advanceTimersByTime(3_000)

    conversation.set({
      running: true,
      partial: null,
      runningCalls: [],
      nodes: [{ kind: 'tool-result', seq: 4, isError: false, resultView: { exitCode: 7 } }],
      lastAgentError: 'boom',
    })
    vi.advanceTimersByTime(200)

    expect(service.getSnapshot().activity.mood).toBe('error')
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'sweat')).toBe(true)

    // The error expression persists for the extended reaction window.
    vi.advanceTimersByTime(5_000)
    expect(service.getSnapshot().activity.mood).toBe('error')
    vi.advanceTimersByTime(3_500)
    expect(service.getSnapshot().activity.mood).toBe('working')

    observer.dispose()
    service.dispose()
  })

  it('absorbs late-arriving historical errors right after binding', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: false,
      partial: null,
      runningCalls: [],
      nodes: [{ kind: 'tool-result', seq: 9, isError: true }],
      lastAgentError: 'old error',
    })
    vi.advanceTimersByTime(2_600)

    expect(service.getSnapshot().activity.mood).toBe('idle')
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'sweat')).toBe(false)

    observer.dispose()
    service.dispose()
  })

  it('celebrates completed long turns with hearts and bubbles', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: true,
      partial: { blocks: [1] },
      runningCalls: [],
      nodes: [],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(16_000)
    conversation.set({
      running: false,
      partial: null,
      runningCalls: [],
      nodes: [],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)

    expect(service.getSnapshot().activity.mood).toBe('celebrating')
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'heart')).toBe(true)
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'bubble')).toBe(true)

    // Hearts keep appearing while the loop runs, then stop with it.
    vi.advanceTimersByTime(4_000)
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'heart')).toBe(true)
    vi.advanceTimersByTime(5_000)
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'heart')).toBe(false)

    observer.dispose()
    service.dispose()
  })

  it('celebrates a goal reaching the complete phase', () => {
    const { goal, observer, service } = setup()
    goal.set({ goal: { phase: 'active' } })
    observer.start()

    goal.set({ goal: { phase: 'complete' } })
    vi.advanceTimersByTime(200)

    expect(service.getSnapshot().activity.mood).toBe('celebrating')

    observer.dispose()
    service.dispose()
  })

  it('falls asleep after a long quiet period and wakes into listening', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: true,
      partial: { blocks: [1] },
      runningCalls: [],
      nodes: [],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    conversation.set({
      running: false,
      partial: null,
      runningCalls: [],
      nodes: [],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(61_000)

    expect(service.getSnapshot().activity.mood).toBe('sleeping')

    // Hover/drag wakes the pet and resets the idle clock; since the agent
    // still owes the user a reply, the pet wakes into listening.
    service.wake()
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().activity.mood).toBe('listening')

    observer.dispose()
    service.dispose()
  })

  it('turns the pet to listening when the agent hands the turn back', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: true,
      partial: { blocks: [1] },
      runningCalls: [],
      nodes: [],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().activity.mood).toBe('working')

    conversation.set({
      running: false,
      partial: null,
      runningCalls: [],
      nodes: [{ kind: 'assistant', seq: 5 }],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().activity.mood).toBe('listening')

    // The waiting recap is queued and surfaces on the next click.
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('等你输入…')

    observer.dispose()
    service.dispose()
  })

  it('leaves listening when the user starts a new turn', () => {
    const { conversation, observer, service } = setup()
    observer.start()

    conversation.set({
      running: true,
      partial: { blocks: [1] },
      runningCalls: [],
      nodes: [{ kind: 'user', seq: 1 }],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    conversation.set({
      running: false,
      partial: null,
      runningCalls: [],
      nodes: [{ kind: 'user', seq: 1 }, { kind: 'assistant', seq: 5 }],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().activity.mood).toBe('listening')

    // A new user message starts a fresh turn: back to work.
    conversation.set({
      running: true,
      partial: { blocks: [1] },
      runningCalls: [],
      nodes: [{ kind: 'user', seq: 6 }, { kind: 'assistant', seq: 5 }],
      lastAgentError: null,
    })
    vi.advanceTimersByTime(200)
    expect(service.getSnapshot().activity.mood).toBe('working')

    observer.dispose()
    service.dispose()
  })

  it('records an error recap naming the failed tool', () => {
    const { conversation, observer, service } = setup()
    observer.start()
    vi.advanceTimersByTime(3_000)

    conversation.set({
      running: true,
      partial: null,
      runningCalls: [],
      nodes: [{ kind: 'tool-result', seq: 4, isError: false, call: { name: 'bash' }, resultView: { exitCode: 7 } }],
      lastAgentError: 'boom',
    })
    vi.advanceTimersByTime(200)

    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('bash 失败（exit 7）')

    observer.dispose()
    service.dispose()
  })
})
