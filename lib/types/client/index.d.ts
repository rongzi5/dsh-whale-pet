/** Persistent browser plugin for the frame-wide 3D whale pet. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
declare module "@deepseek-ai/dsh-client-ui-slots" {
    interface SlotMap {
        "shell.overlay": {
            kind: "list";
            scope: "root";
        };
    }
}
export { WhaleMotionController, type WhaleMotionFrame } from './motion.ts';
export { WhalePet, type WhalePetProps } from './WhalePet.tsx';
export { SessionWhaleObserver, deriveWhaleActivity } from './runtime/session-observer.ts';
export { WhalePetService, type WhaleHitZone } from './runtime/whale-pet-service.ts';
export { WhalePetChat } from './runtime/whale-pet-chat.ts';
export { loadWhalePetState, saveWhalePetState, WHALE_PET_DEFAULTS, type WhalePetPersistedState } from './persistence.ts';
export type { WhaleActivity, WhaleEffect, WhaleEffectKind, WhaleMood, WhaleRecap } from './activity.ts';
export type { WhaleExternalState, WhaleScene } from './whale/scene.ts';
/** Required services: slot registry plus Session and Conversation state bridges. */
export declare const inject: string[];
/** Mount the runtime service and register one additive shell-overlay entry. */
export declare function apply(ctx: ClientContext): void;
