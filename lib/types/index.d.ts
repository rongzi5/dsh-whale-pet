/**
 * Host-side entry for the whale pet: an LLM chat proxy.
 *
 * Registers the `/api/whale-pet` prefix on the web server:
 * - GET  /api/whale-pet/health → { ok, configured }
 * - GET  /api/whale-pet/models  → selectable models + reasoning efforts
 * - POST /api/whale-pet/chat   → { content } (provider/model/effort optional)
 *
 * The browser pet only ever talks to this same-origin surface, so no API key
 * and no cross-origin request leaves the harness page.
 *
 * Backend selection: when the dsh `ctx.llm` service is available the proxy
 * uses it (DSH-configured providers, credentials, retries, reasoning
 * efforts); otherwise it falls back to the direct OpenAI-compatible upstream
 * with a key from plugin config / env / the dsh credentials service.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Optional per-deployment overrides; env vars are the fallback. */
export interface WhalePetHostConfig {
    /** Upstream API key (env: DSH_WHALE_API_KEY / DEEPSEEK_API_KEY). */
    apiKey?: string;
    /** Upstream origin (env: DSH_WHALE_API_BASE; default https://api.deepseek.com). */
    baseUrl?: string;
    /** Default model (env: DSH_WHALE_API_MODEL; default deepseek-chat). */
    model?: string;
}
/**
 * Required services. `webServer` hosts the routes; `llm`, `credentials`,
 * `sessions`, `jobs` and `agents` are declared so the proxy can
 * use the DSH LLM service, credentials, session store, job registry and
 * subagent machinery — cordis forbids accessing undeclared services from
 * plugin scope, so a try/catch alone silently degrades to the fallback.
 */
export declare const inject: string[];
/** Mount the chat proxy routes. */
export declare function apply(ctx: Context, config?: WhalePetHostConfig): void;
