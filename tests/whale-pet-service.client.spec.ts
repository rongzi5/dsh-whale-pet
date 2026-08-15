import { describe, expect, it, vi } from 'vitest'
import { loadWhalePetState, type StorageLike } from '../src/client/persistence.ts'
import { WhalePetService } from '../src/client/runtime/whale-pet-service.ts'

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
    service.playErrorReaction(Date.now() + 5_000)
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

  it('ignores empty renames and keeps the previous name', () => {
    const service = new WhalePetService()
    service.setName('   ')
    expect(service.getSnapshot().name).toBe('鲸鲸')
    service.dispose()
  })
})
