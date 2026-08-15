/**
 * whale-scene.ts
 *
 * Procedural killer-whale ("DeepSeek logo" whale) 3D scene for the ui-whale-pet
 * browser plugin. The geometry, shading and animation are ported faithfully
 * from `deepseek_html_20260814_79b0ff.html` (original demo) and the corrected
 * runtime `vendor/whale-pet-runtime.html`:
 *
 *  - swept body built from the logo SVG contour (Catmull-Rom resampled)
 *  - blue/white body mask via a half-float mid/radius lookup texture
 *  - brow / eye patches mapped onto the body surface (mirrored pair)
 *  - V-shaped tail fluke (mirrored leaf), dorsal fin and pectoral fins
 *  - Box3-centered model inside a `petPivot` group
 *  - camera at (0, 0.8, 11.8) with a transparent WebGL clear
 *
 * The scene is fully driven from the outside: the parent owns the frame loop,
 * input and resizing. `createWhaleScene` never attaches event listeners, never
 * calls requestAnimationFrame and never schedules timers. The swim and motion
 * phases are *integrated* from `deltaSeconds` (never `elapsed * time-varying
 * speed`); only fixed-frequency effects (float, blink, happy pulse) use
 * elapsed time, exactly like the runtime. External pose/shape inputs are
 * low-pass filtered with the runtime's rates.
 *
 * Array reads go through `checkedAt`, which bounds-checks every index and
 * throws loudly on an out-of-range access, so the strict
 * `noUncheckedIndexedAccess` build stays clean without non-null assertions.
 */

import * as THREE from 'three'

import type { WhaleActivity } from './activity.ts'

// @types/three@0.147 does not model Material.extensions although three r147
// initializes it to `{}`; augment so the shader's derivatives flag type-checks.
declare module 'three' {
  interface Material {
    extensions: {
      derivatives?: boolean | undefined
      fragDepth?: boolean | undefined
      drawBuffers?: boolean | undefined
      shaderTextureLOD?: boolean | undefined
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Per-frame external pet state supplied by the parent. */
export interface WhaleExternalState {
  /** Pointer is hovering over the pet (also boosts swim frequency). */
  hover: boolean
  /** Pointer is dragging the pet (squash/stretch deformation). */
  dragging: boolean
  /** Pet mode: 0 idle, 1 patrol, 3 follow (as in the corrected runtime). */
  mode: number
  /** Normalized movement speed, 0..1 (drives swim frequency + motion energy). */
  speed: number
  /** Normalized horizontal motion, -1..1 (steers tail + fins). */
  motionX: number
  /** Normalized vertical motion, -1..1 (pitches tail + fins). */
  motionY: number
  /** Target yaw (radians) applied to the pet pivot. */
  yaw: number
  /** Target pitch (radians) applied to the pet pivot. */
  pitch: number
  /** Target roll (radians) applied to the pet pivot. */
  roll: number
  /** Session-driven mood, supplied by the runtime service. */
  activity: WhaleActivity
}

/** Handle returned by {@link createWhaleScene}; the parent drives everything. */
export interface WhaleScene {
  /** Update drawing buffer, pixel ratio and camera aspect. */
  resize(width: number, height: number, dpr: number): void
  /** Advance the animation by deltaSeconds using the given external state. */
  render(deltaSeconds: number, elapsedSeconds: number, external: WhaleExternalState): void
  /** Release all GPU resources (geometries, materials, textures, renderer). */
  dispose(): void
}

// ---------------------------------------------------------------------------
// Constants (ported verbatim from the source CONFIG)
// ---------------------------------------------------------------------------

const CFG = {
  // swept body
  SWEPT_SLICES: 60,
  SWEPT_RINGS: 48,
  BODY_TARGET_HEIGHT: 3.5,
  // tail fluke (V-shaped fork, horizontal spread)
  TAIL_FORK_SCALE: 0.177,
  TAIL_THICKNESS: 0.06,
  TAIL_OPEN_ANGLE_DEG: 76.95,
  TAIL_NOTCH_DX: 0.3,
  TAIL_NOTCH_DY: 0.5,
  TAIL_TILT_DEG: 50,
  // dorsal fin
  DORSAL_START_FRAC: 0.331,
  DORSAL_END_FRAC: 0.559,
  DORSAL_SAMPLES: 40,
  DORSAL_THICKNESS: 0.06,
  DORSAL_HEIGHT_SCALE: 0.3186,
  DORSAL_SINK: 0.0,
  // pectoral fins
  PEC_START_FRAC: 0.38,
  PEC_END_FRAC: 0.48,
  PEC_SPAN: 0.924,
  PEC_SWEEP: 0.33,
  PEC_THICKNESS: 0.05,
  PEC_ANGLE_DEG: 30,
  PEC_RADIAN: 130,
  PEC_SINK: 0.0,
  PEC_OUTWARD_OFFSET: -0.025,
  PEC_BACKWARD_OFFSET: 0.0,
  // eye patch / eyes
  BROW_SCALE: 0.65,
  BROW_OFFSET_X: -35.4,
  BROW_OFFSET_Y: 6.0,
  BROW_LIFT: 0.9,
  EYE_OFFSET_Y: 10.5,
  EYE_RADIUS: 2.8,
  EYE_CIRCLE_SEGMENTS: 32,
  // colors
  COLOR_BODY_BLUE: 0x4d6bfe,
  COLOR_WHITE: 0xffffff,
  // animation
  SWIM_SPEED: 0.9,
  BODY_SWAY_AMPLITUDE: 0.04,
  TAIL_SWAY_AMPLITUDE: 0.08,
  TAIL_PITCH_AMPLITUDE: 0.15,
  PEC_FLAP_AMPLITUDE: 0.25,
  PEC_FLAP_PHASE: 0.6,
  PITCH_AMPLITUDE: 0.015,
  ROLL_AMPLITUDE: 0.01,
  BLINK_INTERVAL: 3.4,
  BLINK_DURATION: 0.2,
  FLOAT_AMPLITUDE: 0.06,
  FLOAT_SPEED: 1.2,
  HOVER_SWIM_BOOST: 1.2,
} as const

// --- SVG contours (body, brow, tail, dorsal, pectoral) ---
const PATH =
  'M 144.00 80.00 C 144.67 84.83, 143.00 95.34, 141.00 102.00 C 139.00 108.66, 136.50 113.84, 132.00 120.00 C 127.50 126.16, 119.66 134.34, 114.00 139.00 C 108.34 143.66, 103.49 146.17, 98.00 148.00 C 92.51 149.83, 87.83 150.83, 81.00 150.00 C 74.17 149.17, 63.83 146.66, 57.00 143.00 C 50.17 139.34, 44.50 134.16, 40.00 128.00 C 35.50 121.84, 31.83 113.16, 30.00 106.00 C 28.17 98.84, 28.17 90.99, 29.00 85.00 C 29.83 79.01, 32.17 74.50, 35.00 70.00 C 37.83 65.50, 41.67 61.00, 46.00 58.00 C 50.33 55.00, 56.01 53.00, 61.00 52.00 C 66.00 51.00, 70.51 51.00, 76.00 52.00 C 81.49 53.00, 85.34 52.34, 94.00 58.00 C 102.66 63.66, 120.84 83.50, 128.00 86.00 C 135.16 88.50, 134.34 74.00, 137.00 73.00 C 139.66 72.00, 143.33 75.17, 144.00 80.00 Z'
const BROW_PATH =
  'M 146.00 127.00 C 144.34 128.00, 138.50 129.50, 136.00 129.00 C 133.50 128.50, 131.83 126.33, 131.00 124.00 C 130.17 121.67, 131.67 117.16, 131.00 115.00 C 130.33 112.84, 128.33 111.67, 127.00 111.00 C 125.67 110.33, 124.00 111.33, 123.00 111.00 C 122.00 110.67, 121.17 109.83, 121.00 109.00 C 120.83 108.17, 120.50 106.67, 122.00 106.00 C 123.50 105.33, 127.84 104.67, 130.00 105.00 C 132.16 105.33, 133.00 106.17, 135.00 108.00 C 137.00 109.83, 140.17 113.50, 142.00 116.00 C 143.83 118.50, 145.33 121.17, 146.00 123.00 C 146.67 124.83, 147.66 126.00, 146.00 127.00 Z'
const TAIL_PATH =
  'M 17.902 4.103 L 22.379 9.998 C 22.435 9.614, 22.507 9.073, 22.499 8.762 C 22.494 8.572, 22.538 8.499, 22.755 8.477 C 23.354 8.408, 23.935 8.244, 24.469 7.950 C 26.019 7.104, 26.644 5.713, 26.791 4.047 C 26.813 3.792, 26.787 3.529, 26.517 3.395 C 26.235 3.257, 26.114 3.520, 25.949 3.653 C 25.892 3.697, 25.845 3.753, 25.797 3.805 C 25.385 4.245, 24.903 4.534, 24.274 4.500 C 23.354 4.448, 22.568 4.737, 21.873 5.441 C 21.726 4.573, 21.235 4.055, 20.489 3.723 C 20.099 3.551, 19.703 3.377, 19.430 3.002 C 19.239 2.735, 19.186 2.437, 19.091 2.143 C 19.030 1.966, 18.970 1.785, 18.766 1.754 C 18.544 1.720, 18.457 1.905, 18.370 2.061 C 18.023 2.695, 17.889 3.395, 17.902 4.103 Z'
const DORSAL_PATH =
  'M 10.436 2.993 L 13.852 4.746 C 12.758 3.684, 13.995 2.812, 14.282 2.708 C 14.581 2.600, 14.386 2.229, 13.418 2.233 C 12.450 2.237, 11.565 2.562, 10.436 2.993 Z'
const PEC_PATH =
  'M 16.747 19.267 L 20.614 19.565 C 20.093 19.673, 19.421 19.772, 18.722 19.707 C 17.815 19.630, 17.268 19.526, 16.747 19.267 Z'

// --- path anchors used by fin placement ---
const TAIL_NOTCH = { x: 21.873, y: 5.441 }
const DORSAL_BL = 10.436
const DORSAL_BR = 13.852
const PEC_BL = 16.747
const PEC_BR = 20.614
const PEC_DROP = 0.288

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

interface Pt {
  x: number
  y: number
}

interface FinPt {
  x: number
  z: number
}

/** Per-slice body profile: x stations plus mid/radius curves (unscaled). */
interface SweptData {
  xs: number[]
  mid: number[]
  rad: number[]
}

/** Low-pass filtered copy of the external state (rates from the runtime). */
interface Filters {
  speed: number
  motionX: number
  motionY: number
  patrolLevel: number
  dragLevel: number
  yaw: number
  pitch: number
  roll: number
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const clamp11 = (v: number): number => Math.min(1, Math.max(-1, v))

/**
 * Index into any array-like (plain arrays and typed arrays alike) with a loud
 * out-of-range failure. Satisfies `noUncheckedIndexedAccess` without non-null
 * assertions and surfaces a corrupt profile/fin array at the point of access
 * instead of silently producing NaN geometry.
 */
function checkedAt<T>(array: ArrayLike<T>, index: number): T {
  if (index < 0 || index >= array.length || !Number.isInteger(index)) {
    throw new RangeError(`whale scene: index ${index} outside [0, ${array.length})`)
  }
  const value = array[index]
  if (value === undefined) {
    throw new RangeError(`whale scene: element at index ${index} is undefined`)
  }
  return value
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Sample an SVG path (M/L/C commands only) densely. */
function samplePath(d: string, stepsPerSegment: number): Pt[] {
  const toks = d.match(/[MLCZ]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  let i = 0
  let x = 0
  let y = 0
  const pts: Pt[] = []
  const num = (): number => parseFloat(checkedAt(toks, i++))
  const bez = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
    const mt = 1 - t
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
  }
  while (i < toks.length) {
    const c = checkedAt(toks, i++).toUpperCase()
    if (c === 'M' || c === 'L') {
      x = num()
      y = num()
      pts.push({ x, y })
    } else if (c === 'C') {
      const c1x = num()
      const c1y = num()
      const c2x = num()
      const c2y = num()
      const ex = num()
      const ey = num()
      for (let s = 1; s <= stepsPerSegment; s++) {
        const t = s / stepsPerSegment
        pts.push({ x: bez(t, x, c1x, c2x, ex), y: bez(t, y, c1y, c2y, ey) })
      }
      x = ex
      y = ey
    }
  }
  return pts
}

/** Arc-length re-sampling with centripetal-ish Catmull-Rom interpolation. */
function catmullRomResample(points: Pt[], targetCount: number, closed: boolean): Pt[] {
  if (points.length < 2) return points.slice()
  const src = closed ? [...points, checkedAt(points, 0), checkedAt(points, 1), checkedAt(points, 2)] : points
  const arcLen: number[] = [0]
  for (let i = 1; i < src.length; i++) {
    const dx = checkedAt(src, i).x - checkedAt(src, i - 1).x
    const dy = checkedAt(src, i).y - checkedAt(src, i - 1).y
    arcLen.push(checkedAt(arcLen, i - 1) + Math.sqrt(dx * dx + dy * dy))
  }
  const totalLen = checkedAt(arcLen, arcLen.length - 1)
  const result: Pt[] = []
  for (let k = 0; k < targetCount; k++) {
    const t = (k / targetCount) * totalLen
    let seg = 0
    while (seg < arcLen.length - 2 && checkedAt(arcLen, seg + 1) < t) seg++
    const segStart = checkedAt(arcLen, seg)
    const segEnd = checkedAt(arcLen, seg + 1)
    const localT = segEnd - segStart > 0 ? (t - segStart) / (segEnd - segStart) : 0
    const p0 = checkedAt(src, Math.max(0, seg - 1))
    const p1 = checkedAt(src, seg)
    const p2 = checkedAt(src, seg + 1)
    const p3 = checkedAt(src, Math.min(src.length - 1, seg + 2))
    const tt = localT
    const tt2 = tt * tt
    const tt3 = tt2 * tt
    const x =
      0.5 *
      (2 * p1.x + (-p0.x + p2.x) * tt + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3)
    const y =
      0.5 *
      (2 * p1.y + (-p0.y + p2.y) * tt + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3)
    result.push({ x, y })
  }
  return result
}

function smoothGaussian(arr: number[], sigma: number, iterations: number): number[] {
  const len = arr.length
  const half = Math.ceil(sigma * 3)
  const kernel: number[] = []
  let sumK = 0
  for (let j = -half; j <= half; j++) {
    const val = Math.exp(-0.5 * (j / sigma) * (j / sigma))
    kernel.push(val)
    sumK += val
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = checkedAt(kernel, i) / sumK
  const work = [...arr]
  for (let iter = 0; iter < iterations; iter++) {
    const temp = [...work]
    for (let i = 0; i < len; i++) {
      let sum = 0
      for (let j = -half; j <= half; j++) {
        const idx = Math.min(len - 1, Math.max(0, i + j))
        sum += checkedAt(temp, idx) * checkedAt(kernel, j + half)
      }
      work[i] = sum
    }
  }
  return work
}

/**
 * IEEE 754 binary16 encoder, ported from three r147's `DataUtils.toHalfFloat`
 * (the `@types/three` package for r147 models `toHalfFloat` as a bare named
 * export and does not expose `THREE.DataUtils`, so we keep a local copy with
 * identical tables). Used to pack the body mid/radius profile texture.
 */
const _halfFloatViews = (() => {
  const buffer = new ArrayBuffer(4)
  const floatView = new Float32Array(buffer)
  const uint32View = new Uint32Array(buffer)
  const baseTable = new Uint32Array(512)
  const shiftTable = new Uint32Array(512)
  for (let i = 0; i < 256; ++i) {
    const e = i - 127
    if (e < -27) {
      baseTable[i] = 0x0000
      baseTable[i | 0x100] = 0x8000
      shiftTable[i] = 24
      shiftTable[i | 0x100] = 24
    } else if (e < -14) {
      baseTable[i] = 0x0400 >> (-e - 14)
      baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000
      shiftTable[i] = -e - 1
      shiftTable[i | 0x100] = -e - 1
    } else if (e <= 15) {
      baseTable[i] = (e + 15) << 10
      baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000
      shiftTable[i] = 13
      shiftTable[i | 0x100] = 13
    } else if (e < 128) {
      baseTable[i] = 0x7c00
      baseTable[i | 0x100] = 0xfc00
      shiftTable[i] = 24
      shiftTable[i | 0x100] = 24
    } else {
      baseTable[i] = 0x7c00
      baseTable[i | 0x100] = 0xfc00
      shiftTable[i] = 13
      shiftTable[i | 0x100] = 13
    }
  }
  return { floatView, uint32View, baseTable, shiftTable }
})()

function toHalfFloat(val: number): number {
  const clamped = Math.min(65504, Math.max(-65504, val))
  _halfFloatViews.floatView[0] = clamped
  const f = checkedAt(_halfFloatViews.uint32View, 0)
  const e = (f >> 23) & 0x1ff
  return checkedAt(_halfFloatViews.baseTable, e) + ((f & 0x007fffff) >> checkedAt(_halfFloatViews.shiftTable, e))
}

function removeDents(arr: number[], window: number): number[] {
  const res = [...arr]
  for (let i = 1; i < res.length - 1; i++) {
    const left = Math.max(0, i - window)
    const right = Math.min(res.length - 1, i + window)
    let minNeighbor = Infinity
    for (let j = left; j <= right; j++) {
      if (j === i) continue
      const neighbor = checkedAt(res, j)
      if (neighbor < minNeighbor) minNeighbor = neighbor
    }
    if (checkedAt(res, i) < minNeighbor) res[i] = minNeighbor
  }
  return res
}

/** Swept body result: geometry plus the unscaled per-slice profile. */
interface SweptBody {
  geometry: THREE.BufferGeometry
  profile: SweptData
}

/** Build the swept body geometry and its per-slice profile. */
function buildSwept(poly: Pt[], nSlices: number, nRings: number): SweptBody {
  let minX = 1e9
  let maxX = -1e9
  let polyMinY = Infinity
  let polyMaxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    polyMinY = Math.min(polyMinY, p.y)
    polyMaxY = Math.max(polyMaxY, p.y)
  }
  const totalX = maxX - minX
  const step = totalX / nSlices
  const polyHeight = polyMaxY - polyMinY
  const tailLiftAmount = 0.1 * polyHeight
  const xs: number[] = []
  const midRaw: number[] = []
  const radRaw: number[] = []
  let lastM = 0
  for (let s = 0; s <= nSlices; s++) {
    const x = minX + s * step
    let top = -Infinity
    let bot = Infinity
    for (let i = 0; i < poly.length; i++) {
      const a = checkedAt(poly, i)
      const b = checkedAt(poly, (i + 1) % poly.length)
      if (Math.abs(a.x - b.x) < 1e-9) continue
      if ((a.x - x) * (b.x - x) > 0) continue
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
      if (y > top) top = y
      if (y < bot) bot = y
    }
    let m: number
    let r: number
    if (isFinite(top) && isFinite(bot)) {
      m = (top + bot) / 2
      r = (top - bot) / 2
      if (r < 0) r = 0
      lastM = m
    } else {
      m = lastM
      r = 0
    }
    xs.push(x)
    midRaw.push(m)
    radRaw.push(Math.max(0, r))
  }

  // smooth profile, then taper both ends toward pointed nose/tail
  let radSmooth = smoothGaussian(radRaw, 3.0, 2)
  const midSmooth = smoothGaussian(midRaw, 2.0, 1)
  radSmooth = removeDents(radSmooth, 8)
  radSmooth = smoothGaussian(radSmooth, 1.5, 1)
  let maxIdx = 0
  let maxVal = 0
  for (let i = 0; i < radSmooth.length; i++) {
    const value = checkedAt(radSmooth, i)
    if (value > maxVal) {
      maxVal = value
      maxIdx = i
    }
  }
  for (let i = maxIdx - 1; i >= 0; i--) {
    const next = checkedAt(radSmooth, i + 1)
    if (checkedAt(radSmooth, i) > next) radSmooth[i] = next
  }
  for (let i = maxIdx + 1; i < radSmooth.length; i++) {
    const prev = checkedAt(radSmooth, i - 1)
    if (checkedAt(radSmooth, i) > prev) radSmooth[i] = prev
  }
  const tailRatio = 0.14
  const headRatio = 0.11
  const tailLen = totalX * tailRatio
  const headLen = totalX * headRatio
  const tailEnd = xs.findIndex(x => x >= minX + tailLen)
  if (tailEnd > 2) {
    const rBody = checkedAt(radSmooth, tailEnd)
    for (let i = 0; i <= tailEnd; i++) {
      const t = (checkedAt(xs, i) - minX) / tailLen
      const ease = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
      radSmooth[i] = Math.min(checkedAt(radSmooth, i), rBody * ease)
    }
  }
  const headStart = xs.findIndex(x => x >= maxX - headLen)
  if (headStart < nSlices - 2) {
    const rBody = checkedAt(radSmooth, headStart)
    for (let i = headStart; i <= nSlices; i++) {
      const t = (maxX - checkedAt(xs, i)) / headLen
      const ease = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
      radSmooth[i] = Math.min(checkedAt(radSmooth, i), rBody * ease)
    }
  }
  radSmooth[0] = 0
  radSmooth[nSlices] = 0
  radSmooth = smoothGaussian(radSmooth, 1.2, 1)
  radSmooth[0] = 0
  radSmooth[nSlices] = 0

  // lift the nose-side profile (tail lift in the source)
  const tailLiftStartFrac = 0.75
  for (let i = 0; i <= nSlices; i++) {
    const t = (checkedAt(xs, i) - minX) / totalX
    if (t > tailLiftStartFrac) {
      midSmooth[i] = checkedAt(midSmooth, i) + tailLiftAmount * smoothstep(tailLiftStartFrac, 1.0, t)
    }
  }

  const pos: number[] = []
  for (let s = 0; s <= nSlices; s++) {
    for (let k = 0; k < nRings; k++) {
      const th = (k / nRings) * Math.PI * 2
      const c = Math.cos(th)
      const sn = Math.sin(th)
      const x = checkedAt(xs, s)
      const mid = checkedAt(midSmooth, s)
      const rad = checkedAt(radSmooth, s)
      pos.push(x, mid + rad * c, rad * sn)
    }
  }
  const idx: number[] = []
  for (let s = 0; s < nSlices; s++) {
    for (let k = 0; k < nRings; k++) {
      const k2 = (k + 1) % nRings
      const a = s * nRings + k
      const b = s * nRings + k2
      const c2 = (s + 1) * nRings + k
      const d = (s + 1) * nRings + k2
      idx.push(a, d, c2, a, b, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  return { geometry: geo, profile: { xs, mid: midSmooth, rad: radSmooth } }
}

function requireBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (box === null) throw new Error('whale scene: bounding box unavailable')
  return box
}

/** Map an SVG-space point onto the swept body surface (with a lift offset). */
function mapBrowToSurface(p: Pt, body: SweptData, cx: number, cy: number): { x: number; y: number; z: number } {
  const xsArr = body.xs
  const midArr = body.mid
  const radArr = body.rad
  const px = (p.x - cx) * CFG.BROW_SCALE + CFG.BROW_OFFSET_X
  const py = -(p.y - cy) * CFG.BROW_SCALE + CFG.BROW_OFFSET_Y
  const n = xsArr.length
  let s: number
  if (px <= checkedAt(xsArr, 0)) s = 0
  else if (px >= checkedAt(xsArr, n - 1)) s = n - 1
  else {
    let i = 0
    while (i < n - 1 && checkedAt(xsArr, i + 1) < px) i++
    s = i + (px - checkedAt(xsArr, i)) / Math.max(1e-9, checkedAt(xsArr, i + 1) - checkedAt(xsArr, i))
  }
  const i0 = Math.min(Math.floor(s), n - 1)
  const i1 = Math.min(i0 + 1, n - 1)
  const t = s - i0
  const m = checkedAt(midArr, i0) * (1 - t) + checkedAt(midArr, i1) * t
  const r = Math.max(0, checkedAt(radArr, i0) * (1 - t) + checkedAt(radArr, i1) * t)
  const cosTh = r > 1e-6 ? Math.max(-1, Math.min(1, (py - m) / r)) : 1
  const sinTh = Math.sqrt(Math.max(0, 1 - cosTh * cosTh))
  const dx = Math.max(1e-9, checkedAt(xsArr, i1) - checkedAt(xsArr, i0))
  const dr = (checkedAt(radArr, i1) - checkedAt(radArr, i0)) / dx
  const dm = (checkedAt(midArr, i1) - checkedAt(midArr, i0)) / dx
  const nx = -(dr + dm * cosTh)
  const ny = cosTh
  const nz = sinTh
  const len = Math.hypot(nx, ny, nz) || 1
  return {
    x: px + (nx / len) * CFG.BROW_LIFT,
    y: m + r * cosTh + (ny / len) * CFG.BROW_LIFT,
    z: r * sinTh + (nz / len) * CFG.BROW_LIFT,
  }
}

/** Flat patch (brow or eye) triangulated in mapped space, wrapped on the surface. */
function buildSurfacePatch(points: Pt[], swept: SweptData, scale: number, cx: number, cy: number, flip: boolean): THREE.BufferGeometry {
  const contour = points.map(
    p => new THREE.Vector2((p.x - cx) * CFG.BROW_SCALE + CFG.BROW_OFFSET_X, -(p.y - cy) * CFG.BROW_SCALE + CFG.BROW_OFFSET_Y),
  )
  const tri = THREE.ShapeUtils.triangulateShape(contour, [])
  const pos: number[] = []
  const idx: number[] = []
  for (const p of points) {
    const sp = mapBrowToSurface(p, swept, cx, cy)
    pos.push(sp.x, sp.y, sp.z)
  }
  for (const t of tri) idx.push(checkedAt(t, 0), checkedAt(t, 1), checkedAt(t, 2))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  if (flip) {
    const position = g.attributes.position as THREE.BufferAttribute | undefined
    if (position === undefined) {
      throw new Error('whale scene: body patch position attribute is missing')
    }
    const arr = position.array as Float32Array
    for (let i = 2; i < arr.length; i += 3) arr[i] = -checkedAt(arr, i)
  }
  g.scale(scale, scale, scale)
  return g
}

/** Split a closed fin outline into the left half (used for the mirrored fluke). */
function extractLeftHalf(pts: FinPt[]): FinPt[] | null {
  const n = pts.length
  const crossings: { index: number; point: FinPt }[] = []
  for (let i = 0; i < n; i++) {
    const a = checkedAt(pts, i)
    const b = checkedAt(pts, (i + 1) % n)
    if ((a.z < 0 && b.z >= 0) || (a.z >= 0 && b.z < 0)) {
      const t = a.z / (a.z - b.z)
      crossings.push({ index: i, point: { x: a.x + t * (b.x - a.x), z: 0 } })
    }
  }
  if (crossings.length < 2) return null
  const c1 = checkedAt(crossings, 0)
  const c2 = checkedAt(crossings, 1)
  const startIdx = c1.index
  const endIdx = c2.index
  const half: FinPt[] = [c1.point]
  if (endIdx >= startIdx) {
    for (let i = startIdx + 1; i <= endIdx; i++) half.push(checkedAt(pts, i % n))
  } else {
    for (let i = startIdx + 1; i < n; i++) half.push(checkedAt(pts, i))
    for (let i = 0; i <= endIdx; i++) half.push(checkedAt(pts, i))
  }
  half.push(c2.point)
  let avgZ = 0
  for (const p of half) avgZ += p.z
  avgZ /= half.length
  if (avgZ > 0) {
    half.length = 0
    half.push(c2.point)
    if (endIdx + 1 < startIdx) {
      for (let i = endIdx + 1; i <= startIdx; i++) half.push(checkedAt(pts, i % n))
    } else {
      for (let i = endIdx + 1; i < n; i++) half.push(checkedAt(pts, i))
      for (let i = 0; i <= startIdx; i++) half.push(checkedAt(pts, i))
    }
    half.push(c1.point)
  }
  return half
}

/** Thin double-sided leaf geometry from a closed 2D outline (x/z plane). */
function buildLeafGeometry(contour2D: FinPt[], thickness: number): THREE.BufferGeometry {
  const N = contour2D.length
  const h = thickness / 2
  const shapePts = contour2D.map(p => new THREE.Vector2(p.x, p.z))
  const tri = THREE.ShapeUtils.triangulateShape(shapePts, [])
  const pos: number[] = []
  for (const p of contour2D) pos.push(p.x, h, p.z)
  for (const p of contour2D) pos.push(p.x, -h, p.z)
  const idx: number[] = []
  for (const t of tri) idx.push(checkedAt(t, 0), checkedAt(t, 1), checkedAt(t, 2))
  for (const t of tri) idx.push(N + checkedAt(t, 0), N + checkedAt(t, 2), N + checkedAt(t, 1))
  for (let i = 0; i < N; i++) {
    const a = i
    const b = (i + 1) % N
    idx.push(a, b, N + b, a, N + b, N + a)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geom.setIndex(idx)
  geom.computeVertexNormals()
  return geom
}

/** Extrude a 2D polygon along a local (axisX, axisY) basis with given thickness. */
function extrudePolygon3D(
  points2D: Pt[],
  thickness: number,
  origin: THREE.Vector3,
  axisX: THREE.Vector3,
  axisY: THREE.Vector3,
): THREE.BufferGeometry {
  const N = points2D.length
  const h = thickness / 2
  const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize()
  const tri = THREE.ShapeUtils.triangulateShape(
    points2D.map(p => new THREE.Vector2(p.x, p.y)),
    [],
  )
  const pos: number[] = []
  for (const p of points2D) {
    const v = new THREE.Vector3().copy(origin).addScaledVector(axisX, p.x).addScaledVector(axisY, p.y).addScaledVector(axisZ, h)
    pos.push(v.x, v.y, v.z)
  }
  for (const p of points2D) {
    const v = new THREE.Vector3().copy(origin).addScaledVector(axisX, p.x).addScaledVector(axisY, p.y).addScaledVector(axisZ, -h)
    pos.push(v.x, v.y, v.z)
  }
  const idx: number[] = []
  for (const t of tri) idx.push(checkedAt(t, 0), checkedAt(t, 1), checkedAt(t, 2))
  for (const t of tri) idx.push(N + checkedAt(t, 0), N + checkedAt(t, 2), N + checkedAt(t, 1))
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N
    idx.push(i, j, N + j, i, N + j, N + i)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geom.setIndex(idx)
  geom.computeVertexNormals()
  return geom
}

/** Surface point at a fractional length along the body (scaled coordinates). */
function backSurfaceAt(
  frac: number,
  body: SweptData,
  scale: number,
): { x: number; top: number; mid: number; rad: number } {
  const xsArr = body.xs
  const midArr = body.mid
  const radArr = body.rad
  const totalX = checkedAt(xsArr, xsArr.length - 1) - checkedAt(xsArr, 0)
  const x = checkedAt(xsArr, 0) + totalX * frac
  let idx = 0
  while (idx < xsArr.length - 1 && checkedAt(xsArr, idx + 1) < x) idx++
  const t = (x - checkedAt(xsArr, idx)) / (checkedAt(xsArr, idx + 1) - checkedAt(xsArr, idx) || 1)
  const mid = checkedAt(midArr, idx) * (1 - t) + checkedAt(midArr, idx + 1) * t
  const rad = checkedAt(radArr, idx) * (1 - t) + checkedAt(radArr, idx + 1) * t
  return { x: x * scale, top: (mid + rad) * scale, mid: mid * scale, rad: rad * scale }
}

// ---------------------------------------------------------------------------
// Scene factory
// ---------------------------------------------------------------------------

export function createWhaleScene(canvas: HTMLCanvasElement): WhaleScene {
  // --- resource tracking for complete disposal ---
  const geoms: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []

  // --- body silhouette from the logo contour ---
  const rawContour = catmullRomResample(samplePath(PATH, 50), 800, true)
  let cx = 0
  let cy = 0
  for (const p of rawContour) {
    cx += p.x
    cy += p.y
  }
  cx /= rawContour.length
  cy /= rawContour.length
  const pts = rawContour.map(p => ({ x: (p.x - cx) * 1.1, y: -(p.y - cy) }))
  if (THREE.ShapeUtils.isClockWise(pts.map(p => new THREE.Vector2(p.x, p.y)))) pts.reverse()

  // --- swept body, normalized to the target height ---
  const { geometry: geo, profile: swept } = buildSwept(pts, CFG.SWEPT_SLICES, CFG.SWEPT_RINGS)
  geo.computeVertexNormals()
  const bodyBox = requireBox(geo)
  const scale = CFG.BODY_TARGET_HEIGHT / bodyBox.getSize(new THREE.Vector3()).y
  geo.scale(scale, scale, scale)
  geoms.push(geo)

  // --- renderer / camera (transparent clear, low fixed camera) ---
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.shadowMap.enabled = false
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  // low fixed camera; the corrected runtime's disabled OrbitControls still
  // re-aims at the origin via controls.update(), so replicate that orientation
  // (distance stays at the pinned 11.8 — the runtime clamps it to 10).
  camera.position.set(0, 0.8, 11.8)
  camera.lookAt(0, 0, 0)

  // --- blue/white body mask via mid/radius lookup texture ---
  const bb = requireBox(geo)
  const nSw = swept.mid.length
  const mrData = new Uint16Array(nSw * 2)
  for (let i = 0; i < nSw; i++) {
    mrData[i * 2] = toHalfFloat(checkedAt(swept.mid, i) * scale)
    mrData[i * 2 + 1] = toHalfFloat(checkedAt(swept.rad, i) * scale)
  }
  const mrTex = new THREE.DataTexture(mrData, nSw, 1, THREE.RGFormat, THREE.HalfFloatType)
  mrTex.minFilter = mrTex.magFilter = THREE.LinearFilter
  mrTex.needsUpdate = true
  texs.push(mrTex)

  const bodyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  bodyMat.extensions = { derivatives: true }
  bodyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uMR = { value: mrTex }
    sh.uniforms.uMin = { value: bb.min.x }
    sh.uniforms.uMax = { value: bb.max.x }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vPos;\nuniform sampler2D uMR;\nuniform float uMin, uMax;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float u = clamp((vPos.x - uMin) / (uMax - uMin), 0.0, 1.0);
          float midY = texture2D(uMR, vec2(u, 0.5)).r;
          float ang = 3.14159265 - abs(atan(vPos.z, vPos.y - midY));
          float baseScale = 0.77 * 1.1;
          float uCenter = 0.28, uHalf = 0.245 * baseScale, angMax = 0.84 * baseScale;
          float headFactor = 1.0 - smoothstep(0.18, 0.52, u);
          float angMaxAdjusted = angMax * (1.0 + 0.7 * headFactor);
          float uu = (0.16 + 0.49 * u - uCenter) / uHalf;
          float nn = ang / angMaxAdjusted;
          float rr = uu * uu + nn * nn;
          float tailZone = smoothstep(0.40, 0.58, u) * (1.0 - smoothstep(0.80, 0.86, u));
          float peak = 0.78, bumpWidth = 0.11, bumpStrength = 1.0;
          float d = nn - peak;
          float bump = tailZone * bumpStrength * exp(-d*d / (bumpWidth*bumpWidth));
          float threshold = 1.0 + bump;
          float aa = fwidth(rr) * 1.2 + 2e-4;
          float a = 1.0 - smoothstep(threshold - aa, threshold + aa, rr);
          diffuseColor.rgb = mix(vec3(0.302, 0.420, 0.996), vec3(1.0), a);
        }`,
      )
  }
  mats.push(bodyMat)

  const model = new THREE.Mesh(geo, bodyMat)

  // --- eye patch (brow) + eyes, mirrored pair each ---
  const browSvg = samplePath(BROW_PATH, 40)
  const browMat = new THREE.MeshBasicMaterial({
    color: CFG.COLOR_WHITE,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  mats.push(browMat)
  const browGroup = new THREE.Group()
  const browGeomL = buildSurfacePatch(browSvg, swept, scale, cx, cy, false)
  const browGeomR = buildSurfacePatch(browSvg, swept, scale, cx, cy, true)
  geoms.push(browGeomL, browGeomR)
  browGroup.add(new THREE.Mesh(browGeomL, browMat))
  browGroup.add(new THREE.Mesh(browGeomR, browMat))
  model.add(browGroup)

  const dentPoint = browSvg.reduce((prev, cur) => (cur.y < prev.y ? cur : prev), checkedAt(browSvg, 0))
  const eyeCenterX = dentPoint.x - 2
  const eyeCenterY = dentPoint.y + CFG.EYE_OFFSET_Y
  const circlePoints: Pt[] = []
  for (let i = 0; i < CFG.EYE_CIRCLE_SEGMENTS; i++) {
    const angle = (i / CFG.EYE_CIRCLE_SEGMENTS) * Math.PI * 2
    circlePoints.push({ x: eyeCenterX + CFG.EYE_RADIUS * Math.cos(angle), y: eyeCenterY + CFG.EYE_RADIUS * Math.sin(angle) })
  }
  const eyeMat = new THREE.MeshBasicMaterial({
    color: CFG.COLOR_WHITE,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    transparent: true,
    opacity: 1.0,
  })
  mats.push(eyeMat)
  const eyeGroup = new THREE.Group()
  const eyeGeomL = buildSurfacePatch(circlePoints, swept, scale, cx, cy, false)
  const eyeGeomR = buildSurfacePatch(circlePoints, swept, scale, cx, cy, true)
  geoms.push(eyeGeomL, eyeGeomR)
  eyeGroup.add(new THREE.Mesh(eyeGeomL, eyeMat))
  eyeGroup.add(new THREE.Mesh(eyeGeomR, eyeMat))
  model.add(eyeGroup)

  // --- tail fluke (V-shaped leaf, mirrored across z) ---
  const tailSvgPts = samplePath(TAIL_PATH, 60)
  if (tailSvgPts.length > 0) {
    const first = checkedAt(tailSvgPts, 0)
    tailSvgPts.push({ x: first.x, y: first.y })
  }
  const bodyTipX = checkedAt(swept.xs, swept.xs.length - 1) * scale
  const bodyTipY = checkedAt(swept.mid, swept.mid.length - 1) * scale
  const openAng = (CFG.TAIL_OPEN_ANGLE_DEG * Math.PI) / 180
  const oc = Math.cos(openAng)
  const os = Math.sin(openAng)
  const finPts: FinPt[] = tailSvgPts.map((p) => {
    const lx = (p.x - TAIL_NOTCH.x) * CFG.TAIL_FORK_SCALE
    const ly = -(p.y - TAIL_NOTCH.y) * CFG.TAIL_FORK_SCALE
    return { x: lx * oc + ly * os, z: -lx * os + ly * oc }
  })
  const tailMat = new THREE.MeshBasicMaterial({ color: CFG.COLOR_BODY_BLUE, side: THREE.DoubleSide })
  mats.push(tailMat)
  const tailGroup = new THREE.Group()
  const leftHalf = extractLeftHalf(finPts)
  if (leftHalf && leftHalf.length > 2) {
    const first = checkedAt(leftHalf, 0)
    const closedLeft = [...leftHalf, { x: first.x, z: first.z }]
    const leftGeom = buildLeafGeometry(closedLeft, CFG.TAIL_THICKNESS)
    tailGroup.add(new THREE.Mesh(leftGeom, tailMat))
    const rightGeom = leftGeom.clone()
    const rightMesh = new THREE.Mesh(rightGeom, tailMat)
    rightMesh.scale.z = -1
    tailGroup.add(rightMesh)
    geoms.push(leftGeom, rightGeom)
  } else {
    // fallback full fluke (source keeps this branch as a safety net)
    const fallbackGeom = buildLeafGeometry(finPts, CFG.TAIL_THICKNESS)
    tailGroup.add(new THREE.Mesh(fallbackGeom, tailMat))
    geoms.push(fallbackGeom)
  }
  model.add(tailGroup)
  tailGroup.position.set(bodyTipX + CFG.TAIL_NOTCH_DX, bodyTipY + CFG.TAIL_NOTCH_DY, 0)
  tailGroup.rotation.z = (CFG.TAIL_TILT_DEG * Math.PI) / 180

  // --- dorsal fin ---
  const dorsalSvg = samplePath(DORSAL_PATH, CFG.DORSAL_SAMPLES)
  if (dorsalSvg.length > 0) {
    const first = checkedAt(dorsalSvg, 0)
    dorsalSvg.push({ x: first.x, y: first.y })
  }
  const by0 = backSurfaceAt(CFG.DORSAL_START_FRAC, swept, scale).top
  const by1 = backSurfaceAt(CFG.DORSAL_END_FRAC, swept, scale).top
  const dorsalPts: Pt[] = dorsalSvg.map((p) => {
    const u = (p.x - DORSAL_BL) / (DORSAL_BR - DORSAL_BL)
    const baseY = 2.993 + u * (4.746 - 2.993)
    const h = Math.max(0, (baseY - p.y) * CFG.DORSAL_HEIGHT_SCALE)
    const frac = CFG.DORSAL_START_FRAC + u * (CFG.DORSAL_END_FRAC - CFG.DORSAL_START_FRAC)
    const xsArr = swept.xs
    const px = (checkedAt(xsArr, 0) + (checkedAt(xsArr, xsArr.length - 1) - checkedAt(xsArr, 0)) * frac) * scale
    const py = by0 + u * (by1 - by0) - CFG.DORSAL_SINK + h
    return { x: px, y: py }
  })
  const dorsalMat = new THREE.MeshBasicMaterial({ color: CFG.COLOR_BODY_BLUE, side: THREE.DoubleSide })
  mats.push(dorsalMat)
  const dorsalGeom = extrudePolygon3D(
    dorsalPts,
    CFG.DORSAL_THICKNESS,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  )
  geoms.push(dorsalGeom)
  model.add(new THREE.Mesh(dorsalGeom, dorsalMat))

  // --- pectoral fins (each on its own pivot for flapping) ---
  const pecSvg = samplePath(PEC_PATH, 30)
  if (pecSvg.length > 0) {
    const first = checkedAt(pecSvg, 0)
    pecSvg.push({ x: first.x, y: first.y })
  }
  const pecMat = new THREE.MeshBasicMaterial({ color: CFG.COLOR_BODY_BLUE, side: THREE.DoubleSide })
  mats.push(pecMat)
  const pecAngle = (CFG.PEC_RADIAN * Math.PI) / 180
  const finPivots: { pivot: THREE.Group; side: number }[] = []
  for (const side of [1, -1]) {
    const s0 = backSurfaceAt(CFG.PEC_START_FRAC, swept, scale)
    const s1 = backSurfaceAt(CFG.PEC_END_FRAC, swept, scale)
    const r0 = s0.rad - CFG.PEC_SINK
    const r1 = s1.rad - CFG.PEC_SINK
    const Rh = new THREE.Vector3(
      s0.x + CFG.PEC_BACKWARD_OFFSET,
      s0.mid + r0 * Math.cos(pecAngle),
      side * (r0 * Math.sin(pecAngle) + CFG.PEC_OUTWARD_OFFSET),
    )
    const Rt = new THREE.Vector3(
      s1.x + CFG.PEC_BACKWARD_OFFSET,
      s1.mid + r1 * Math.cos(pecAngle),
      side * (r1 * Math.sin(pecAngle) + CFG.PEC_OUTWARD_OFFSET),
    )
    const rootLen = Rh.distanceTo(Rt)
    const axisX = new THREE.Vector3().subVectors(Rt, Rh).normalize()
    const outRaw = new THREE.Vector3(
      0,
      -Math.sin((CFG.PEC_ANGLE_DEG * Math.PI) / 180),
      side * Math.cos((CFG.PEC_ANGLE_DEG * Math.PI) / 180),
    )
    const axisY = outRaw.clone().addScaledVector(axisX, -outRaw.dot(axisX)).normalize()
    const pec2D: Pt[] = pecSvg.map((p) => {
      const u = (p.x - PEC_BL) / (PEC_BR - PEC_BL)
      const baseY = 19.267 + u * (19.565 - 19.267)
      const w = Math.max(0, (p.y - baseY) / PEC_DROP)
      return { x: u * rootLen + w * CFG.PEC_SWEEP, y: w * CFG.PEC_SPAN }
    })
    const finGeom = extrudePolygon3D(pec2D, CFG.PEC_THICKNESS, new THREE.Vector3(0, 0, 0), axisX, axisY)
    geoms.push(finGeom)
    const pivot = new THREE.Group()
    pivot.position.copy(Rh)
    pivot.add(new THREE.Mesh(finGeom, pecMat))
    model.add(pivot)
    finPivots.push({ pivot, side })
  }

  // --- Box3 centering inside a pivot group (allows yaw/pitch/roll + bounce) ---
  model.updateMatrixWorld(true)
  const petBounds = new THREE.Box3().setFromObject(model)
  const petCenter = petBounds.getCenter(new THREE.Vector3())
  const petPivot = new THREE.Group()
  model.position.set(-petCenter.x, -petCenter.y, -petCenter.z)
  petPivot.add(model)
  scene.add(petPivot)
  const petBaseY = model.position.y

  // --- animation state: integrated phases + low-pass filters ---
  const f: Filters = { speed: 0, motionX: 0, motionY: 0, patrolLevel: 0, dragLevel: 0, yaw: 0, pitch: 0, roll: 0 }
  let initialized = false
  let swimPhase = 0
  let motionPhase = 0

  function resize(width: number, height: number, dpr: number): void {
    renderer.setPixelRatio(Math.min(Math.max(dpr, 1), 2))
    renderer.setSize(width, height)
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
  }

  function render(deltaSeconds: number, elapsedSeconds: number, external: WhaleExternalState): void {
    // clamp like the runtime clock (max 0.1s per frame)
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1)
    const hover = external.hover ? 1 : 0
    const mode = external.mode
    const mood = external.activity.mood
    const intensity = clamp01(external.activity.intensity)
    const speedTarget = clamp01(external.speed)
    const motionXTarget = clamp11(external.motionX)
    const motionYTarget = clamp11(external.motionY)

    // low-pass filters (exact runtime rates); snap on the first frame so the
    // pet does not lunge from a zero-initialized state on mount
    if (!initialized) {
      f.speed = speedTarget
      f.motionX = motionXTarget
      f.motionY = motionYTarget
      f.patrolLevel = mode === 1 ? 1 : 0
      f.dragLevel = external.dragging ? 1 : 0
      f.yaw = external.yaw
      f.pitch = external.pitch
      f.roll = external.roll
      initialized = true
    } else {
      f.speed += (speedTarget - f.speed) * (1 - Math.exp(-(speedTarget > f.speed ? 10 : 6) * delta))
      const directionBlend = 1 - Math.exp(-8 * delta)
      f.motionX += (motionXTarget - f.motionX) * directionBlend
      f.motionY += (motionYTarget - f.motionY) * directionBlend
      f.patrolLevel += ((mode === 1 ? 1 : 0) - f.patrolLevel) * (1 - Math.exp(-7 * delta))
      f.dragLevel += ((external.dragging ? 1 : 0) - f.dragLevel) * (1 - Math.exp(-9 * delta))
    }

    // effective swim frequency; the phase is INTEGRATED (never elapsed * speed)
    const swimBoost = mood === 'sleeping'
      ? 0.3
      : mood === 'thinking'
        ? 1.2
        : mood === 'working'
          ? 1.35 + 0.2 * intensity
          : mood === 'focused'
            ? 1.5 + 0.25 * intensity
            : mood === 'celebrating'
              ? 1.7
              : mood === 'listening'
                ? 0.85
                : 1
    let swimSpeed = CFG.SWIM_SPEED * (1 + f.speed * 1.55)
    if (hover > 0.5) swimSpeed *= CFG.HOVER_SWIM_BOOST
    swimSpeed *= swimBoost
    swimPhase += swimSpeed * Math.PI * 2 * delta

    const t = elapsedSeconds
    const bodyAmp = CFG.BODY_SWAY_AMPLITUDE * (
      mood === 'sleeping' ? 0.35
        : mood === 'working' || mood === 'focused' ? 1.25
          : mood === 'celebrating' ? 1.4
            : mood === 'listening' ? 0.8
              : 1
    )
    const pitchAmp = CFG.PITCH_AMPLITUDE * (mood === 'sleeping' ? 0.4 : 1)
    const rollAmp = CFG.ROLL_AMPLITUDE * (mood === 'sleeping' ? 0.5 : 1)
    const bodySway = Math.sin(swimPhase) * bodyAmp
    const pitchSway = Math.sin(swimPhase + 0.8) * pitchAmp
    const rollSway = Math.sin(swimPhase * 0.55 + 0.3) * rollAmp

    // filtered external pose (yaw/pitch/roll)
    const poseBlend = 1 - Math.exp(-7 * delta)
    f.yaw += (external.yaw - f.yaw) * poseBlend
    f.pitch += (external.pitch - f.pitch) * poseBlend
    f.roll += (external.roll - f.roll) * (1 - Math.exp(-9 * delta))

    // movement-driven motion energy (patrol / drag / follow)
    const patrolEnergy = f.patrolLevel * f.speed
    const dragEnergy = f.dragLevel * f.speed
    const residualEnergy = mode === 3 ? f.speed * 0.6 : 0
    const motionEnergy = Math.max(patrolEnergy, dragEnergy, residualEnergy)
    motionPhase += (8 + motionEnergy * 10) * delta
    const motionWave = Math.sin(motionPhase)
    const motionWave2 = Math.cos(motionPhase * 0.82 + 0.35)
    const motionBounce = 0.5 - 0.5 * Math.cos(motionPhase)
    const celebratePulse = mood === 'celebrating' ? 1 : 0
    const happyPulse = Math.max(hover, celebratePulse) * (0.5 + 0.5 * Math.sin(t * 8))

    // swim pose on the body
    model.rotation.y = bodySway + motionWave * patrolEnergy * 0.06
    model.rotation.x = pitchSway - f.motionY * motionEnergy * 0.1 + motionWave2 * patrolEnergy * 0.04
    model.rotation.z = rollSway + motionWave * patrolEnergy * 0.035

    // pivot pose, bounce and squash/stretch; focused turns dive slightly.
    const divePitch = mood === 'focused' ? -0.08 * intensity : mood === 'sleeping' ? 0.02 : 0
    petPivot.rotation.y = f.yaw
    petPivot.rotation.x = f.pitch - f.motionY * motionEnergy * 0.055 + divePitch
    petPivot.rotation.z = f.roll + motionWave * motionEnergy * 0.02
    petPivot.position.y = motionBounce * patrolEnergy * 0.07 + motionWave * dragEnergy * 0.018
    // Error: rapid trembling so the reaction cannot be missed.
    petPivot.position.x = mood === 'error' ? Math.sin(t * 45) * 0.016 : 0
    petPivot.scale.set(
      1 + dragEnergy * 0.21 + patrolEnergy * (0.04 + motionWave * 0.015) + happyPulse * 0.012,
      1 - dragEnergy * 0.14 - patrolEnergy * (0.022 + motionWave * 0.015) + happyPulse * 0.016,
      1 - dragEnergy * 0.065 + patrolEnergy * motionWave2 * 0.015 + happyPulse * 0.012,
    )

    // tail fluke: swim sway + motion steering + movement waves
    const tailAmpY = CFG.TAIL_SWAY_AMPLITUDE * (mood === 'sleeping' ? 0.35 : mood === 'celebrating' ? 1.4 : 1)
    const tailAmpX = CFG.TAIL_PITCH_AMPLITUDE * (mood === 'sleeping' ? 0.4 : 1)
    const tailSwayY = Math.sin(swimPhase + 0.7) * tailAmpY
    const tailSwayX = Math.sin(swimPhase + 1.2) * tailAmpX
    tailGroup.rotation.y = tailSwayY - f.motionX * motionEnergy * 0.28 + motionWave * patrolEnergy * 0.2 + motionWave * dragEnergy * 0.08
    tailGroup.rotation.x = tailSwayX - f.motionY * motionEnergy * 0.42 + motionWave2 * patrolEnergy * 0.25 + motionWave2 * dragEnergy * 0.12
    tailGroup.rotation.z = (CFG.TAIL_TILT_DEG * Math.PI) / 180

    // pectoral fins: flapping + steering
    const pecAmp = CFG.PEC_FLAP_AMPLITUDE * (
      mood === 'sleeping' ? 0.3
        : mood === 'working' || mood === 'focused' ? 1.3
          : mood === 'listening' ? 0.8
            : 1
    )
    const pecFlap = Math.sin(swimPhase + CFG.PEC_FLAP_PHASE) * pecAmp
    for (const { pivot, side } of finPivots) {
      pivot.rotation.x = pecFlap + motionWave * patrolEnergy * 0.3 - dragEnergy * 0.52
      pivot.rotation.z = -f.motionY * motionEnergy * side * 0.15 + motionWave2 * patrolEnergy * side * 0.1
    }

    // gentle float (fixed frequency) + hover bob + motion bounce
    const floatSpeed = CFG.FLOAT_SPEED * (mood === 'sleeping' ? 0.45 : 1)
    const floatAmp = CFG.FLOAT_AMPLITUDE * (
      mood === 'sleeping' ? 0.4
        : mood === 'celebrating' ? 1.5
          : mood === 'listening' ? 0.8
            : 1
    )
    const floatOffset = Math.sin(t * floatSpeed) * floatAmp
    model.position.y =
      petBaseY + floatOffset + hover * Math.sin(t * 8) * 0.035 + motionBounce * patrolEnergy * 0.085 + motionWave * dragEnergy * 0.035

    if (mood === 'sleeping') {
      // Persistent closed eyes and a slow sleepy squash.
      eyeMat.opacity = 0.12
      eyeGroup.scale.y = 0.18 + 0.06 * Math.sin(t * 1.1)
      eyeGroup.scale.x = 1.1
      eyeGroup.scale.z = 1.1
    } else if (mood === 'error') {
      // Startled wide-open eyes while the sweat drops pour down.
      const startle = 1 + intensity * 0.32
      eyeMat.opacity = 1
      eyeGroup.scale.set(startle, startle, startle)
    } else {
      // blink (fixed interval driven by elapsed time, like the runtime)
      const blinkCycle = t % CFG.BLINK_INTERVAL
      if (blinkCycle < CFG.BLINK_DURATION) {
        const p = blinkCycle / CFG.BLINK_DURATION
        if (p < 0.4) {
          eyeMat.opacity = 1 - p / 0.4
        } else {
          const q = (p - 0.4) / 0.6
          eyeMat.opacity = q * q * (3 - 2 * q)
        }
        const eyeSquash = 1 - Math.sin(Math.min(p, 1) * Math.PI) * 0.35
        eyeGroup.scale.y = eyeSquash
        eyeGroup.scale.x = 1 + (1 - eyeSquash) * 0.3
        eyeGroup.scale.z = 1 + (1 - eyeSquash) * 0.3
      } else {
        eyeMat.opacity = 1.0
        eyeGroup.scale.set(1, 1, 1)
      }
    }

    renderer.render(scene, camera)
  }

  function dispose(): void {
    scene.clear()
    for (const g of geoms) g.dispose()
    for (const m of mats) m.dispose()
    for (const tex of texs) tex.dispose()
    renderer.dispose()
  }

  return { resize, render, dispose }
}
