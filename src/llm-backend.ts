/**
 * dsh-llm backend for the whale pet chat proxy.
 *
 * Wraps the host `ctx.llm` service (the same one the agent uses) so the pet
 * inherits the DSH-configured providers, credentials, retries and reasoning
 * efforts. Model listing surfaces every registered provider's models with
 * their adapter-declared reasoning efforts; chat streams one completion and
 * aggregates the visible text deltas.
 */

import { createAssistantMessage, createUserMessage, ReasoningEffortId, type GenerateOptions, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type {
  WhaleChatBackend,
  WhaleChatMessage,
  WhaleChatOptions,
  WhaleModelCatalog,
  WhaleModelOption,
  WhaleProviderOption,
} from './chat-proxy.ts'

/** Memoized catalog: provider/model/effort topology is static per process. */
export class LlmBackend implements WhaleChatBackend {
  private catalogCache: Promise<WhaleModelCatalog> | null = null

  public constructor(private readonly llm: LlmRuntime) {}

  public available(): boolean {
    return true
  }

  public listModels(): Promise<WhaleModelCatalog> {
    if (this.catalogCache === null) {
      this.catalogCache = this.buildCatalog()
    }
    return this.catalogCache
  }

  public async chat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): Promise<{ content: string }> {
    const text: string[] = []
    for await (const delta of this.streamChat(messages, options)) text.push(delta)
    const content = text.join('').trim()
    if (content === '') throw new Error('llm returned an empty completion')
    return { content }
  }

  public async *streamChat(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): AsyncIterable<string> {
    const request = await this.buildRequest(messages, options)
    for await (const chunk of this.llm.stream(request)) {
      if (chunk.type === 'text-delta') {
        if (chunk.text !== '') yield chunk.text
      } else if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
          throw new Error(`llm stream finished with ${chunk.reason.kind}`)
        }
      }
    }
  }

  private async buildRequest(messages: readonly WhaleChatMessage[], options?: WhaleChatOptions): Promise<GenerateOptions> {
    const catalog = await this.listModels()
    const provider = options?.provider ?? catalog.default.provider
    const model = options?.model ?? catalog.default.model
    const system = messages[0]?.role === 'system' ? messages[0].content : undefined
    const history = system !== undefined ? messages.slice(1) : messages

    const llmMessages = history.map(message => {
      const content = [{ type: 'text' as const, text: message.content }]
      if (message.role === 'assistant') {
        return createAssistantMessage({ content, source: { provider, model } })
      }
      return createUserMessage({ content, source: { kind: 'user' as const } })
    })

    return {
      provider,
      model,
      messages: llmMessages,
      ...(system !== undefined ? { system } : {}),
      ...(options?.effort !== undefined ? { reasoningEffort: ReasoningEffortId(options.effort) } : {}),
    }
  }

  private async buildCatalog(): Promise<WhaleModelCatalog> {
    const providers: WhaleProviderOption[] = []
    for (const provider of this.llm.listProviders()) {
      let models: readonly { id: string; name: string; description?: string }[] = []
      try {
        models = await this.llm.listModels(provider.id)
      } catch {
        continue
      }
      const entries: WhaleModelOption[] = []
      for (const model of models) {
        let efforts: WhaleModelOption['efforts'] = []
        let defaultEffort: string | undefined
        try {
          const resolved = await this.llm.resolveModelInfo(provider.id, model.id)
          efforts = resolved.reasoning?.efforts.map(effort => ({ id: effort.id, name: effort.name })) ?? []
          defaultEffort = resolved.reasoning?.defaultEffort
        } catch {
          // No reasoning metadata for this model; it stays effort-less.
        }
        entries.push({
          id: model.id,
          name: model.name,
          ...(model.description !== undefined ? { description: model.description } : {}),
          efforts,
          ...(defaultEffort !== undefined ? { defaultEffort } : {}),
        })
      }
      if (entries.length > 0) {
        providers.push({ id: provider.id, name: provider.name, models: entries })
      }
    }
    const first = providers[0]?.models[0]
    return {
      providers,
      default: first !== undefined && providers[0] !== undefined
        ? { provider: providers[0].id, model: first.id }
        : { provider: '', model: '' },
    }
  }
}
