import { describe, expect, it } from 'vitest'
import { summarizeSession } from '../src/session-progress.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const NOW = 1_000_000

function event(partial: Partial<SessionEvent> & { type: SessionEvent['type'] }): SessionEvent {
  return { seq: 1, time: NOW, ...partial } as SessionEvent
}

/** A tool-result message shaped like the real ToolResultMessage. */
function toolResult(callId: string, text: string, isError = false): unknown {
  return {
    message: {
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
      }],
    },
  }
}

describe('summarizeSession', () => {
  it('reports nothing for an empty log', () => {
    expect(summarizeSession([], NOW)).toMatchObject({ active: false, running: false, tools: [], step: 0, turnMs: 0 })
  })

  it('tracks the running turn, step and in-flight tools', () => {
    const events: SessionEvent[] = [
      event({ type: 'turn/start', time: NOW - 120_000, data: { turn: 1 } }),
      event({ type: 'step/start', time: NOW - 100_000, data: { turn: 1, step: 2 } }),
      event({ type: 'assistant/message', time: NOW - 90_000, data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: '我来看看' }] } } }),
      event({ type: 'tool/call', time: NOW - 80_000, data: { turn: 1, step: 2, callId: 'c1' as never, name: 'bash', arguments: '{"command":"ls -la"}' } }),
    ]
    const summary = summarizeSession(events, NOW)
    expect(summary).toMatchObject({
      active: true,
      running: true,
      tools: ['bash'],
      step: 2,
      nodeCount: 1,
      lastTool: 'bash',
      lastActivity: '运行 bash：{"command":"ls -la"}',
    })
    expect(summary.turnMs).toBe(120_000)
  })

  it('completes a tool call and summarizes the result', () => {
    const events: SessionEvent[] = [
      event({ type: 'turn/start', time: NOW - 60_000, data: { turn: 1 } }),
      event({ type: 'step/start', time: NOW - 50_000, data: { turn: 1, step: 1 } }),
      event({ type: 'tool/call', time: NOW - 40_000, data: { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' } }),
      event({
        type: 'tool/result',
        time: NOW - 10_000,
        data: { turn: 1, step: 1, ...toolResult('c1', 'total 42\n-rw-r--r--  1 jizi jizi 1234 file.txt') },
      }),
    ]
    const summary = summarizeSession(events, NOW)
    expect(summary).toMatchObject({
      running: true,
      tools: [],
      nodeCount: 1,
    })
    expect(summary.lastSummary).toContain('完成：total 42')
    expect(summary.lastSummary).toContain('file.txt')
  })

  it('truncates very long result summaries', () => {
    const longText = 'x'.repeat(500)
    const events: SessionEvent[] = [
      event({ type: 'turn/start', time: NOW - 60_000, data: { turn: 1 } }),
      event({ type: 'tool/call', time: NOW - 40_000, data: { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' } }),
      event({
        type: 'tool/result',
        time: NOW - 10_000,
        data: { turn: 1, step: 1, ...toolResult('c1', longText) },
      }),
    ]
    const summary = summarizeSession(events, NOW)
    expect(summary.lastSummary).toBe(`完成：${'x'.repeat(140)}`)
  })

  it('flags failed results and closes the turn', () => {
    const events: SessionEvent[] = [
      event({ type: 'turn/start', time: NOW - 60_000, data: { turn: 1 } }),
      event({ type: 'tool/call', time: NOW - 40_000, data: { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' } }),
      event({
        type: 'tool/result',
        time: NOW - 10_000,
        data: { turn: 1, step: 1, ...toolResult('c1', 'boom', true) },
      }),
      event({ type: 'turn/end', time: NOW - 5_000, data: { turn: 1, reason: { kind: 'error' } as never } }),
    ]
    const summary = summarizeSession(events, NOW)
    expect(summary).toMatchObject({ running: false, tools: [], lastSummary: '出错：boom' })
  })

  it('falls back to the last assistant output when no tool ran', () => {
    const events: SessionEvent[] = [
      event({ type: 'turn/start', time: NOW - 30_000, data: { turn: 1 } }),
      event({ type: 'assistant/message', time: NOW - 20_000, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '正在写代码……' }] } } }),
    ]
    const summary = summarizeSession(events, NOW)
    expect(summary).toMatchObject({ running: true, lastActivity: '正在输出：正在写代码……' })
    expect(summary.lastSummary).toBeUndefined()
  })
})
