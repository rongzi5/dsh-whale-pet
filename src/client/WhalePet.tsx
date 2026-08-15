import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { WhalePetController } from './runtime/whale-pet-controller.ts'
import styles from './WhalePet.module.css'

/** The frame-wide interactive whale pet surface (view only). */
export function WhalePet(): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shadowRef = useRef<HTMLSpanElement | null>(null)
  const controllerRef = useRef<WhalePetController | null>(null)
  if (controllerRef.current === null) controllerRef.current = new WhalePetController()
  const controller = controllerRef.current

  const [burst, setBurst] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const root = rootRef.current
    const pet = petRef.current
    const canvas = canvasRef.current
    const shadow = shadowRef.current
    if (root === null || pet === null || canvas === null || shadow === null) return

    const started = controller.start({ root, pet, canvas, shadow }, { onError: setError })
    if (!started) return

    return () => {
      controller.dispose()
    }
  }, [controller])

  const isPetDescendant = (target: EventTarget | null): boolean => {
    const pet = petRef.current
    return target instanceof Node && pet !== null && pet.contains(target)
  }

  const react = (): void => {
    setBurst(value => value + 1)
  }

  const pointerEnter = (event: PointerEvent<HTMLElement>): void => {
    if (isPetDescendant(event.relatedTarget)) return
    controller.setHover(true)
    react()
  }

  const pointerLeave = (event: PointerEvent<HTMLElement>): void => {
    if (isPetDescendant(event.relatedTarget)) return
    controller.setHover(false)
  }

  const pointerDown = (event: PointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    controller.beginDrag(event.clientX, event.clientY)
  }

  const click = (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
    if (controller.wasClick() === true) react()
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
