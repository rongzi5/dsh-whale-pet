/** Persistent browser plugin for the frame-wide 3D whale pet. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WhalePet, type WhalePetProps } from './WhalePet.tsx'
import { SessionWhaleObserver, type WhaleSessionClientContext } from './runtime/session-observer.ts'
import { WhalePetService } from './runtime/whale-pet-service.ts'
import { WhalePetChat } from './runtime/whale-pet-chat.ts'
import { browserStorage } from './persistence.ts'

export { WhaleMotionController, type WhaleMotionFrame } from './motion.ts'
export { WhalePet, type WhalePetProps } from './WhalePet.tsx'
export { SessionWhaleObserver, deriveWhaleActivity } from './runtime/session-observer.ts'
export { WhalePetService } from './runtime/whale-pet-service.ts'
export { WhalePetChat } from './runtime/whale-pet-chat.ts'
export { loadWhalePetState, saveWhalePetState, WHALE_PET_DEFAULTS, type WhalePetPersistedState } from './persistence.ts'
export type { WhaleActivity, WhaleEffect, WhaleEffectKind, WhaleMood, WhaleRecap } from './activity.ts'
export type { WhaleExternalState, WhaleScene } from './whale/scene.ts'

/** Required services: slot registry plus the sessions bridge. */
export const inject = ['slots', 'sessions']

/** Mount the runtime service and register one additive shell-overlay entry. */
export function apply(ctx: ClientContext): void {
  console.debug('[ui-whale-pet] client loaded (features: probe, report-mode, task-dispatch, awaiting)')
  const whalePet = new WhalePetService(browserStorage())
  const observer = new SessionWhaleObserver(ctx as unknown as WhaleSessionClientContext, whalePet)
  whalePet.bindObserver(observer)
  const whalePetChat = new WhalePetChat(whalePet, browserStorage(), undefined, () => observer.getProgress())

  ctx.effect(() => {
    /** Ctrl/Cmd + Alt + W toggles the pet's visibility. */
    const hideShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        event.stopPropagation()
        whalePet.toggleHidden()
      }
    }

    const disposeService = ctx.provide('whalePet', whalePet)
    const disposeSlot = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'whale-pet',
      order: 900,
      label: '3D whale pet',
      inject: () => ({ whalePet, whalePetChat }),
    }, WhalePet as unknown as (props: WhalePetProps) => never))
    observer.start()
    // Headless (node) tests run apply without a window; the shortcut is
    // browser-only.
    const hasWindow = typeof window !== 'undefined'
    if (hasWindow) window.addEventListener('keydown', hideShortcut)

    return () => {
      if (hasWindow) window.removeEventListener('keydown', hideShortcut)
      disposeSlot()
      observer.dispose()
      disposeService()
      whalePet.dispose()
    }
  }, 'ui-whale-pet: session bridge + overlay')
}
