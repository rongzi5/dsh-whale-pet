/**
 * Whale pet chat coordinator: ties the browser LLM transport to the runtime
 * service and the memory store.
 *
 * One `ask()` runs a full interaction: wake the pet, hold the `thinking`
 * mood through the request (via the service's external-mood override, which
 * the session observer respects), show the reply as a long-lived bubble,
 * extract `[记住]` facts into memory and persist the new turns.
 *
 * The selected model and reasoning effort are persisted per user and sent
 * with every request; the chat bubble UI reads/writes them through
 * {@link getPreferences} / {@link setPreferences}.
 */
import { WhalePetService } from './whale-pet-service.ts';
import { type WhaleChatOptions, type WhaleChatTransport, type WhaleModelCatalog } from '../llm.ts';
import { type WhaleSessionProgress } from '../progress.ts';
import { type StorageLike } from '../persistence.ts';
/** Persisted chat preferences (model + reasoning effort). */
export interface WhaleChatPreferences {
    provider: string;
    model: string;
    effort?: string;
}
/** How the pet addresses the failure bubble; shown verbatim. */
export declare const CHAT_FAILURE_BUBBLE = "\u545C\u2026\u2026 \u6211\u8FDE\u4E0D\u4E0A\u5927\u8111\u4E86";
/** Read the persisted model/effort preferences, with validation. */
export declare function loadChatPreferences(storage: StorageLike | null): WhaleChatPreferences | null;
/** Persist the model/effort preferences. */
export declare function saveChatPreferences(storage: StorageLike | null, preferences: WhaleChatPreferences): void;
export declare class WhalePetChat {
    private readonly service;
    private readonly storage;
    private readonly transport;
    private readonly progressProvider;
    private busy;
    constructor(service: WhalePetService, storage?: StorageLike | null, transport?: WhaleChatTransport, progressProvider?: (() => WhaleSessionProgress | null) | null);
    /** Whether a chat request is currently in flight (guards re-entry). */
    get isBusy(): boolean;
    /**
     * One-line live progress bubble ("正在跑 bash，已经 3 分钟"), or null when
     * the agent is idle. Used by the click recap so a long-running task can be
     * checked without typing.
     */
    getProgressText(): string | null;
    /** The persisted model/effort preferences, or null. */
    getPreferences(): WhaleChatPreferences | null;
    /** Persist model/effort preferences for future chats. */
    setPreferences(preferences: WhaleChatPreferences): void;
    /** The selectable model catalog from the host proxy. */
    listModels(): Promise<WhaleModelCatalog>;
    /** Run one chat turn; safe to call while busy (bubbles a gentle nudge). */
    ask(input: string, options?: WhaleChatOptions): Promise<void>;
    private meta;
}
