// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhaleMotionController } from '../src/client/motion.ts'
import { WhalePetController } from '../src/client/runtime/whale-pet-controller.ts'
import { WhalePetService } from '../src/client/runtime/whale-pet-service.ts'
import type { WhaleScene } from '../src/client/whale/scene.ts'

/**
 * jsdom has no WebGL, so the real `createWhaleScene` always throws and no
 * transform is ever written. These tests inject a no-op scene factory and a
 * manual animation-frame pump, which lets them assert the one thing the pure
 * unit tests cannot: that the size reaches the rendered DOM transform and
 * nothing else.
 */

const fixedRandom = (): number => 0

/** The scene handle contract, with no GPU work behind it. */
const fakeScene = (): WhaleScene => ({
  resize: (): void => {},
  render: (): void => {},
  dispose: (): void => {},
})

interface Mounted {
  service: WhalePetService
  host: HTMLDivElement
  pet: HTMLDivElement
}

const mounted: Mounted[] = []

function mountPet(size?: number): Mounted {
  const host = document.createElement('div')
  const pet = document.createElement('div')
  const canvas = document.createElement('canvas')
  const shadow = document.createElement('span')
  pet.append(shadow, canvas)
  host.append(pet)
  document.body.append(host)

  const controller = new WhalePetController(
    new WhaleMotionController(1280, 720, fixedRandom),
    fakeScene,
  )
  const service = new WhalePetService(null, controller)
  expect(service.mount({ root: host, pet, canvas, shadow }, { onError: () => {} })).toBe(true)
  if (size !== undefined) service.setSize(size)

  const entry = { service, host, pet }
  mounted.push(entry)
  return entry
}

/** Run real scheduler frames against a manual clock (no wall-clock flakiness). */
let frameQueue: FrameRequestCallback[] = []
let clock = 0

function useManualFrames(): void {
  frameQueue = []
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameQueue.push(callback)
    return frameQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

function pumpFrames(count: number): void {
  for (let frame = 0; frame < count; frame += 1) {
    clock += 16
    for (const callback of frameQueue.splice(0)) callback(clock)
  }
}

const translateOf = (transform: string): string | undefined =>
  /translate3d\(([^)]+)\)/.exec(transform)?.[1]

const scaleOf = (transform: string): string | undefined =>
  /scale\(([^)]+)\)/.exec(transform)?.[1]

describe('WhalePetController size rendering', () => {
  it('writes the size into the transform scale without moving the pet', () => {
    useManualFrames()
    const authored = mountPet()
    const enlarged = mountPet()
    pumpFrames(3)
    const authoredTransform = authored.pet.style.transform

    // The mount really rendered, so the comparisons below cannot pass vacuously.
    expect(authoredTransform).toMatch(/^translate3d\(.+\) rotate\(.+\) scale\(1\.000\)$/)
    expect(translateOf(authoredTransform)).toMatch(/\d/)

    // Resizing a live pet only rescales the box: the translate is untouched,
    // and the two pets were mounted at the same rest position.
    enlarged.service.setSize(1.5)
    pumpFrames(1)
    const enlargedTransform = enlarged.pet.style.transform
    expect(scaleOf(enlargedTransform)).toBe('1.500')
    expect(translateOf(enlargedTransform)).toBe(translateOf(authoredTransform))
  })

  it('renders a persisted size from the first frame', () => {
    useManualFrames()
    const small = mountPet(0.5)
    const authored = mountPet()
    pumpFrames(2)

    expect(scaleOf(small.pet.style.transform)).toBe('0.500')
    expect(scaleOf(authored.pet.style.transform)).toBe('1.000')
    // Only the scale differs: the anchor point on the path is identical.
    expect(translateOf(small.pet.style.transform)).toBe(translateOf(authored.pet.style.transform))
    expect(translateOf(small.pet.style.transform)).toMatch(/\d/)
  })

  it('keeps a patrolling pet on the same path at any size', () => {
    useManualFrames()
    const authored = mountPet()
    const enlarged = mountPet()
    enlarged.service.setSize(1.5)
    pumpFrames(2)
    const restTranslate = translateOf(authored.pet.style.transform)

    // Start the same patrol on both. The controllers share a deterministic
    // random source, so any size influence on the path would drift them apart.
    for (const entry of [authored, enlarged]) {
      expect(entry.service.handleZoneClick('dorsal')).toBe(true)
    }

    for (let frame = 0; frame < 40; frame += 1) {
      pumpFrames(1)
      expect(translateOf(enlarged.pet.style.transform)).toBe(translateOf(authored.pet.style.transform))
    }

    // The patrol really moved the pet, so the equality above is not vacuous,
    // and the size still only shows up in the scale.
    expect(translateOf(authored.pet.style.transform)).not.toBe(restTranslate)
    expect(scaleOf(enlarged.pet.style.transform)).toBe('1.500')
  })
})

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.service.dispose()
    entry.host.remove()
  }
  frameQueue = []
  vi.unstubAllGlobals()
})
