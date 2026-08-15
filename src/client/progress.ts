/**
 * Whale pet session-progress vocabulary: a read-only summary of what the DSH
 * agent is doing right now, derived from the same session snapshot the mood
 * observer consumes. Pure functions so the bubble text and the prompt block
 * stay unit-testable.
 *
 * This never writes to the DSH session — the pet only reads progress so long
 * chats are not disturbed.
 */

/** One read-only snapshot of the bound session's live state. */
export interface WhaleSessionProgress {
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
}

/** One-line human bubble: "正在跑 bash，已经 3 分钟" / "刚跑完 bash". */
export function progressToText(progress: WhaleSessionProgress | null): string | null {
  if (progress === null || !progress.active) return null
  if (progress.running) {
    const tools = progress.tools.length > 0 ? progress.tools.join('、') : '某个工具'
    const minutes = Math.max(1, Math.round(progress.turnMs / 60_000))
    return `正在跑 ${tools}，已经 ${minutes} 分钟`
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
  const lines: string[] = ['当前 DSH 会话状态（用户可能问进度，请如实简短回答）：']
  if (progress.running) {
    const tools = progress.tools.length > 0 ? progress.tools.join('、') : '某个工具'
    const minutes = Math.max(1, Math.round(progress.turnMs / 60_000))
    lines.push(`- agent 正在运行：${tools}（本回合已持续约 ${minutes} 分钟）`)
  } else {
    lines.push('- agent 当前空闲')
  }
  if (progress.nodeCount > 0) lines.push(`- 会话已提交 ${progress.nodeCount} 个节点`)
  if (progress.lastTool !== undefined) lines.push(`- 最近一次工具调用：${progress.lastTool}`)
  if (progress.goalPhase !== undefined) lines.push(`- goal 阶段：${progress.goalPhase}`)
  if (progress.planActive !== undefined) lines.push(`- plan 进行中：${progress.planActive ? '是' : '否'}`)
  return lines.join('\n')
}
