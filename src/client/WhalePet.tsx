import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react'
import type { WhaleEffect } from './activity.ts'
import { WhalePetService } from './runtime/whale-pet-service.ts'
import styles from './WhalePet.module.css'

export interface WhalePetProps {
  whalePet: WhalePetService
}

interface WhaleMenuState {
  x: number
  y: number
}

const MENU_WIDTH = 156
const MENU_HEIGHT = 176
/** Ignore the click that browsers fire right after a context menu. */
const CLICK_AFTER_CONTEXT_MENU_MS = 400
/** How long the pet keeps listening after the input loses focus. */
const USER_TYPING_BLUR_DELAY_MS = 800

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return true
  return target.isContentEditable
}

/** The frame-wide interactive whale pet surface (view only). */
export function WhalePet({ whalePet }: WhalePetProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shadowRef = useRef<HTMLSpanElement | null>(null)
  const lastContextMenuAt = useRef(0)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<WhaleMenuState | null>(null)

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

    const started = whalePet.mount(
      { root, pet, canvas, shadow },
      {
        onError: setError,
        onRelease: (x, y) => whalePet.persistPosition(x, y),
      },
    )
    if (!started) return

    return () => {
      whalePet.unmount()
    }
  }, [whalePet])

  // Close the context menu on outside clicks, Escape, or window blur.
  useEffect(() => {
    if (menu === null) return
    const close = (): void => setMenu(null)
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // The pet listens (floating "？") only while the user is composing a reply
  // in the chat input; a short grace period avoids flicker when focus moves
  // between the input and its toolbar.
  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | null = null
    const onFocusIn = (event: globalThis.FocusEvent): void => {
      if (!isEditableTarget(event.target)) return
      if (blurTimer !== null) {
        clearTimeout(blurTimer)
        blurTimer = null
      }
      whalePet.setUserTyping(true)
    }
    const onFocusOut = (): void => {
      if (blurTimer !== null) clearTimeout(blurTimer)
      blurTimer = setTimeout(() => {
        whalePet.setUserTyping(false)
      }, USER_TYPING_BLUR_DELAY_MS)
    }
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      if (blurTimer !== null) clearTimeout(blurTimer)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
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

  const click = (event: ReactMouseEvent<HTMLElement>): void => {
    event.stopPropagation()
    if (Date.now() - lastContextMenuAt.current < CLICK_AFTER_CONTEXT_MENU_MS) return
    if (whalePet.wasClick() === true) whalePet.nextRecap()
  }

  const openMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    lastContextMenuAt.current = Date.now()
    const maxX = (window.innerWidth ?? 0) - MENU_WIDTH - 8
    const maxY = (window.innerHeight ?? 0) - MENU_HEIGHT - 8
    setMenu({
      x: Math.max(8, Math.min(event.clientX, maxX)),
      y: Math.max(8, Math.min(event.clientY, maxY)),
    })
  }

  const rename = (): void => {
    const next = window.prompt('给鲸鲸起个新名字：', snapshot.name)
    if (next !== null) whalePet.setName(next)
  }

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    whalePet.nextRecap()
  }

  const zoneEvents = {
    onPointerEnter: pointerEnter,
    onPointerLeave: pointerLeave,
    onPointerDown: pointerDown,
    onClick: click,
    onContextMenu: openMenu,
  }
  const sleeping = snapshot.activity.mood === 'sleeping'
  const listening = snapshot.activity.mood === 'listening'
  const hearts = snapshot.effects.filter(effect => effect.kind === 'heart')
  const bubbles = snapshot.effects.filter(effect => effect.kind === 'bubble')
  const sweat = snapshot.effects.filter(effect => effect.kind === 'sweat')

  return (
    <div
      ref={rootRef}
      className={`${styles.layer}${snapshot.hidden ? ` ${styles.hidden}` : ''}`}
      style={{ pointerEvents: 'none' }}
    >
      <div
        ref={petRef}
        className={styles.pet}
        data-whale-activity={snapshot.activity.mood}
        data-whale-bridge={snapshot.bridge}
        data-whale-tool={snapshot.currentTool ?? ''}
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
        {snapshot.recap !== null ? (
          <div key={snapshot.recap.id} className={styles.speech} role="status">
            {snapshot.recap.text}
          </div>
        ) : null}
        {listening ? <span className={styles.listeningMark} aria-hidden="true">？</span> : null}
        {error === '' ? null : <div className={styles.error}>{error}</div>}
        {hearts.map(heart => (
          <HeartPair key={heart.id} id={heart.id} />
        ))}
        {bubbles.map(bubble => (
          <span
            key={bubble.id}
            className={styles.bubble}
            style={{
              left: `${bubble.origin?.x ?? 42}px`,
              top: `${bubble.origin?.y ?? 74}px`,
              '--bubble-drift': `${((bubble.id % 3) - 1) * 12}px`,
              '--bubble-scale': `${0.8 + (bubble.id % 3) * 0.2}`,
            } as React.CSSProperties}
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
      {menu !== null ? (
        <div className={styles.menu} style={{ left: menu.x, top: menu.y }} role="menu" aria-label="鲸鲸菜单">
          <button type="button" className={styles.menuItem} onClick={() => { setMenu(null); rename() }}>命名…</button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => { setMenu(null); whalePet.setSnapToCorner(!snapshot.snapToCorner) }}
          >
            {snapshot.snapToCorner ? '关闭角落吸附' : '开启角落吸附'}
          </button>
          <button type="button" className={styles.menuItem} onClick={() => { setMenu(null); whalePet.snapToCornerNow() }}>回到角落</button>
          <button type="button" className={styles.menuItem} onClick={() => { setMenu(null); whalePet.setHidden(true) }}>隐藏（Ctrl+Alt+W 恢复）</button>
        </div>
      ) : null}
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
