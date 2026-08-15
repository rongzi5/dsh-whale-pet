/**
 * Host-side LLM chat proxy for the whale pet.
 *
 * The browser client talks to a same-origin endpoint (`/api/whale-pet/chat`)
 * and this module forwards OpenAI-compatible chat completions to the upstream
 * provider with a server-held API key, so the key never enters the browser.
 * Pure Node logic (no cordis imports) so it stays unit-testable against a
 * local fake upstream.
 *
 * The proxy is backend-agnostic: a `WhaleChatBackend` both lists the selectable
 * models (with their reasoning efforts) and executes one chat. Two backends
 * exist — the direct upstream proxy (`directBackend`) and the dsh LLM service
 * (`LlmBackend` in llm-backend.ts) — and the host entry picks one.
 */
export interface ChatProxyConfig {
    /** Upstream bearer token. */
    apiKey: string;
    /** Upstream origin, e.g. https://api.deepseek.com. */
    baseUrl: string;
    /** Default model name, e.g. deepseek-chat. */
    model: string;
    /** Upstream request timeout in milliseconds. */
    timeoutMs?: number;
}
export interface WhaleChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/** Per-request overrides chosen in the pet's chat bubble. */
export interface WhaleChatOptions {
    provider?: string;
    model?: string;
    /** Adapter-owned reasoning effort id, when the model exposes efforts. */
    effort?: string;
}
/** One selectable reasoning effort for a model. */
export interface WhaleEffortOption {
    id: string;
    name: string;
}
/** One selectable model. */
export interface WhaleModelOption {
    id: string;
    name: string;
    description?: string;
    /** Reasoning efforts in display order; empty = fixed reasoning/no choice. */
    efforts: readonly WhaleEffortOption[];
    /** The effort used when the caller omits one. */
    defaultEffort?: string;
}
/** One selectable provider route. */
export interface WhaleProviderOption {
    id: string;
    name: string;
    models: readonly WhaleModelOption[];
}
/** The catalog served at `/api/whale-pet/models`. */
export interface WhaleModelCatalog {
    providers: readonly WhaleProviderOption[];
    default: {
        provider: string;
        model: string;
    };
}
/** The execution surface the HTTP handler delegates to. */
export interface WhaleChatBackend {
    /** Whether a chat can currently succeed (key present / llm service up). */
    available(): boolean | Promise<boolean>;
    listModels(): Promise<WhaleModelCatalog>;
    chat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): Promise<{
        content: string;
    }>;
}
/** Upstream returned a non-2xx status; carries the observed status. */
export declare class UpstreamError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
/** No usable backend configuration (no key, no llm service). */
export declare class UnconfiguredError extends Error {
    constructor(message: string);
}
/** Resolve the effective direct-proxy config from env + plugin config; null = unusable. */
export declare function resolveChatProxyConfig(env: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}, config?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}): ChatProxyConfig | null;
/**
 * Forward one chat-completions request to the upstream provider and return
 * the assistant text. Throws {@link UpstreamError} on upstream failures.
 */
export declare function forwardChat(config: ChatProxyConfig, messages: readonly WhaleChatMessage[], modelOverride?: string): Promise<{
    content: string;
}>;
/**
 * Direct-upstream backend: the API key is resolved per request from
 * env/plugin config/credentials, and the model catalog is the single
 * configured model (no efforts — the upstream adapter is a plain
 * OpenAI-compatible endpoint).
 */
export declare function directBackend(resolve: () => ChatProxyConfig | null | Promise<ChatProxyConfig | null>): WhaleChatBackend;
/** Bound body-size guard for proxy requests (64 KiB). */
export declare const PROXY_MAX_BODY_BYTES: number;
/** Read and parse a JSON request body, respecting the size cap. */
export declare function readJsonBody(req: {
    headers: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator](): AsyncIterator<Buffer>;
}, limit?: number): Promise<unknown | null>;
/**
 * Build the HTTP handler for the `/api/whale-pet` prefix.
 * Endpoints:
 * - GET  /api/whale-pet/health → { ok, configured }
 * - GET  /api/whale-pet/models  → the selectable model catalog
 * - POST /api/whale-pet/chat   → { content } (with optional provider/model/effort)
 */
export declare function createChatProxyHandler(backend: WhaleChatBackend): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>;
