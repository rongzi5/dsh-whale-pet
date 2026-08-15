/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-whale-pet`.
 * @module @deepseek-ai/dsh-client-ui-whale-pet/invariant
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "client-ui-whale-pet-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/** Register this package's invariant companion. */
export declare const apply: (ctx: Context) => Promise<() => void>;
