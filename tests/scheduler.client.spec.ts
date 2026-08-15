import { describe, expect, it } from 'vitest'
import { WhaleRenderScheduler, type WhaleFrameHost, type WhaleTick } from '../src/client/runtime/scheduler.ts'

interface FakeHost extends WhaleFrameHost {
  frames: Map<number, FrameRequestCallback>
  time: number
  next: number
  tickNext(): boolean
}

function createFakeHost(): FakeHost {
  const host: FakeHost = {
    frames: new Map(),
    time: 0,
    next: 1,
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const handle = host.next
      host.next += 1
      host.frames.set(handle, callback)
      return handle
    },
    cancelAnimationFrame(handle: number): void {
      host.frames.delete(handle)
    },
    tickNext(): boolean {
      const handle = host.frames.keys().next().value as number | undefined
      if (handle === undefined) return false
      const callback = host.frames.get(handle)
      host.frames.delete(handle)
      callback?.(host.time)
      return true
    },
  }
  return host
}

function collect(scheduler: WhaleRenderScheduler): WhaleTick[] {
  const ticks: WhaleTick[] = []
  scheduler.start(tick => ticks.push(tick))
  return ticks
}

describe('WhaleRenderScheduler', () => {
  it('advances the first frame by a fixed 1/60s regardless of the timestamp', () => {
    const host = createFakeHost()
    host.time = 999
    const scheduler = new WhaleRenderScheduler(host)
    const ticks = collect(scheduler)

    host.tickNext()

    expect(ticks[0]).toEqual({ deltaSeconds: 1 / 60, elapsedSeconds: 1 / 60 })
  })

  it('clamps measured deltas into the original 4ms..40ms window', () => {
    const host = createFakeHost()
    host.time = 1000
    const scheduler = new WhaleRenderScheduler(host)
    const ticks = collect(scheduler)

    host.tickNext()
    host.time = 1001 // 1ms after the first frame
    host.tickNext()
    host.time = 2001 // 1s after the previous frame
    host.tickNext()

    expect(ticks[1]?.deltaSeconds).toBe(0.004)
    expect(ticks[2]?.deltaSeconds).toBe(0.04)
    expect(ticks[2]?.elapsedSeconds).toBeCloseTo(1 / 60 + 0.004 + 0.04, 10)
  })

  it('stops scheduling further frames when a tick calls stop()', () => {
    const host = createFakeHost()
    host.time = 1000
    const scheduler = new WhaleRenderScheduler(host)
    scheduler.start((tick) => {
      if (tick.deltaSeconds !== 1 / 60) scheduler.stop()
    })

    host.tickNext()
    host.time = 1016
    host.tickNext()

    expect(scheduler.active).toBe(false)
    expect(host.frames.size).toBe(0)
  })

  it('cancels the pending frame on stop and resets the clock on restart', () => {
    const host = createFakeHost()
    const scheduler = new WhaleRenderScheduler(host)
    const ticks = collect(scheduler)

    host.tickNext()
    scheduler.stop()
    expect(host.frames.size).toBe(0)

    scheduler.start(tick => ticks.push(tick))
    host.time = 5000
    host.tickNext()

    expect(ticks[1]).toEqual({ deltaSeconds: 1 / 60, elapsedSeconds: 1 / 60 })
  })

  it('is a no-op to stop an idle scheduler', () => {
    const host = createFakeHost()
    const scheduler = new WhaleRenderScheduler(host)
    scheduler.stop()
    expect(scheduler.active).toBe(false)
    expect(host.frames.size).toBe(0)
  })
})
