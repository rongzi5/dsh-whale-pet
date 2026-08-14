/** Persistent browser plugin for the frame-wide 3D whale pet. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WhalePet } from './WhalePet.tsx'

export { WhaleMotionController, type WhaleMotionFrame } from './motion.ts'
export { WhalePet } from './WhalePet.tsx'
export type { WhaleExternalState, WhaleScene } from './whale-scene.ts'

/** Required service: the typed client slot registry. */
export const inject = ['slots']

/** Register one additive, frame-wide pet entry in the shell overlay. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'whale-pet',
    order: 900,
    label: '3D whale pet',
  }, WhalePet))
}
