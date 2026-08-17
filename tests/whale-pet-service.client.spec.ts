import { describe, expect, it, vi } from 'vitest'
import type { WhaleMotionController } from '../src/client/motion.ts'
import { loadWhalePetState, type StorageLike } from '../src/client/persistence.ts'
import { DIZZY_DURATION_MS, WhalePetService, shouldEnterDizzy } from '../src/client/runtime/whale-pet-service.ts'

class FakeStorage implements StorageLike {
  private readonly map = new Map<string, string>()

  public getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  public setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

describe('WhalePetService', () => {
  it('anchors bubbles at the mouth implied by the current yaw', () => {
    const service = new WhalePetService()
    // Default yaw is 0 (facing left), so the mouth anchor sits on the left.
    service.playEffect('bubble')

    const bubble = service.getSnapshot().effects.find(effect => effect.kind === 'bubble')
    expect(bubble?.origin?.x).toBeCloseTo(34, 5)
    expect(bubble?.origin?.y).toBe(70)

    service.dispose()
  })

  it('cycles click recaps through recent events and the name entry', () => {
    const service = new WhalePetService()
    service.pushRecap('bash 失败（exit 2）')
    service.pushRecap('goal 达成 🎉')

    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('bash 失败（exit 2）')
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('goal 达成 🎉')
    // The cycle wraps back to the name/days entry.
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toContain('我是')
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('bash 失败（exit 2）')

    service.dispose()
  })

  it('shows the name entry when no events were recorded yet', () => {
    const service = new WhalePetService()
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toContain('今天第一次见面')
    service.dispose()
  })

  it('dedupes consecutive identical recap events', () => {
    const service = new WhalePetService()
    service.pushRecap('同一个事件')
    service.pushRecap('同一个事件')

    service.nextRecap()
    service.nextRecap()
    // Pool is [name, 同一个事件]; the second click wraps to the name entry.
    expect(service.getSnapshot().recap?.text).toContain('我是')
    service.dispose()
  })

  it('expires the recap bubble after its TTL', () => {
    vi.useFakeTimers()
    const service = new WhalePetService()
    service.pushRecap('事件')
    service.nextRecap()
    expect(service.getSnapshot().recap?.text).toBe('事件')

    vi.advanceTimersByTime(3_300)
    expect(service.getSnapshot().recap).toBeNull()

    service.dispose()
    vi.useRealTimers()
  })

  it('keeps dripping sweat drops through the whole error window', () => {
    vi.useFakeTimers()
    const service = new WhalePetService()
    service.playErrorReaction(Date.now() + 3_000)
    const sweatCount = (): number =>
      service.getSnapshot().effects.filter(effect => effect.kind === 'sweat').length

    expect(sweatCount()).toBe(1)
    // A fresh drop lands every 1.4s while the first is still visible.
    vi.advanceTimersByTime(1_400)
    expect(sweatCount()).toBe(2)
    vi.advanceTimersByTime(1_400)
    expect(sweatCount()).toBeGreaterThanOrEqual(2)
    // Still visibly sweating inside the window…
    vi.advanceTimersByTime(1_500)
    expect(sweatCount()).toBeGreaterThanOrEqual(1)
    // …and everything clears after the window and the last TTL expire.
    vi.advanceTimersByTime(2_500)
    expect(sweatCount()).toBe(0)

    service.dispose()
    vi.useRealTimers()
  })

  it('persists name, hidden flag and snap preference across reloads', () => {
    const storage = new FakeStorage()
    const service = new WhalePetService(storage)
    service.setName('小蓝')
    expect(service.getSnapshot().name).toBe('小蓝')
    expect(service.toggleHidden()).toBe(true)
    expect(service.getSnapshot().hidden).toBe(true)
    service.setSnapToCorner(false)
    expect(service.getSnapshot().snapToCorner).toBe(false)
    service.dispose()

    const reloaded = new WhalePetService(storage)
    expect(reloaded.getSnapshot().name).toBe('小蓝')
    expect(reloaded.getSnapshot().hidden).toBe(true)
    expect(reloaded.getSnapshot().snapToCorner).toBe(false)
    reloaded.dispose()
  })

  it('persists the drag position rounded to whole pixels', () => {
    const storage = new FakeStorage()
    const service = new WhalePetService(storage)
    service.persistPosition(123.6, 456.2)
    service.dispose()

    const state = loadWhalePetState(storage)
    expect(state.x).toBe(124)
    expect(state.y).toBe(456)
  })

  it('greets at most once per local day', () => {
    const storage = new FakeStorage()
    const service = new WhalePetService(storage)
    const now = new Date(2026, 3, 7, 9, 0, 0).getTime()
    expect(service.greetOnceToday(now)).toBe(true)
    expect(service.getSnapshot().recap?.text).toContain('今天也在')
    expect(service.greetOnceToday(now + 60_000)).toBe(false)
    service.dispose()

    const reloaded = new WhalePetService(storage)
    expect(reloaded.greetOnceToday(now)).toBe(false)
    expect(reloaded.greetOnceToday(now + 86_400_000)).toBe(true)
    reloaded.dispose()
  })

  it('ignores empty renames and keeps the previous name', () => {
    const service = new WhalePetService()
    service.setName('   ')
    expect(service.getSnapshot().name).toBe('鲸鲸')
    service.dispose()
  })

  it('classifies forceful and prolonged drags without treating holds or cancellations as dizzy', () => {
    expect(shouldEnterDizzy({ durationMs: 700, distance: 430, averageSpeed: 614, cancelled: false })).toBe(true)
    expect(shouldEnterDizzy({ durationMs: 4_600, distance: 30, averageSpeed: 6.5, cancelled: false })).toBe(true)
    expect(shouldEnterDizzy({ durationMs: 8_000, distance: 0, averageSpeed: 0, cancelled: false })).toBe(false)
    expect(shouldEnterDizzy({ durationMs: 700, distance: 430, averageSpeed: 614, cancelled: true })).toBe(false)
    expect(shouldEnterDizzy({ durationMs: 2_000, distance: 200, averageSpeed: 100, cancelled: false })).toBe(false)
  })

  it('restores the latest session mood after dizziness expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T09:00:00Z'))
    const service = new WhalePetService()
    service.setActivity({ mood: 'working', intensity: 0.7 })
    service.enterDizzy()
    expect(service.getSnapshot().activity.mood).toBe('dizzy')

    service.setActivity({ mood: 'focused', intensity: 0.9 })
    vi.advanceTimersByTime(DIZZY_DURATION_MS)
    expect(service.getSnapshot().activity).toEqual({ mood: 'focused', intensity: 0.9 })

    service.dispose()
    vi.useRealTimers()
  })

  it('refreshes dizziness without letting an older timer clear the new state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T09:00:00Z'))
    const service = new WhalePetService()
    service.enterDizzy()
    vi.advanceTimersByTime(2_000)
    service.enterDizzy()

    vi.advanceTimersByTime(2_100)
    expect(service.getSnapshot().activity.mood).toBe('dizzy')
    vi.advanceTimersByTime(1_900)
    expect(service.getSnapshot().activity.mood).toBe('idle')

    service.dispose()
    vi.useRealTimers()
  })

  it('does not clear a newer dizzy or error override as if it were chat thinking', () => {
    const service = new WhalePetService()
    service.setExternalMood('thinking', Date.now() + 30_000)
    service.enterDizzy()
    service.clearExternalMood('thinking')
    expect(service.getSnapshot().activity.mood).toBe('dizzy')

    service.setExternalMood('error', Date.now() + 3_000)
    service.clearExternalMood('dizzy')
    expect(service.getSnapshot().activity.mood).toBe('error')
    service.dispose()
  })
})

describe('WhalePetService.handleZoneClick', () => {
  const motionOf = (service: WhalePetService): WhaleMotionController =>
    (service as unknown as { controller: { motionController: WhaleMotionController } }).controller.motionController

  it('blows a bubble on a fin click', () => {
    const service = new WhalePetService()
    expect(service.handleZoneClick('fin')).toBe(true)
    expect(service.getSnapshot().effects.some(effect => effect.kind === 'bubble')).toBe(true)
    service.dispose()
  })

  it('starts a patrol with a heart on a tail click', () => {
    const service = new WhalePetService()
    expect(service.handleZoneClick('tail')).toBe(true)
    const snapshot = service.getSnapshot()
    expect(snapshot.effects.some(effect => effect.kind === 'heart')).toBe(true)
    expect(snapshot.effects.some(effect => effect.kind === 'bubble')).toBe(false)
    // The next motion frame is already in patrol mode (1), not a loop.
    expect(motionOf(service).step(1 / 60).mode).toBe(1)
    service.dispose()
  })

  it('lets body clicks fall through to the view without extra effects', () => {
    const service = new WhalePetService()
    expect(service.handleZoneClick('body')).toBe(false)
    expect(service.getSnapshot().effects).toHaveLength(0)
    service.dispose()
  })

  it('starts an immediate patrol on a dorsal click', () => {
    const service = new WhalePetService()
    expect(() => service.handleZoneClick('dorsal')).not.toThrow()
    // Patrol mode (1) is already active on the next motion frame.
    expect(motionOf(service).step(1 / 60).mode).toBe(1)
    service.dispose()
  })

  it('rejects zone clicks after a real drag', () => {
    const service = new WhalePetService()
    const motion = motionOf(service)
    motion.beginDrag(100, 100)
    motion.pointerMove(60, 100)
    expect(service.handleZoneClick('fin')).toBe(false)
    expect(service.getSnapshot().effects).toHaveLength(0)
    service.dispose()
  })

  it('consumes all pointer-driven interactions while dizzy', () => {
    const service = new WhalePetService()
    const motion = motionOf(service)
    service.setActivity({ mood: 'focused', intensity: 0.8 })
    service.enterDizzy()

    service.wake()
    service.setHover(true)
    service.beginDrag(100, 100, 1_000)
    expect(service.handleZoneClick('tail')).toBe(true)

    const frame = motion.step(1 / 60)
    expect(service.getSnapshot().activity.mood).toBe('dizzy')
    expect(service.getSnapshot().effects).toHaveLength(0)
    expect(frame.dragging).toBe(false)
    expect(frame.hover).toBe(false)
    expect(frame.mode).toBe(0)
    service.dispose()
  })
})
