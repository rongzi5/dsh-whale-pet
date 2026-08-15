import { describe, expect, it } from 'vitest'
import { buildProgressContext, progressToText, type WhaleSessionProgress } from '../src/client/progress.ts'

const BUSY: WhaleSessionProgress = {
  active: true,
  running: true,
  tools: ['bash', 'web_search'],
  turnMs: 180_000,
  nodeCount: 12,
  lastTool: 'bash',
  goalPhase: 'active',
  planActive: true,
}

describe('progressToText', () => {
  it('reports the running tools and elapsed time', () => {
    expect(progressToText(BUSY)).toBe('正在跑 bash、web_search，已经 3 分钟')
  })

  it('reports the last tool when idle-but-active', () => {
    expect(progressToText({ ...BUSY, running: false, turnMs: 0, tools: [] })).toBe('刚跑完 bash')
  })

  it('returns null when nothing is active', () => {
    expect(progressToText(null)).toBeNull()
    expect(progressToText({ ...BUSY, active: false })).toBeNull()
  })

  it('rounds sub-minute turns up to one minute', () => {
    expect(progressToText({ ...BUSY, turnMs: 5_000 })).toBe('正在跑 bash、web_search，已经 1 分钟')
  })
})

describe('buildProgressContext', () => {
  it('builds a structured progress block for the system prompt', () => {
    const block = buildProgressContext(BUSY)
    expect(block).toContain('当前 DSH 会话状态')
    expect(block).toContain('正在运行：bash、web_search')
    expect(block).toContain('3 分钟')
    expect(block).toContain('12 个节点')
    expect(block).toContain('goal 阶段：active')
    expect(block).toContain('plan 进行中：是')
  })

  it('returns null when nothing is active', () => {
    expect(buildProgressContext(null)).toBeNull()
    expect(buildProgressContext({ ...BUSY, active: false })).toBeNull()
  })
})
