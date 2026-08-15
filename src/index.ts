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

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { createChatProxyHandler, directBackend, resolveChatProxyConfig, type WhaleChatBackend } from './chat-proxy.ts'
import { LlmBackend } from './llm-backend.ts'
import { createProgressHandler } from './session-progress.ts'
import { createTaskHandler } from './subagent-task.ts'

/** Optional per-deployment overrides; env vars are the fallback. */
export interface WhalePetHostConfig {
  /** Upstream API key (env: DSH_WHALE_API_KEY / DEEPSEEK_API_KEY). */
  apiKey?: string
  /** Upstream origin (env: DSH_WHALE_API_BASE; default https://api.deepseek.com). */
  baseUrl?: string
  /** Default model (env: DSH_WHALE_API_MODEL; default deepseek-chat). */
  model?: string
}

/**
 * Required services. `webServer` hosts the routes; `llm`, `credentials`,
 * `sessions`, `jobs`, `subagents` and `agents` are declared so the proxy can
 * use the DSH LLM service, credentials, session store, job registry and
 * subagent machinery — cordis forbids accessing undeclared services from
 * plugin scope, so a try/catch alone silently degrades to the fallback.
 */
export const inject = ['webServer', 'llm', 'credentials', 'sessions', 'jobs', 'subagents', 'agents']

/** Read `ctx.credentials` defensively (declared via inject, still guarded). */
function safeCredentials(ctx: Context): CredentialProvider | null {
  try {
    return ctx.credentials
  } catch {
    return null
  }
}

/** Read `ctx.llm` defensively (declared via inject, still guarded). */
function safeLlm(ctx: Context): LlmRuntime | null {
  try {
    return ctx.llm
  } catch {
    return null
  }
}

/** Read `ctx.sessions` (the host session store) defensively. */
function safeSessions(ctx: Context): SessionStore | null {
  try {
    return ctx.sessions ?? null
  } catch {
    return null
  }
}

/** Read `ctx.jobs` (the background job registry) defensively. */
function safeJobs(ctx: Context): JobRegistry | null {
  try {
    return ctx.jobs ?? null
  } catch {
    return null
  }
}

/** Read `ctx.subagents` defensively. */
function safeSubagents(ctx: Context): SubagentRuntime | null {
  try {
    return ctx.subagents ?? null
  } catch {
    return null
  }
}

/** Read `ctx.agents` defensively. */
function safeAgents(ctx: Context): AgentRegistry | null {
  try {
    return ctx.agents ?? null
  } catch {
    return null
  }
}

/** Read `ctx.workspaceRegistry` defensively. */
function safeWorkspaces(ctx: Context): WorkspaceRegistry | null {
  try {
    return ctx.workspaceRegistry ?? null
  } catch {
    return null
  }
}

/** Mount the chat proxy routes. */
export function apply(ctx: Context, config?: WhalePetHostConfig): void {
  const credentials = safeCredentials(ctx)
  const llm = safeLlm(ctx)

  const resolveDirect = async (): Promise<ReturnType<typeof resolveChatProxyConfig>> => {
    const env = {
      apiKey: process.env.DSH_WHALE_API_KEY ?? process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DSH_WHALE_API_BASE,
      model: process.env.DSH_WHALE_API_MODEL,
    }
    const direct = resolveChatProxyConfig(env, config)
    if (direct !== null) return direct
    if (credentials !== null) {
      try {
        const resolved = await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))
        if (resolved !== undefined && resolved.value !== '') {
          return resolveChatProxyConfig({ ...env, apiKey: resolved.value })
        }
      } catch {
        // The credentials service failed; fall through to the 503 path.
      }
    }
    return null
  }

  const backend: WhaleChatBackend = llm !== null ? new LlmBackend(llm) : directBackend(resolveDirect)
  const sessions = safeSessions(ctx)
  const jobs = safeJobs(ctx)
  const subagents = safeSubagents(ctx)
  const agents = safeAgents(ctx)
  const workspaces = safeWorkspaces(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/whale-pet',
    handler: createChatProxyHandler(backend),
  }), 'ui-whale-pet: chat proxy')

  // Exact route wins over the chat prefix; fine-grained progress for the pet.
  if (sessions !== null) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/whale-pet/progress',
      handler: createProgressHandler(sessions, jobs),
    }), 'ui-whale-pet: session progress')
  }

  // Subagent task dispatch: the pet can spawn a real child conversation.
  if (subagents !== null && agents !== null) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/api/whale-pet/task',
      handler: createTaskHandler(subagents, agents, () => workspaces?.list()[0]?.path),
    }), 'ui-whale-pet: subagent task')
  }

  void Promise.resolve(backend.available()).then(configured => {
    if (configured) {
      console.log(`[ui-whale-pet] chat proxy mounted at /api/whale-pet (backend: ${llm !== null ? 'dsh llm service' : 'direct upstream'})`)
    } else {
      console.warn('[ui-whale-pet] chat proxy mounted at /api/whale-pet without an API key — set DSH_WHALE_API_KEY (or DEEPSEEK_API_KEY) or the plugin config.apiKey')
    }
  })
}
