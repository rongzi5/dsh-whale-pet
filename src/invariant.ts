/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-whale-pet`.
 * @module @deepseek-ai/dsh-client-ui-whale-pet/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-whale-pet'

/** Cordis companion plugin name. */
export const name = 'client-ui-whale-pet-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: lifecycle tests prove the sole overlay and frame loop unwind with the plugin fiber. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
