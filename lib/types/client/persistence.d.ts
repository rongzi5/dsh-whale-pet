/**
 * Safe localStorage-backed persistence for the whale pet's user state.
 *
 * Every access is guarded: browsers can throw in private mode or when storage
 * is disabled, so the module degrades to in-memory defaults instead of
 * crashing the pet. All values are validated on load, so a hand-edited or
 * version-skewed payload cannot corrupt the runtime state.
 */
export interface WhalePetPersistedState {
    /** User-given name shown in recap bubbles. */
    name: string;
    /** Whether the pet is hidden by the keyboard shortcut. */
    hidden: boolean;
    /** Whether released drags glide to the nearest corner. */
    snapToCorner: boolean;
    /** Last pet position (CSS pixels, pet top-left); null = default edge rest. */
    x: number | null;
    y: number | null;
    /** ISO timestamp of the first run; drives the "days together" recap. */
    since: string;
    /** Local calendar day (`YYYY-MM-DD`) of the last unsolicited greeting. */
    lastGreetDay: string;
}
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export declare const WHALE_PET_DEFAULTS: Readonly<WhalePetPersistedState>;
/** Read and validate the persisted state; any failure falls back to defaults. */
export declare function loadWhalePetState(storage: StorageLike | null): WhalePetPersistedState;
/** Merge a patch over the current persisted state and write it back. */
export declare function saveWhalePetState(storage: StorageLike | null, patch: Partial<WhalePetPersistedState>): void;
/** The browser's localStorage when available; null otherwise. */
export declare function browserStorage(): StorageLike | null;
/** Local calendar day key used to rate-limit unsolicited greetings. */
export declare function localDayKey(now?: number): string;
/** Whole days since the first run (0 on the first day, 0 for unknown dates). */
export declare function daysSince(since: string, now?: number): number;
