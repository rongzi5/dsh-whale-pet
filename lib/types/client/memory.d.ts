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
}
export declare const WHALE_MEMORY_KEY = "dsh.whale-pet.memory.v1";
export declare const FACTS_LIMIT = 64;
export declare const TURNS_LIMIT = 12;
export declare const FACT_MAX_LENGTH = 120;
export declare const TURN_MAX_LENGTH = 600;
export declare const WHALE_MEMORY_DEFAULTS: Readonly<WhaleMemory>;
/** Read and validate the persisted memory; any failure falls back to defaults. */
export declare function loadWhaleMemory(storage: StorageLike | null): WhaleMemory;
/** Persist the memory; storage failures degrade silently (keep running). */
export declare function saveWhaleMemory(storage: StorageLike | null, memory: WhaleMemory): void;
/** Add new facts (deduped, capped at {@link FACTS_LIMIT}, oldest dropped). */
export declare function rememberFacts(memory: WhaleMemory, facts: readonly string[]): WhaleMemory;
/** Append one conversation turn (capped at {@link TURNS_LIMIT}, oldest dropped). */
export declare function appendTurn(memory: WhaleMemory, role: 'user' | 'assistant', text: string): WhaleMemory;
/**
 * The pet persona + memory block handed to the model as the system prompt.
 * Instructs the model to report memorable facts with the `[记住]` protocol.
 * When the agent is busy, a live progress block is appended so the pet can
 * truthfully answer "进度如何了" (the block is read-only session state; the
 * DSH conversation itself is never touched).
 */
export declare function buildSystemPrompt(memory: WhaleMemory, meta: {
    name: string;
    days: number;
}, progress?: WhaleSessionProgress | null): string;
/** Extract `[记住] <fact>` lines from a model reply. */
export declare function extractFacts(reply: string): string[];
/** Strip `[记住] ...` marker lines so they never show in the bubble. */
export declare function stripMemoryMarkers(reply: string): string;
/** Assemble the full request: system persona + recent turns + the new input. */
export declare function buildChatMessages(memory: WhaleMemory, meta: {
    name: string;
    days: number;
}, input: string, progress?: WhaleSessionProgress | null): WhaleChatMessage[];
