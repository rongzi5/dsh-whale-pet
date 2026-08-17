import { describe, expect, it } from 'vitest'
import {
  browserStorage,
  daysSince,
  localDayKey,
  loadWhalePetState,
  saveWhalePetState,
  WHALE_PET_DEFAULTS,
  type StorageLike,
} from '../src/client/persistence.ts'

class FakeStorage implements StorageLike {
  private readonly map = new Map<string, string>()

  public getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  public setItem(key: string, value: string): void {
    this.map.set(key, value)
  }

  public raw(): string | null {
    return this.map.get('dsh.whale-pet.v1') ?? null
  }
}

describe('whale pet persistence', () => {
  it('returns defaults for an empty storage', () => {
    expect(loadWhalePetState(new FakeStorage())).toEqual({ ...WHALE_PET_DEFAULTS })
  })

  it('round-trips a partial patch over the defaults', () => {
    const storage = new FakeStorage()
    saveWhalePetState(storage, { name: '小蓝', snapToCorner: false })
    const loaded = loadWhalePetState(storage)
    expect(loaded.name).toBe('小蓝')
    expect(loaded.snapToCorner).toBe(false)
    expect(loaded.hidden).toBe(WHALE_PET_DEFAULTS.hidden)
    expect(loaded.x).toBeNull()
  })

  it('keeps position and toggles across separate saves', () => {
    const storage = new FakeStorage()
    saveWhalePetState(storage, { x: 120, y: 300 })
    saveWhalePetState(storage, { hidden: true })
    const loaded = loadWhalePetState(storage)
    expect(loaded.x).toBe(120)
    expect(loaded.y).toBe(300)
    expect(loaded.hidden).toBe(true)
  })

  it('falls back to defaults for corrupted JSON', () => {
    const storage = new FakeStorage()
    storage.setItem('dsh.whale-pet.v1', '{not json')
    expect(loadWhalePetState(storage)).toEqual({ ...WHALE_PET_DEFAULTS })
  })

  it('falls back to defaults for non-object payloads', () => {
    for (const payload of ['"string"', '42', 'null', 'true', '[]']) {
      const storage = new FakeStorage()
      storage.setItem('dsh.whale-pet.v1', payload)
      expect(loadWhalePetState(storage)).toEqual({ ...WHALE_PET_DEFAULTS })
    }
  })

  it('validates field types instead of trusting the payload', () => {
    const storage = new FakeStorage()
    storage.setItem('dsh.whale-pet.v1', JSON.stringify({
      name: 42,
      hidden: 'yes',
      snapToCorner: 1,
      x: 'far',
      y: Number.NaN,
      since: 123,
    }))
    expect(loadWhalePetState(storage)).toEqual({ ...WHALE_PET_DEFAULTS })
  })

  it('trims and caps the persisted name', () => {
    const storage = new FakeStorage()
    saveWhalePetState(storage, { name: '  蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝蓝  ' })
    expect(loadWhalePetState(storage).name.length).toBeLessThanOrEqual(32)
    expect(loadWhalePetState(storage).name).toBe(loadWhalePetState(storage).name.trim())
  })

  it('degrades gracefully when storage is unavailable', () => {
    const state = loadWhalePetState(null)
    expect(state).toEqual({ ...WHALE_PET_DEFAULTS })
    expect(() => saveWhalePetState(null, { name: 'x' })).not.toThrow()
  })

  it('returns null storage from browserStorage in a non-browser environment', () => {
    expect(browserStorage()).toBeNull()
  })

  it('computes whole days since the first run', () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0)
    expect(daysSince('', now)).toBe(0)
    expect(daysSince('not-a-date', now)).toBe(0)
    expect(daysSince(new Date(now - 1000).toISOString(), now)).toBe(0)
    expect(daysSince(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe(2)
    expect(daysSince(new Date(now + 86_400_000).toISOString(), now)).toBe(0)
  })

  it('formats the local calendar day for greeting rate limits', () => {
    const now = new Date(2026, 3, 7, 9, 30, 0).getTime()
    expect(localDayKey(now)).toBe('2026-04-07')
  })
})
