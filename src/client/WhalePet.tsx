import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react'
import type { WhaleEffect } from './activity.ts'
import { WhalePetService } from './runtime/whale-pet-service.ts'
import type { WhalePetChat } from './runtime/whale-pet-chat.ts'
import type { WhaleChatOptions, WhaleModelCatalog } from './llm.ts'
import styles from './WhalePet.module.css'

export interface WhalePetProps {
  whalePet: WhalePetService
  /** Optional LLM chat coordinator; adds the "和鲸鲸聊天" menu entry. */
  whalePetChat?: WhalePetChat
}

interface WhaleMenuState {
  x: number
  y: number
}

/** The chat input bubble position (fixed, follows where the menu opened). */
type ChatBoxState = WhaleMenuState

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
export function WhalePet({ whalePet, whalePetChat }: WhalePetProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const petRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shadowRef = useRef<HTMLSpanElement | null>(null)
  const chatBoxRef = useRef<HTMLDivElement | null>(null)
  const lastContextMenuAt = useRef(0)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<WhaleMenuState | null>(null)
  const [chatBox, setChatBox] = useState<ChatBoxState | null>(null)
  const [chatText, setChatText] = useState('')
  const [catalog, setCatalog] = useState<WhaleModelCatalog | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [effort, setEffort] = useState('')

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

  // The chat bubble closes on outside presses or Escape.
  //
  // Listens to `mousedown` instead of `click` on purpose: the menu item that
  // opens the bubble dispatches a click, and React may flush the bubble into
  // the DOM before that same click finishes bubbling to document (React 18
  // flushes discrete events synchronously in real browsers). A click-based
  // closer would then treat the menu-item click as an outside click and close
  // the bubble the instant it opens.
  useEffect(() => {
    if (chatBox === null) return
    const close = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && chatBoxRef.current !== null && chatBoxRef.current.contains(target)) return
      setChatBox(null)
    }
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setChatBox(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [chatBox])

  // Load the model catalog (and the persisted selection) when the bubble opens.
  useEffect(() => {
    if (chatBox === null || whalePetChat === undefined) return
    let cancelled = false
    const prefs = whalePetChat.getPreferences()
    if (prefs !== null) {
      setModelKey(`${prefs.provider}::${prefs.model}`)
      if (prefs.effort !== undefined) setEffort(prefs.effort)
    }
    whalePetChat.listModels()
      .then(next => {
        if (cancelled) return
        setCatalog(next)
        setModelKey(current => {
          if (current !== '') {
            const stillThere = next.providers.some(provider => provider.models.some(model => `${provider.id}::${model.id}` === current))
            if (stillThere) return current
          }
          return `${next.default.provider}::${next.default.model}`
        })
      })
      .catch(() => {
        if (!cancelled) setCatalogError('模型列表加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [chatBox, whalePetChat])

  // Keep the effort selection valid for the currently chosen model.
  useEffect(() => {
    if (catalog === null || modelKey === '') return
    const [provider, model] = modelKey.split('::')
    const entry = catalog.providers.find(candidate => candidate.id === provider)?.models.find(candidate => candidate.id === model)
    if (entry === undefined || entry.efforts.length === 0) {
      setEffort('')
      return
    }
    setEffort(current => (current !== '' && entry.efforts.some(candidate => candidate.id === current) ? current : entry.defaultEffort ?? ''))
  }, [catalog, modelKey])

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

  const chat = (): void => {
    if (whalePetChat === undefined || menu === null) return
    setChatBox({ x: menu.x, y: menu.y })
    setChatText('')
    setCatalogError('')
  }

  const sendChat = (): void => {
    const text = chatText.trim()
    if (text === '' || whalePetChat === undefined) return
    const [provider, model] = modelKey.split('::')
    const options: WhaleChatOptions = {}
    if (provider !== undefined && provider !== '' && model !== undefined && model !== '') {
      options.provider = provider
      options.model = model
      if (effort !== '') options.effort = effort
      whalePetChat.setPreferences({ provider, model, ...(effort !== '' ? { effort } : {}) })
    }
    setChatText('')
    setChatBox(null)
    void whalePetChat.ask(text, options)
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
        {snapshot.activity.mood === 'error' ? <span className={styles.errorMark} aria-hidden="true">！</span> : null}
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
          {whalePetChat !== undefined ? (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => { setMenu(null); chat() }}
            >
              和鲸鲸聊天…
            </button>
          ) : null}
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
      {chatBox !== null ? (
        <div
          ref={chatBoxRef}
          className={styles.chatBox}
          style={{ left: chatBox.x, top: chatBox.y }}
          role="dialog"
          aria-label="和鲸鲸聊天"
          data-whale-chat="open"
        >
          <div className={styles.chatRow}>
            <select
              className={styles.chatSelect}
              value={modelKey}
              aria-label="选择模型"
              disabled={catalog === null && catalogError === ''}
              onChange={event => setModelKey(event.target.value)}
            >
              {catalog === null ? (
                <option value="">{catalogError === '' ? '加载模型…' : '模型不可用'}</option>
              ) : (
                catalog.providers.flatMap(provider =>
                  provider.models.map(model => (
                    <option key={`${provider.id}::${model.id}`} value={`${provider.id}::${model.id}`}>
                      {provider.name} · {model.name}
                    </option>
                  )),
                )
              )}
            </select>
            {(() => {
              const [provider, model] = modelKey.split('::')
              const entry = catalog?.providers.find(candidate => candidate.id === provider)?.models.find(candidate => candidate.id === model)
              if (entry === undefined || entry.efforts.length === 0) return null
              return (
                <select
                  className={styles.chatSelect}
                  value={effort}
                  aria-label="思考强度"
                  onChange={event => setEffort(event.target.value)}
                >
                  <option value="">默认</option>
                  {entry.efforts.map(candidate => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
              )
            })()}
          </div>
          <div className={styles.chatRow}>
            <input
              className={styles.chatInput}
              value={chatText}
              autoFocus
              maxLength={200}
              placeholder="对鲸鲸说…"
              onChange={event => setChatText(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') sendChat()
                if (event.key === 'Escape') setChatBox(null)
              }}
            />
            <button
              type="button"
              className={styles.chatSend}
              disabled={chatText.trim() === ''}
              onClick={sendChat}
            >
              发送
            </button>
          </div>
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
