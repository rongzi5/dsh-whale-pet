/**
 * Procedural killer-whale ("DeepSeek logo" whale) 3D scene factory.
 *
 * The geometry, shading and animation are ported faithfully from the original
 * demo. This module composes the shared config, geometry builders and material
 * factories into a self-contained `WhaleScene` handle; the parent owns the
 * frame loop, input and resizing.
 *
 * The scene is fully driven from the outside: `createWhaleScene` never attaches
 * event listeners, never calls requestAnimationFrame and never schedules
 * timers. The swim and motion phases are *integrated* from `deltaSeconds`
 * (never `elapsed * time-varying speed`); only fixed-frequency effects (float,
 * blink, happy pulse) use elapsed time.
 */

import * as THREE from 'three'

import { WhaleAnimator, type WhaleExternalState } from './animation.ts'
import {
  CFG,
  PATH,
  BROW_PATH,
  TAIL_PATH,
  DORSAL_PATH,
  PEC_PATH,
  TAIL_NOTCH,
  DORSAL_BL,
  DORSAL_BR,
  PEC_BL,
  PEC_BR,
  PEC_DROP,
} from './config.ts'
import {
  backSurfaceAt,
  buildLeafGeometry,
  buildSurfacePatch,
  buildSwept,
  catmullRomResample,
  checkedAt,
  extractLeftHalf,
  extrudePolygon3D,
  requireBox,
  samplePath,
  toHalfFloat,
} from './geometry.ts'
import {
  createBodyMaterial,
  createBrowMaterial,
  createEyeMaterial,
  createFinMaterial,
} from './materials.ts'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { WhaleExternalState } from './animation.ts'

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

  const bodyMat = createBodyMaterial(mrTex, bb)
  mats.push(bodyMat)

  const model = new THREE.Mesh(geo, bodyMat)

  // --- eye patch (brow) + eyes, mirrored pair each ---
  const browSvg = samplePath(BROW_PATH, 40)
  const browMat = createBrowMaterial()
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
  const circlePoints: { x: number; y: number }[] = []
  for (let i = 0; i < CFG.EYE_CIRCLE_SEGMENTS; i++) {
    const angle = (i / CFG.EYE_CIRCLE_SEGMENTS) * Math.PI * 2
    circlePoints.push({ x: eyeCenterX + CFG.EYE_RADIUS * Math.cos(angle), y: eyeCenterY + CFG.EYE_RADIUS * Math.sin(angle) })
  }
  const eyeMat = createEyeMaterial()
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
  const finPts: { x: number; z: number }[] = tailSvgPts.map((p) => {
    const lx = (p.x - TAIL_NOTCH.x) * CFG.TAIL_FORK_SCALE
    const ly = -(p.y - TAIL_NOTCH.y) * CFG.TAIL_FORK_SCALE
    return { x: lx * oc + ly * os, z: -lx * os + ly * oc }
  })
  const tailMat = createFinMaterial(CFG.COLOR_BODY_BLUE)
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
  const dorsalPts: { x: number; y: number }[] = dorsalSvg.map((p) => {
    const u = (p.x - DORSAL_BL) / (DORSAL_BR - DORSAL_BL)
    const baseY = 2.993 + u * (4.746 - 2.993)
    const h = Math.max(0, (baseY - p.y) * CFG.DORSAL_HEIGHT_SCALE)
    const frac = CFG.DORSAL_START_FRAC + u * (CFG.DORSAL_END_FRAC - CFG.DORSAL_START_FRAC)
    const xsArr = swept.xs
    const px = (checkedAt(xsArr, 0) + (checkedAt(xsArr, xsArr.length - 1) - checkedAt(xsArr, 0)) * frac) * scale
    const py = by0 + u * (by1 - by0) - CFG.DORSAL_SINK + h
    return { x: px, y: py }
  })
  const dorsalMat = createFinMaterial(CFG.COLOR_BODY_BLUE)
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
  const pecMat = createFinMaterial(CFG.COLOR_BODY_BLUE)
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
    const pec2D: { x: number; y: number }[] = pecSvg.map((p) => {
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
  const animator = new WhaleAnimator({
    model,
    petPivot,
    tailGroup,
    eyeMat,
    eyeGroup,
    finPivots,
    petBaseY,
  })

  function resize(width: number, height: number, dpr: number): void {
    renderer.setPixelRatio(Math.min(Math.max(dpr, 1), 2))
    renderer.setSize(width, height)
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
  }

  function render(deltaSeconds: number, elapsedSeconds: number, external: WhaleExternalState): void {
    animator.update(deltaSeconds, elapsedSeconds, external)
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
