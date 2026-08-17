/**
 * Whale pet long-term memory: facts about the user plus a bounded recent
 * conversation, persisted through the same guarded StorageLike channel as the
 * rest of the pet state.
 *
 * Memory protocol: the system prompt asks the model to end a reply with
 * `[记住] <fact>` lines when the user reveals something worth keeping. The
 * chat coordinator strips those markers before showing the bubble and stores
 * the extracted facts here.
 */
import type { StorageLike } from './persistence.ts';
import type { WhaleChatMessage } from './llm.ts';
import { type WhaleSessionProgress } from './progress.ts';
export interface WhaleMemory {
    /** Long-term facts about the user, newest last. */
    facts: string[];
    /** Recent turns in chronological order (user/assistant interleaved). */
    turns: Array<{
        role: 'user' | 'assistant';
        text: string;
    }>;
    /**
     * Compacted digest of turns evicted by the turn cap: instead of dropping
     * old turns outright, their text is folded into this bounded summary so
     * long conversations keep a coarse memory of what was discussed.
     */
    summary?: string;
}
/**
 * Bounded pet context: keep the pet's own LLM request compact so it never
 * grows unwieldy in long conversations. Worst case ≈ 24 facts × 80 chars +
 * 8 turns × 240 chars + 400-char summary + persona ≈ 4.4 KB (~1.3k tokens).
 */
export declare const WHALE_MEMORY_KEY = "dsh.whale-pet.memory.v1";
export declare const FACTS_LIMIT = 24;
export declare const TURNS_LIMIT = 8;
export declare const FACT_MAX_LENGTH = 80;
export declare const TURN_MAX_LENGTH = 240;
export declare const SUMMARY_MAX_LENGTH = 400;
export declare const WHALE_MEMORY_DEFAULTS: Readonly<WhaleMemory>;
/** Read and validate the persisted memory; any failure falls back to defaults. */
export declare function loadWhaleMemory(storage: StorageLike | null): WhaleMemory;
/** Persist the memory; storage failures degrade silently (keep running). */
export declare function saveWhaleMemory(storage: StorageLike | null, memory: WhaleMemory): void;
/** Add new facts (deduped, capped at {@link FACTS_LIMIT}, oldest dropped). */
export declare function rememberFacts(memory: WhaleMemory, facts: readonly string[]): WhaleMemory;
/**
 * Append one conversation turn. When the turn cap is exceeded the evicted
 * oldest turns are compacted into {@link WhaleMemory.summary} instead of
 * being dropped outright, so long conversations keep a coarse digest.
 */
export declare function appendTurn(memory: WhaleMemory, role: 'user' | 'assistant', text: string): WhaleMemory;
/** Questions that ask about task progress → switch the pet to report mode. */
export declare const PROGRESS_QUERY_PATTERN: RegExp;
/**
 * The pet persona + memory block handed to the model as the system prompt.
 * Instructs the model to report memorable facts with the `[记住]` protocol.
 * When the agent is busy, a live progress block is appended so the pet can
 * truthfully answer "进度如何了" (the block is read-only session state; the
 * DSH conversation itself is never touched).
 *
 * `progressQuery` switches the persona to report mode: the default persona
 * (cute, ≤60 chars) tends to compress probed data into vague cuteness, so a
 * progress question gets a persona that quotes the concrete numbers instead.
 */
export declare function buildSystemPrompt(memory: WhaleMemory, meta: {
    name: string;
    days: number;
}, progress?: WhaleSessionProgress | null, progressQuery?: boolean): string;
/** Extract `[记住] <fact>` lines from a model reply. */
export declare function extractFacts(reply: string): string[];
/**
 * Pull first-person facts out of the user's own message so memory does not
 * depend on the model emitting `[记住]`. Models under the 60-char persona
 * often say "记住了" without the marker.
 */
export declare function extractUserFacts(input: string): string[];
/** Strip `[记住] ...` marker lines so they never show in the bubble. */
export declare function stripMemoryMarkers(reply: string): string;
/** Assemble the full request: system persona + recent turns + the new input. */
export declare function buildChatMessages(memory: WhaleMemory, meta: {
    name: string;
    days: number;
}, input: string, progress?: WhaleSessionProgress | null, progressQuery?: boolean): WhaleChatMessage[];
/** Remove one remembered fact (exact match after trim). Returns the next memory. */
export declare function forgetFact(memory: WhaleMemory, fact: string): WhaleMemory;
