/** Persistent browser plugin for the frame-wide 3D whale pet. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export { WhaleMotionController, type WhaleMotionFrame } from './motion.ts';
export { WhalePet, type WhalePetProps } from './WhalePet.tsx';
export { SessionWhaleObserver, deriveWhaleActivity } from './runtime/session-observer.ts';
export { WhalePetService } from './runtime/whale-pet-service.ts';
export type { WhaleActivity, WhaleEffect, WhaleEffectKind, WhaleMood } from './activity.ts';
export type { WhaleExternalState, WhaleScene } from './whale-scene.ts';
/** Required services: slot registry plus the sessions bridge. */
export declare const inject: string[];
/** Mount the runtime service and register one additive shell-overlay entry. */
export declare function apply(ctx: ClientContext): void;
