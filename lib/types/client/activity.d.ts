/**
 * Pure vocabulary for whale pet behavior. Shared by the motion controller,
 * the Three.js scene and the runtime services without importing any platform
 * code, so the whole behavior state machine stays unit-testable.
 */
export type WhaleMood = 
/** No session activity: the original relaxed edge-habitat behavior. */
'idle'
/** Assistant text or reasoning is streaming in. */
 | 'thinking'
/** At least one tool call is currently running. */
 | 'working'
/** A single turn has been active for a long time. */
 | 'focused'
/** A long turn, goal, or plan just completed. */
 | 'celebrating'
/** A tool call or turn failed. */
 | 'error'
/** A vigorous or prolonged drag left the pet temporarily disoriented. */
 | 'dizzy'
/** No activity for a long time. */
 | 'sleeping'
/** The user is composing a reply in the chat input. */
 | 'listening'
/** The session is blocked on the user (approval, question, or plan review). */
 | 'awaiting';
export interface WhaleActivity {
    mood: WhaleMood;
    /** 0..1 strength of the mood; sleep/error use it as a transient display weight. */
    intensity: number;
}
export type WhaleEffectKind = 'heart' | 'bubble' | 'sweat';
export interface WhaleEffect {
    id: number;
    kind: WhaleEffectKind;
    /** Local emission point inside the pet box, e.g. the whale's mouth. */
    origin?: {
        x: number;
        y: number;
    };
}
/** Session-bridge lifecycle, surfaced for diagnostics and DOM inspection. */
export type WhaleBridgeState = 'off' | 'waiting' | 'bound';
/** One recap bubble shown after a click: a name/days entry or a session event. */
export interface WhaleRecap {
    id: number;
    /** Stable key used to restart the bubble animation per entry. */
    text: string;
}
/** Stable view snapshot consumed through useSyncExternalStore. */
export interface WhalePetViewSnapshot {
    activity: WhaleActivity;
    effects: readonly WhaleEffect[];
    bridge: WhaleBridgeState;
    /** Persisted user-given name. */
    name: string;
    /** Whether the pet is hidden by the keyboard shortcut. */
    hidden: boolean;
    /** Whether released drags glide to the nearest corner. */
    snapToCorner: boolean;
    /** The recap bubble currently visible, or null. */
    recap: WhaleRecap | null;
}
export declare const IDLE_ACTIVITY: WhaleActivity;
/**
 * Moods where the agent is actively doing something (wake the pet, advance
 * the look/patrol clocks, keep patrols near an edge).
 */
export declare const ACTIVE_MOODS: ReadonlySet<WhaleMood>;
/**
 * Moods where the pet engages with the live session (gaze toward the input
 * area). A strict subset of {@link ACTIVE_MOODS}: celebration is active but
 * does not keep staring at the input box.
 */
export declare const SESSION_ENGAGED_MOODS: ReadonlySet<WhaleMood>;
export declare function isActiveMood(mood: WhaleMood): boolean;
export declare function isSessionEngaged(mood: WhaleMood): boolean;
export declare function sameActivity(left: WhaleActivity, right: WhaleActivity): boolean;
