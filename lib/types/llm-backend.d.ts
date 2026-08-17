/**
 * dsh-llm backend for the whale pet chat proxy.
 *
 * Wraps the host `ctx.llm` service (the same one the agent uses) so the pet
 * inherits the DSH-configured providers, credentials, retries and reasoning
 * efforts. Model listing surfaces every registered provider's models with
 * their adapter-declared reasoning efforts; chat streams one completion and
 * aggregates the visible text deltas.
 */
import { type LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { WhaleChatBackend, WhaleChatMessage, WhaleChatOptions, WhaleModelCatalog } from './chat-proxy.ts';
/** Memoized catalog: provider/model/effort topology is static per process. */
export declare class LlmBackend implements WhaleChatBackend {
    private readonly llm;
    private catalogCache;
    constructor(llm: LlmRuntime);
    available(): boolean;
    listModels(): Promise<WhaleModelCatalog>;
    chat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): Promise<{
        content: string;
    }>;
    streamChat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): AsyncIterable<string>;
    private buildRequest;
    private buildCatalog;
}
