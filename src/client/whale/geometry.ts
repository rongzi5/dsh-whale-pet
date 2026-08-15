/**
 * Pure geometry helpers for the procedural whale scene.
 *
 * Everything in this module is deterministic and side-effect free: it turns
 * SVG contours and numeric profiles into Three.js BufferGeometry. Scene
 * construction and animation live elsewhere so the heavy math can be tested
 * and tuned in isolation.
 */

import * as THREE from 'three'

import { CFG } from './config.ts'

export interface Pt {
  x: number
  y: number
}

export interface FinPt {
  x: number
  z: number
}

/** Per-slice body profile: x stations plus mid/radius curves (unscaled). */
export interface SweptData {
  xs: number[]
  mid: number[]
  rad: number[]
}

/**
 * Index into any array-like (plain arrays and typed arrays alike) with a loud
 * out-of-range failure. Satisfies `noUncheckedIndexedAccess` without non-null
 * assertions and surfaces a corrupt profile/fin array at the point of access
 * instead of silently producing NaN geometry.
 */
export function checkedAt<T>(array: ArrayLike<T>, index: number): T {
  if (index < 0 || index >= array.length || !Number.isInteger(index)) {
    throw new RangeError(`whale scene: index ${index} outside [0, ${array.length})`)
  }
  const value = array[index]
  if (value === undefined) {
    throw new RangeError(`whale scene: element at index ${index} is undefined`)
  }
  return value
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Sample an SVG path (M/L/C commands only) densely. */
export function samplePath(d: string, stepsPerSegment: number): Pt[] {
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
export function catmullRomResample(points: Pt[], targetCount: number, closed: boolean): Pt[] {
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

export function smoothGaussian(arr: number[], sigma: number, iterations: number): number[] {
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

export function toHalfFloat(val: number): number {
  const clamped = Math.min(65504, Math.max(-65504, val))
  _halfFloatViews.floatView[0] = clamped
  const f = checkedAt(_halfFloatViews.uint32View, 0)
  const e = (f >> 23) & 0x1ff
  return checkedAt(_halfFloatViews.baseTable, e) + ((f & 0x007fffff) >> checkedAt(_halfFloatViews.shiftTable, e))
}

export function removeDents(arr: number[], window: number): number[] {
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
export interface SweptBody {
  geometry: THREE.BufferGeometry
  profile: SweptData
}

/** Build the swept body geometry and its per-slice profile. */
export function buildSwept(poly: Pt[], nSlices: number, nRings: number): SweptBody {
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

export function requireBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (box === null) throw new Error('whale scene: bounding box unavailable')
  return box
}

/** Map an SVG-space point onto the swept body surface (with a lift offset). */
export function mapBrowToSurface(p: Pt, body: SweptData, cx: number, cy: number): { x: number; y: number; z: number } {
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
export function buildSurfacePatch(points: Pt[], swept: SweptData, scale: number, cx: number, cy: number, flip: boolean): THREE.BufferGeometry {
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
export function extractLeftHalf(pts: FinPt[]): FinPt[] | null {
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
export function buildLeafGeometry(contour2D: FinPt[], thickness: number): THREE.BufferGeometry {
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
export function extrudePolygon3D(
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
export function backSurfaceAt(
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
