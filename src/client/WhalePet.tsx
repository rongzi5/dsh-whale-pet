import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { PET_HEIGHT, PET_WIDTH, WhaleMotionController } from './motion.ts'
import { createWhaleScene, type WhaleScene } from './whale-scene.ts'
import styles from './WhalePet.module.css'

const formatTransform = (value: number): string => value.toFixed(3)

/** The frame-wide interactive whale pet surface. */
export function WhalePet(): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shadowRef = useRef<HTMLSpanElement | null>(null)
  const motionRef = useRef<WhaleMotionController | null>(null)
  const sceneRef = useRef<WhaleScene | null>(null)
  const [burst, setBurst] = useState(0)
  const [error, setError] = useState('')

  if (motionRef.current === null) motionRef.current = new WhaleMotionController()

  useEffect(() => {
    const root = rootRef.current
    const pet = petRef.current
    const canvas = canvasRef.current
    const shadow = shadowRef.current
    const motion = motionRef.current
    if (root === null || pet === null || canvas === null || shadow === null || motion === null) return

    const doc = root.ownerDocument
    const browser = doc.defaultView
    if (browser === null) return

    let scene: WhaleScene
    try {
      scene = createWhaleScene(canvas)
      sceneRef.current = scene
    } catch (cause) {
      console.error('[ui-whale-pet] creating the Three.js scene failed:', cause)
      setError('3D 模型不可用')
      return
    }

    let frameHandle = 0
    let lastTime = 0
    let elapsed = 0
    let currentDpr = 0
    let disposed = false

    const resize = (): void => {
      const width = Math.max(PET_WIDTH + 30, doc.documentElement.clientWidth || browser.innerWidth)
      const height = Math.max(PET_HEIGHT + 46, doc.documentElement.clientHeight || browser.innerHeight)
      motion.resize(width, height)
      const nextDpr = Math.min(2, Math.max(1, browser.devicePixelRatio || 1))
      currentDpr = nextDpr
      scene.resize(PET_WIDTH, PET_HEIGHT, nextDpr)
    }

    const pointerMove = (event: globalThis.PointerEvent): void => {
      motion.pointerMove(event.clientX, event.clientY)
    }
    const release = (): void => {
      motion.releaseDrag()
    }

    const loop = (time: number): void => {
      if (disposed) return
      const dt = lastTime === 0 ? 1 / 60 : Math.max(0.004, Math.min(0.04, (time - lastTime) / 1000))
      lastTime = time
      elapsed += dt
      const nextDpr = Math.min(2, Math.max(1, browser.devicePixelRatio || 1))
      if (nextDpr !== currentDpr) {
        currentDpr = nextDpr
        scene.resize(PET_WIDTH, PET_HEIGHT, nextDpr)
      }

      const frame = motion.step(dt)
      pet.style.transform = `translate3d(${formatTransform(frame.x)}px, ${formatTransform(frame.y)}px, 0) rotate(${formatTransform(frame.angle)}deg)`
      shadow.style.transform = frame.dragging
        ? 'scale(0.7, 0.62)'
        : `scale(${formatTransform(1 + frame.speed * 0.14)}, ${formatTransform(1 - frame.speed * 0.08)})`
      shadow.style.opacity = frame.dragging ? '0.08' : '0.68'

      try {
        scene.render(dt, elapsed, frame)
      } catch (cause) {
        console.error('[ui-whale-pet] rendering the Three.js scene failed:', cause)
        setError('3D 模型不可用')
        scene.dispose()
        sceneRef.current = null
        return
      }
      frameHandle = browser.requestAnimationFrame(loop)
    }

    resize()
    browser.addEventListener('resize', resize)
    doc.addEventListener('pointermove', pointerMove, { passive: true })
    doc.addEventListener('pointerup', release, { passive: true })
    doc.addEventListener('pointercancel', release, { passive: true })
    frameHandle = browser.requestAnimationFrame(loop)

    return () => {
      disposed = true
      browser.cancelAnimationFrame(frameHandle)
      browser.removeEventListener('resize', resize)
      doc.removeEventListener('pointermove', pointerMove)
      doc.removeEventListener('pointerup', release)
      doc.removeEventListener('pointercancel', release)
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  const isPetDescendant = (target: EventTarget | null): boolean => {
    const pet = petRef.current
    return target instanceof Node && pet !== null && pet.contains(target)
  }

  const react = (): void => {
    setBurst(value => value + 1)
  }

  const pointerEnter = (event: PointerEvent<HTMLElement>): void => {
    if (isPetDescendant(event.relatedTarget)) return
    motionRef.current?.setHover(true)
    react()
  }

  const pointerLeave = (event: PointerEvent<HTMLElement>): void => {
    if (isPetDescendant(event.relatedTarget)) return
    motionRef.current?.setHover(false)
  }

  const pointerDown = (event: PointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    motionRef.current?.beginDrag(event.clientX, event.clientY)
  }

  const click = (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
    if (motionRef.current?.wasClick() === true) react()
  }

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    react()
  }

  const zoneEvents = { onPointerEnter: pointerEnter, onPointerLeave: pointerLeave, onPointerDown: pointerDown, onClick: click }

  return (
    <div ref={rootRef} className={styles.layer} style={{ pointerEvents: 'none' }}>
      <div ref={petRef} className={styles.pet}>
        <span ref={shadowRef} className={styles.shadow} aria-hidden="true" />
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <button
          type="button"
          className={`${styles.hitZone} ${styles.hitBody}`}
          aria-label="DeepSeek 3D whale pet"
          onKeyDown={keyDown}
          {...zoneEvents}
        />
        <div className={`${styles.hitZone} ${styles.hitTail}`} aria-hidden="true" {...zoneEvents} />
        <div className={`${styles.hitZone} ${styles.hitDorsal}`} aria-hidden="true" {...zoneEvents} />
        <div className={`${styles.hitZone} ${styles.hitFin}`} aria-hidden="true" {...zoneEvents} />
        {error === '' ? null : <div className={styles.error}>{error}</div>}
        {burst === 0 ? null : (
          <>
            <span key={`${burst}-left`} className={`${styles.heart} ${styles.heartLeft}`} aria-hidden="true">♥</span>
            <span key={`${burst}-right`} className={`${styles.heart} ${styles.heartRight}`} aria-hidden="true">♥</span>
          </>
        )}
      </div>
    </div>
  )
}
