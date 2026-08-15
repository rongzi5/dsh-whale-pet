import { describe, expect, it } from 'vitest'
import { PET_WIDTH, WhaleMotionController } from '../src/client/motion.ts'

const fixedRandom = (): number => 0

function dragLeft(controller: WhaleMotionController, distance: number): number {
  const start = controller.step(1 / 60)
  const pointerX = start.x + 160
  const pointerY = start.y + 120
  controller.beginDrag(pointerX, pointerY)
  controller.pointerMove(pointerX - distance, pointerY)
  return start.x - distance
}

describe('WhaleMotionController', () => {
  it('follows a drag target monotonically without spring overshoot', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    const targetX = dragLeft(motion, 220)
    let previousX = Number.POSITIVE_INFINITY

    for (let frame = 0; frame < 120; frame += 1) {
      const view = motion.step(1 / 60)
      expect(view.x).toBeLessThanOrEqual(previousX)
      expect(view.x).toBeGreaterThanOrEqual(targetX)
      previousX = view.x
    }

    expect(previousX).toBeCloseTo(targetX, 5)
  })

  it('lands at the same drag position at 60 Hz and 120 Hz', () => {
    const sixty = new WhaleMotionController(1280, 720, fixedRandom)
    const oneTwenty = new WhaleMotionController(1280, 720, fixedRandom)
    dragLeft(sixty, 180)
    dragLeft(oneTwenty, 180)

    let frame60 = sixty.step(1 / 60)
    let frame120 = oneTwenty.step(1 / 120)
    for (let index = 1; index < 30; index += 1) frame60 = sixty.step(1 / 60)
    for (let index = 1; index < 60; index += 1) frame120 = oneTwenty.step(1 / 120)

    expect(frame60.x).toBeCloseTo(frame120.x, 2)
    expect(frame60.y).toBeCloseTo(frame120.y, 5)
  })

  it('settles release inertia to a finite idle pose inside the viewport', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    dragLeft(motion, 240)
    for (let frame = 0; frame < 8; frame += 1) motion.step(1 / 60)
    expect(motion.releaseDrag()).toBe(true)

    let view = motion.step(1 / 60)
    for (let frame = 0; frame < 180; frame += 1) view = motion.step(1 / 60)

    expect(Number.isFinite(view.x)).toBe(true)
    expect(Number.isFinite(view.y)).toBe(true)
    expect(view.x).toBeGreaterThanOrEqual(14)
    expect(view.x).toBeLessThanOrEqual(1280 - PET_WIDTH - 14)
    expect(view.dragging).toBe(false)
    expect(view.speed).toBeLessThan(0.001)
  })

  it('keeps automatic patrol dormant while the pointer is hovering', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    motion.setHover(true)
    let view = motion.step(0.04)
    for (let frame = 0; frame < 2500; frame += 1) view = motion.step(0.04)

    expect(view.mode).toBe(0)
    expect(view.speed).toBeLessThan(0.001)
  })

  it('waits roughly a minute before the first edge patrol', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    let view = motion.step(0.04)
    for (let frame = 0; frame < 1374; frame += 1) {
      view = motion.step(0.04)
      expect(view.mode).not.toBe(1)
    }
    for (let frame = 0; frame < 5; frame += 1) view = motion.step(0.04)
    expect(view.mode).toBe(1)
  })

  it('runs a wide 360-degree celebration loop across the viewport', () => {
    const motion = new WhaleMotionController(1440, 900, fixedRandom)
    motion.step(1 / 60)
    motion.celebrate()

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let sawPatrolMode = false

    for (let frame = 0; frame < 520; frame += 1) {
      const view = motion.step(1 / 60)
      minX = Math.min(minX, view.x)
      maxX = Math.max(maxX, view.x)
      minY = Math.min(minY, view.y)
      maxY = Math.max(maxY, view.y)
      if (view.mode === 1) sawPatrolMode = true
    }

    expect(sawPatrolMode).toBe(true)
    expect(maxX - minX).toBeGreaterThan(700)
    expect(maxY - minY).toBeGreaterThan(350)
    expect(minX).toBeGreaterThanOrEqual(14)
    expect(minY).toBeGreaterThanOrEqual(24)
  })
})
