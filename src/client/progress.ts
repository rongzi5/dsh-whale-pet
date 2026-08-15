/**
 * Whale pet session-progress vocabulary: a read-only summary of what the DSH
 * agent is doing right now, derived from the session projection (coarse,
 * observer) and the host event log (fine, `/api/whale-pet/progress`). Pure
 * functions so the bubble text and the prompt block stay unit-testable.
 *
 * This never writes to the DSH session — the pet only reads progress so long
 * chats are not disturbed.
 */

/** One read-only snapshot of the bound session's live state. */
export interface WhaleSessionProgress {
  /** Session id this snapshot belongs to (for the fine-grained host fetch). */
  sessionId?: string
  /** Whether the agent is doing something right now (running/partial/calls). */
  active: boolean
  /** Whether the turn is still streaming (vs. idle between turns). */
  running: boolean
  /** Names of the tools currently in flight (unknown names become "tool"). */
  tools: readonly string[]
  /** Milliseconds the current turn has been running (0 while idle). */
  turnMs: number
  /** Number of conversation nodes committed so far. */
  nodeCount: number
  /** Name of the most recent tool call node, when known. */
  lastTool?: string
  /** Current goal projection phase, when bound. */
  goalPhase?: string
  /** Whether a plan is active, when bound. */
  planActive?: boolean
  /** Fine-grained: current step number within the turn (host event log). */
  step?: number
  /** Fine-grained: human line for the latest activity (tool call / output). */
  lastActivity?: string
  /** Fine-grained: truncated summary of the latest tool result. */
  lastSummary?: string
  /** Fine-grained: running background jobs probed from the jobs registry. */
  jobs?: ReadonlyArray<{
    label: string
    startedAt: number
    outputTail?: string
  }>
}

/** Tool-name → playful-but-clear activity phrasing, first match wins. */
const TOOL_FLAVOR: ReadonlyArray<readonly [RegExp, string]> = [
  [/bash|terminal|shell|pwsh|powershell|cmd/i, '正在鼓捣终端'],
  [/web[_ ]?search|browser|fetch|http|curl/i, '正在网上冲浪'],
  [/fs|file|read|write|edit|grep|glob/i, '正在翻文件'],
  [/skill/i, '正在翻技能手册'],
  [/subagent|agent/i, '正在指挥小伙伴'],
  [/goal|todo/i, '正在盘计划'],
  [/ask[_ ]?user/i, '正在想问你问题'],
  [/llm|model|chat/i, '正在想事情'],
]

function flavorTool(name: string): string {
  for (const [pattern, phrase] of TOOL_FLAVOR) {
    if (pattern.test(name)) return phrase
  }
  return '正在忙活'
}

/** Elapsed minutes for a job, clamped to at least 1. */
function elapsedMinutes(startedAt: number, now = Date.now()): number {
  return Math.max(1, Math.round((now - startedAt) / 60_000))
}

/**
 * One-line human bubble. A running background job is the most concrete
 * "progress" the pet found, so it wins over the in-flight tool phrasing:
 * "正在后台跑 npm run build（已 5 分钟）" / "正在鼓捣终端（bash），已经 3 分钟" /
 * "正在深度思考…" / "刚跑完 bash".
 */
export function progressToText(progress: WhaleSessionProgress | null): string | null {
  if (progress === null || !progress.active) return null
  if (progress.running) {
    const job = progress.jobs?.[0]
    if (job !== undefined) {
      return `正在后台跑 ${job.label}（已 ${elapsedMinutes(job.startedAt)} 分钟）`
    }
    const minutes = Math.max(1, Math.round(progress.turnMs / 60_000))
    const time = `已经 ${minutes} 分钟`
    if (progress.tools.length > 0) {
      const tools = progress.tools.join('、')
      return `${flavorTool(progress.tools[0] ?? '')}（${tools}），${time}`
    }
    return `正在深度思考…（${time}）`
  }
  if (progress.lastTool !== undefined) {
    return `刚跑完 ${progress.lastTool}`
  }
  return '正在忙'
}

/**
 * Structured progress block appended to the pet's system prompt so the LLM
 * can truthfully answer "进度如何了" without ever touching the session.
 */
export function buildProgressContext(progress: WhaleSessionProgress | null): string | null {
  if (progress === null || !progress.active) return null
  const lines: string[] = [
    '当前 DSH 会话状态（这是桌宠实时探寻到的真实数据）：',
    '如果用户询问进度，请引用下面的具体数据（第几步、正在运行的命令/工具、最新动态、最近结果、后台任务输出），不要泛泛而谈；回答进度问题时可以超过 60 字。',
  ]
  if (progress.running) {
    const tools = progress.tools.length > 0 ? progress.tools.join('、') : undefined
    const minutes = Math.max(1, Math.round(progress.turnMs / 60_000))
    if (tools !== undefined) {
      const stepText = progress.step !== undefined && progress.step > 0 ? `（第 ${progress.step} 步）` : ''
      lines.push(`- agent 正在运行：${tools}${stepText}，本回合已持续约 ${minutes} 分钟`)
    } else {
      lines.push(`- agent 正在深度思考，已持续约 ${minutes} 分钟`)
    }
  } else {
    lines.push('- agent 当前空闲')
  }
  for (const job of progress.jobs ?? []) {
    const minutes = elapsedMinutes(job.startedAt)
    const tail = job.outputTail !== undefined ? `，最近输出：${job.outputTail}` : ''
    lines.push(`- 后台任务运行中：${job.label}（已 ${minutes} 分钟${tail}）`)
  }
  if (progress.nodeCount > 0) lines.push(`- 会话已提交 ${progress.nodeCount} 个节点`)
  if (progress.lastTool !== undefined) lines.push(`- 最近一次工具调用：${progress.lastTool}`)
  if (progress.lastActivity !== undefined) lines.push(`- 最新动态：${progress.lastActivity}`)
  if (progress.lastSummary !== undefined) lines.push(`- 最近结果：${progress.lastSummary}`)
  if (progress.goalPhase !== undefined) lines.push(`- goal 阶段：${progress.goalPhase}`)
  if (progress.planActive !== undefined) lines.push(`- plan 进行中：${progress.planActive ? '是' : '否'}`)
  return lines.join('\n')
}
