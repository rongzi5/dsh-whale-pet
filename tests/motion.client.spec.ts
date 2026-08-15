import { describe, expect, it } from 'vitest'
import { PET_HEIGHT, PET_WIDTH, WhaleMotionController } from '../src/client/motion.ts'

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

    // At entry the model must face the ellipse tangent, not the radius.
    const first = motion.step(1 / 60)
    const startAngle = Math.atan2(644 - (450 - PET_HEIGHT * 0.5), 1096 - (720 - PET_WIDTH * 0.5))
    expect(first.yaw).toBeCloseTo(Math.PI / 2 - startAngle, 3)

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let minYaw = Number.POSITIVE_INFINITY
    let maxYaw = Number.NEGATIVE_INFINITY
    let minScale = Number.POSITIVE_INFINITY
    let maxScale = Number.NEGATIVE_INFINITY
    let sawPatrolMode = false
    let edgeGlideY = 0

    for (let frame = 0; frame < 620; frame += 1) {
      const view = motion.step(1 / 60)
      minX = Math.min(minX, view.x)
      maxX = Math.max(maxX, view.x)
      minY = Math.min(minY, view.y)
      maxY = Math.max(maxY, view.y)
      minYaw = Math.min(minYaw, view.yaw)
      maxYaw = Math.max(maxYaw, view.yaw)
      minScale = Math.min(minScale, view.scale)
      maxScale = Math.max(maxScale, view.scale)
      if (view.mode === 1) {
        sawPatrolMode = true
        edgeGlideY = view.y
      }
      if (frame === 619) {
        // Celebration must finish resting on the nearest horizontal edge.
        expect(view.x).toBeCloseTo(1106, 1)
        expect(view.y).toBeCloseTo(edgeGlideY, 1)
      }
    }

    expect(sawPatrolMode).toBe(true)
    expect(maxX - minX).toBeGreaterThan(700)
    expect(maxY - minY).toBeGreaterThan(350)
    expect(minX).toBeGreaterThanOrEqual(14)
    expect(minY).toBeGreaterThanOrEqual(24)
    // The model yaw unwinds through a full 2π instead of flipping left/right.
    expect(maxYaw - minYaw).toBeGreaterThan(5.5)
    // Near (bottom) is larger than far (top) for screen-space depth.
    expect(maxScale - minScale).toBeGreaterThan(0.1)
  })

  it('keeps active patrols near an edge with slight lateral drift', () => {
    const motion = new WhaleMotionController(1440, 900, fixedRandom)
    motion.setActivity({ mood: 'thinking', intensity: 0.7 })
    motion.step(1 / 60)
    motion.patrolNow()

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let frame = 0; frame < 400; frame += 1) {
      const view = motion.step(1 / 60)
      minX = Math.min(minX, view.x)
      maxX = Math.max(maxX, view.x)
      minY = Math.min(minY, view.y)
      maxY = Math.max(maxY, view.y)
    }

    // The path stays near a boundary instead of cutting across the viewport.
    expect(maxX - minX).toBeGreaterThan(40)
    expect(maxY - minY).toBeLessThan(180)
    expect(minX).toBeGreaterThanOrEqual(14)
    expect(minY).toBeGreaterThanOrEqual(24)
  })

  it('restores a persisted position clamped to the viewport', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    motion.restorePosition(40, 40)
    let view = motion.step(1 / 60)
    expect(view.x).toBe(40)
    expect(view.y).toBe(40)

    motion.restorePosition(-50, 10_000)
    view = motion.step(1 / 60)
    expect(view.x).toBe(14)
    expect(view.y).toBe(720 - PET_HEIGHT - 14)
  })

  it('glides released drags to the nearest corner when snapping is enabled', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    motion.restorePosition(60, 40)
    motion.step(1 / 60)
    motion.beginDrag(220, 160)
    motion.pointerMove(20, 160)
    expect(motion.releaseDrag()).toBe(true)

    let view = motion.step(1 / 60)
    for (let frame = 0; frame < 240; frame += 1) view = motion.step(1 / 60)

    // (60, 40) is closest to the top-left corner.
    expect(view.x).toBeCloseTo(14, 1)
    expect(view.y).toBeCloseTo(24, 1)
    expect(view.dragging).toBe(false)
  })

  it('keeps click-like releases in place when corner snapping is enabled', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    motion.restorePosition(600, 300)
    motion.step(1 / 60)
    motion.beginDrag(760, 420)
    motion.pointerMove(757, 420)
    expect(motion.releaseDrag()).toBe(true)

    let view = motion.step(1 / 60)
    for (let frame = 0; frame < 120; frame += 1) view = motion.step(1 / 60)

    expect(view.x).toBeCloseTo(600, 0)
    expect(view.y).toBeCloseTo(300, 0)
  })

  it('paces the listening mood faster than idle but without active patrols', () => {
    const motion = new WhaleMotionController(1280, 720, fixedRandom)
    motion.setActivity({ mood: 'listening', intensity: 0.6 })
    // One warm-up step already consumed one clock frame.
    let view = motion.step(0.04)

    // Initial patrol clock is 55s; listening pace (1.6) reaches zero on
    // frame 860, whereas plain idle (pace 1) would need 1375 frames.
    for (let frame = 0; frame < 858; frame += 1) view = motion.step(0.04)
    expect(view.mode).toBe(0)
    view = motion.step(0.04)
    expect(view.mode).toBe(1)
  })
})
