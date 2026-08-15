/** Persistent browser plugin for the frame-wide 3D whale pet. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WhalePet, type WhalePetProps } from './WhalePet.tsx'
import { SessionWhaleObserver, type WhaleSessionClientContext } from './runtime/session-observer.ts'
import { WhalePetService } from './runtime/whale-pet-service.ts'

export { WhaleMotionController, type WhaleMotionFrame } from './motion.ts'
export { WhalePet, type WhalePetProps } from './WhalePet.tsx'
export { SessionWhaleObserver, deriveWhaleActivity } from './runtime/session-observer.ts'
export { WhalePetService } from './runtime/whale-pet-service.ts'
export type { WhaleActivity, WhaleEffect, WhaleEffectKind, WhaleMood } from './activity.ts'
export type { WhaleExternalState, WhaleScene } from './whale-scene.ts'

/** Required service: the typed client slot registry. */
export const inject = ['slots']

/** Mount the runtime service and register one additive shell-overlay entry. */
export function apply(ctx: ClientContext): void {
  const whalePet = new WhalePetService()
  const observer = new SessionWhaleObserver(ctx as unknown as WhaleSessionClientContext, whalePet)

  ctx.effect(() => {
    const disposeService = ctx.provide('whalePet', whalePet)
    const disposeSlot = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'whale-pet',
      order: 900,
      label: '3D whale pet',
      inject: () => ({ whalePet }),
    }, WhalePet as unknown as (props: WhalePetProps) => never))
    observer.start()

    return () => {
      disposeSlot()
      observer.dispose()
      disposeService()
      whalePet.dispose()
    }
  }, 'ui-whale-pet: session bridge + overlay')
}
