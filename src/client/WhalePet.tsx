import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import type { WhaleEffect } from './activity.ts'
import { WhalePetService } from './runtime/whale-pet-service.ts'
import styles from './WhalePet.module.css'

export interface WhalePetProps {
  whalePet: WhalePetService
}

/** The frame-wide interactive whale pet surface (view only). */
export function WhalePet({ whalePet }: WhalePetProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shadowRef = useRef<HTMLSpanElement | null>(null)
  const [error, setError] = useState('')

  const snapshot = useSyncExternalStore(
    onChange => whalePet.subscribe(onChange),
    () => whalePet.getSnapshot(),
  )

  useEffect(() => {
    const root = rootRef.current
    const pet = petRef.current
    const canvas = canvasRef.current
    const shadow = shadowRef.current
    if (root === null || pet === null || canvas === null || shadow === null) return

    const started = whalePet.mount({ root, pet, canvas, shadow }, { onError: setError })
    if (!started) return

    return () => {
      whalePet.unmount()
    }
  }, [whalePet])

  const isPetDescendant = (target: EventTarget | null): boolean => {
    const pet = petRef.current
    return target instanceof Node && pet !== null && pet.contains(target)
  }

  const react = (): void => {
    whalePet.playEffect('heart')
  }

  const pointerEnter = (event: PointerEvent<HTMLElement>): void => {
    if (isPetDescendant(event.relatedTarget)) return
    whalePet.wake()
    whalePet.setHover(true)
    react()
  }

  const pointerLeave = (event: PointerEvent<HTMLElement>): void => {
    if (isPetDescendant(event.relatedTarget)) return
    whalePet.setHover(false)
  }

  const pointerDown = (event: PointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    whalePet.wake()
    whalePet.beginDrag(event.clientX, event.clientY)
  }

  const click = (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
    if (whalePet.wasClick() === true) react()
  }

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    react()
  }

  const zoneEvents = { onPointerEnter: pointerEnter, onPointerLeave: pointerLeave, onPointerDown: pointerDown, onClick: click }
  const sleeping = snapshot.activity.mood === 'sleeping'
  const hearts = snapshot.effects.filter(effect => effect.kind === 'heart')
  const bubbles = snapshot.effects.filter(effect => effect.kind === 'bubble')
  const sweat = snapshot.effects.filter(effect => effect.kind === 'sweat')

  return (
    <div ref={rootRef} className={styles.layer} style={{ pointerEvents: 'none' }}>
      <div
        ref={petRef}
        className={styles.pet}
        data-whale-activity={snapshot.activity.mood}
        data-whale-bridge={snapshot.bridge}
      >
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
        {hearts.map(heart => (
          <HeartPair key={heart.id} id={heart.id} />
        ))}
        {bubbles.map(bubble => (
          <span
            key={bubble.id}
            className={styles.bubble}
            style={{ '--bubble-drift': `${((bubble.id % 3) - 1) * 12}px`, '--bubble-scale': `${0.8 + (bubble.id % 3) * 0.2}` } as React.CSSProperties}
            aria-hidden="true"
          />
        ))}
        {sweat.map(drop => (
          <span key={drop.id} className={styles.sweat} aria-hidden="true">💧</span>
        ))}
        {sleeping ? (
          <>
            <span key="zzz-1" className={`${styles.sleepMark} ${styles.sleepMarkOne}`} aria-hidden="true">z</span>
            <span key="zzz-2" className={`${styles.sleepMark} ${styles.sleepMarkTwo}`} aria-hidden="true">Z</span>
            <span key="zzz-3" className={`${styles.sleepMark} ${styles.sleepMarkThree}`} aria-hidden="true">Z</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

function HeartPair({ id }: { id: number }): React.ReactElement {
  return (
    <>
      <span key={`${id}-left`} className={`${styles.heart} ${styles.heartLeft}`} aria-hidden="true">♥</span>
      <span key={`${id}-right`} className={`${styles.heart} ${styles.heartRight}`} aria-hidden="true">♥</span>
    </>
  )
}

export type { WhaleEffect }
