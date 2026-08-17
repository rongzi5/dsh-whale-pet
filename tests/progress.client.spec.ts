import { describe, expect, it } from 'vitest'
import { buildProgressContext, pendingInteractionToText, progressToText, type WhaleSessionProgress } from '../src/client/progress.ts'

const BUSY: WhaleSessionProgress = {
  active: true,
  running: true,
  tools: ['bash', 'web_search'],
  turnMs: 180_000,
  nodeCount: 12,
  lastTool: 'bash',
  goalPhase: 'active',
  planActive: true,
  step: 3,
  lastActivity: '运行 bash：ls -la',
  lastSummary: '完成：共 42 个文件',
}

describe('progressToText', () => {
  it('phrases running tools playfully while staying factual', () => {
    expect(progressToText(BUSY)).toBe('正在鼓捣终端（bash、web_search），已经 3 分钟')
  })

  it('reports deep thinking when running without a tool in flight', () => {
    expect(progressToText({ ...BUSY, tools: [] })).toBe('正在深度思考…（已经 3 分钟）')
  })

  it('reports the last tool when idle-but-active', () => {
    expect(progressToText({ ...BUSY, running: false, turnMs: 0, tools: [] })).toBe('刚跑完 bash')
  })

  it('returns null when nothing is active', () => {
    expect(progressToText(null)).toBeNull()
    expect(progressToText({ ...BUSY, active: false })).toBeNull()
  })

  it('rounds sub-minute turns up to one minute', () => {
    expect(progressToText({ ...BUSY, turnMs: 5_000 })).toBe('正在鼓捣终端（bash、web_search），已经 1 分钟')
  })

  it('maps other tools to their flavor phrases', () => {
    expect(progressToText({ ...BUSY, tools: ['web_search'] })).toBe('正在网上冲浪（web_search），已经 3 分钟')
    expect(progressToText({ ...BUSY, tools: ['tool-fs-search'] })).toBe('正在翻文件（tool-fs-search），已经 3 分钟')
    expect(progressToText({ ...BUSY, tools: ['something-unknown'] })).toBe('正在忙活（something-unknown），已经 3 分钟')
  })

  it('prefers a pending user interaction over running tools', () => {
    expect(progressToText({ ...BUSY, pendingInteraction: 'approval' })).toBe('有个审批等你拍板')
    expect(progressToText({
      active: false,
      running: false,
      tools: [],
      turnMs: 0,
      nodeCount: 0,
      pendingInteraction: 'question',
    })).toBe('有个问题等你回答')
  })

  it('prefers a running background job over the in-flight tool', () => {
    const withJob = {
      ...BUSY,
      jobs: [{ label: 'npm run build', startedAt: Date.now() - 300_000, outputTail: '进度 45%' }],
    }
    expect(progressToText(withJob)).toBe('正在后台跑 npm run build（已 5 分钟）')
  })
})

describe('pendingInteractionToText', () => {
  it('names each pending kind in the bubble voice', () => {
    expect(pendingInteractionToText('approval')).toBe('有个审批等你拍板')
    expect(pendingInteractionToText('plan-review')).toBe('有个计划等你过目')
    expect(pendingInteractionToText('question')).toBe('有个问题等你回答')
  })
})

describe('buildProgressContext', () => {
  it('builds a structured progress block with fine-grained fields', () => {
    const block = buildProgressContext(BUSY)
    expect(block).toContain('当前 DSH 会话状态')
    expect(block).toContain('正在运行：bash、web_search（第 3 步）')
    expect(block).toContain('3 分钟')
    expect(block).toContain('12 个节点')
    expect(block).toContain('最新动态：运行 bash：ls -la')
    expect(block).toContain('最近结果：完成：共 42 个文件')
    expect(block).toContain('goal 阶段：active')
  })

  it('describes deep thinking without tools', () => {
    const block = buildProgressContext({ ...BUSY, tools: [] })
    expect(block).toContain('正在深度思考')
    expect(block).not.toContain('正在运行：')
  })

  it('includes probed background jobs with their output tail', () => {
    const block = buildProgressContext({
      ...BUSY,
      jobs: [{ label: 'npm run build', startedAt: Date.now() - 300_000, outputTail: '进度 45%' }],
    })
    expect(block).toContain('后台任务运行中：npm run build（已 5 分钟，最近输出：进度 45%）')
  })

  it('returns null when nothing is active', () => {
    expect(buildProgressContext(null)).toBeNull()
    expect(buildProgressContext({ ...BUSY, active: false })).toBeNull()
  })

  it('reports a pending user interaction even when the turn looks idle', () => {
    const block = buildProgressContext({
      active: false,
      running: false,
      tools: [],
      turnMs: 0,
      nodeCount: 0,
      pendingInteraction: 'plan-review',
    })
    expect(block).toContain('正在等待用户：有个计划等你过目')
  })
})
