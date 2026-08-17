// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { apply, inject, WhalePet, WhalePetChat, WhalePetService } from '../src/client/index.ts'
import type { WhaleChatTransport } from '../src/client/llm.ts'

/**
 * The client entry is a browser bundle consumed by the DSH `__ModuleLoader__`
 * runner; in a standalone repo we exercise its contract with a plain mock ctx
 * (same shape as plugin-contract.client.spec.ts) instead of loading the
 * browser-only client runtime.
 */

interface Fiber {
  await(): Promise<void>
  dispose(): Promise<void>
}

function bench(): { fiber: Fiber; entries: Array<{ options: unknown }> } {
  const entries: Array<{ options: unknown }> = []
  let disposeAll: (() => void) | null = null
  const ctx = {
    sessions: undefined,
    effect(callback: () => void | (() => void)): () => void {
      const dispose = callback()
      disposeAll = () => {
        if (typeof dispose === 'function') dispose()
      }
      return () => {
        disposeAll?.()
      }
    },
    provide(): () => void {
      return () => {}
    },
    slots: {
      inject(_key: string, callback: () => () => void): () => void {
        return callback()
      },
      register(options: unknown): () => void {
        const entry = { options }
        entries.push(entry)
        return () => {
          entries.splice(entries.indexOf(entry), 1)
        }
      },
      entries(): unknown[] {
        return entries
      },
    },
  }
  const fiber: Fiber = {
    async await(): Promise<void> {
      apply(ctx as never)
    },
    async dispose(): Promise<void> {
      disposeAll?.()
    },
  }
  return { fiber, entries }
}

describe('ui-whale-pet browser plugin', () => {
  it('registers one additive shell overlay entry', async () => {
    const { fiber, entries } = bench()
    await fiber.await()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'whale-pet', order: 900 })
    expect(inject).toContain('slots')
    expect(inject).toContain('sessions')
  })

  it('withdraws and cleanly re-registers with the plugin fiber', async () => {
    const { fiber, entries } = bench()
    await fiber.await()
    expect(entries).toHaveLength(1)

    await fiber.dispose()
    expect(entries).toHaveLength(0)

    const reloaded = bench()
    await reloaded.fiber.await()
    expect(reloaded.entries).toHaveLength(1)
  })
})

describe('ui-whale-pet chat bubble', () => {
  it('opens the inline input bubble with model/effort selectors and sends through the chat coordinator', async () => {
    // jsdom has no WebGL: the controller reports the mount error through the
    // view's onError state, which does not affect the DOM interaction flow.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const service = new WhalePetService()
    let calls = 0
    let lastOptions: unknown
    const transport: WhaleChatTransport = {
      async postChat(_messages, options): Promise<string> {
        calls += 1
        lastOptions = options
        return '你好呀！'
      },
      async listModels() {
        return {
          providers: [
            {
              id: 'deepseek-official',
              name: 'DeepSeek 官方',
              models: [
                { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', efforts: [] },
                {
                  id: 'deepseek-reasoner',
                  name: 'DeepSeek Reasoner',
                  efforts: [
                    { id: 'low', name: '低' },
                    { id: 'high', name: '高' },
                  ],
                  defaultEffort: 'low',
                },
              ],
            },
          ],
          default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        }
      },
    }
    const chat = new WhalePetChat(service, null, transport)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    root.render(React.createElement(WhalePet, { whalePet: service, whalePetChat: chat }))
    await new Promise<void>(resolve => setTimeout(resolve, 30))

    // Open the context menu on the pet's hit zone.
    const hitZone = host.querySelector('button[aria-label="DeepSeek 3D whale pet"]')
    expect(hitZone).not.toBeNull()
    hitZone?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 90 }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))

    // The menu shows the chat entry; clicking it opens the inline bubble.
    const chatButton = [...host.querySelectorAll('button')].find(button => button.textContent === '和鲸鲸聊天…')
    expect(chatButton).not.toBeNull()
    chatButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 30))

    // The bubble carries the model selector; the effort selector appears once
    // a reasoning model is chosen (the default flash model has no efforts).
    const input = host.querySelector('input[placeholder="对鲸鲸说…"]')
    expect(input).not.toBeNull()
    const modelSelect = host.querySelector('select[aria-label="选择模型"]') as HTMLSelectElement | null
    expect(modelSelect).not.toBeNull()
    await new Promise<void>(resolve => setTimeout(resolve, 30))
    expect(modelSelect?.options.length).toBeGreaterThanOrEqual(2)
    expect(host.querySelector('select[aria-label="思考强度"]')).toBeNull()

    // Pick the reasoning model + high effort, type and send.
    modelSelect!.value = 'deepseek-official::deepseek-reasoner'
    modelSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    const effortSelect = host.querySelector('select[aria-label="思考强度"]') as HTMLSelectElement | null
    expect(effortSelect).not.toBeNull()
    effortSelect!.value = 'high'
    effortSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '你好鲸鲸')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    const send = [...host.querySelectorAll('button')].find(button => button.textContent === '发送')
    send?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 30))

    expect(calls).toBe(1)
    expect(lastOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner', effort: 'high' })
    // The bubble closes after sending; the reply surfaces in the speech bubble.
    expect(host.querySelector('input[placeholder="对鲸鲸说…"]')).toBeNull()
    expect(service.getSnapshot().recap?.text).toBe('你好呀！')

    root.unmount()
    host.remove()
    service.dispose()
  })

  it('keeps the bubble open through the opening click and closes on an outside press', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = new WhalePetService()
    const transport: WhaleChatTransport = {
      async postChat(): Promise<string> {
        return 'ok'
      },
      async listModels() {
        return { providers: [], default: { provider: '', model: '' } }
      },
    }
    const chat = new WhalePetChat(service, null, transport)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    root.render(React.createElement(WhalePet, { whalePet: service, whalePetChat: chat }))
    await new Promise<void>(resolve => setTimeout(resolve, 30))

    const ME = window.MouseEvent
    host.querySelector('button[aria-label="DeepSeek 3D whale pet"]')
      ?.dispatchEvent(new ME('contextmenu', { bubbles: true, clientX: 120, clientY: 90 }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    const chatButton = [...host.querySelectorAll('button')].find(button => button.textContent === '和鲸鲸聊天…')
    expect(chatButton).not.toBeNull()

    // The opening click (which React may flush before it finishes bubbling to
    // document in real browsers) must NOT close the bubble: the closer listens
    // to mousedown, so a synthetic trailing click is ignored.
    chatButton?.dispatchEvent(new ME('click', { bubbles: true }))
    document.dispatchEvent(new ME('click', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(host.querySelector('input[placeholder="对鲸鲸说…"]')).not.toBeNull()

    // An outside press (mousedown) closes the bubble; a press inside keeps it.
    document.dispatchEvent(new ME('mousedown', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(host.querySelector('input[placeholder="对鲸鲸说…"]')).toBeNull()

    // Reopen and press inside the bubble: it stays.
    host.querySelector('button[aria-label="DeepSeek 3D whale pet"]')
      ?.dispatchEvent(new ME('contextmenu', { bubbles: true, clientX: 120, clientY: 90 }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    ;[...host.querySelectorAll('button')].find(button => button.textContent === '和鲸鲸聊天…')
      ?.dispatchEvent(new ME('click', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    const input = host.querySelector('input[placeholder="对鲸鲸说…"]')
    expect(input).not.toBeNull()
    input?.dispatchEvent(new ME('mousedown', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(host.querySelector('input[placeholder="对鲸鲸说…"]')).not.toBeNull()

    root.unmount()
    host.remove()
    service.dispose()
  })

  it('renders the dizzy activity marker and three orbiting stars', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = new WhalePetService()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    root.render(React.createElement(WhalePet, { whalePet: service }))
    await new Promise<void>(resolve => setTimeout(resolve, 20))

    service.enterDizzy()
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(host.querySelector('[data-whale-activity="dizzy"]')).not.toBeNull()
    expect([...host.querySelectorAll('span')].filter(node => node.textContent === '★')).toHaveLength(3)

    const hitZone = host.querySelector('button[aria-label="DeepSeek 3D whale pet"]')
    hitZone?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 90 }))
    hitZone?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(service.getSnapshot().effects).toHaveLength(0)
    expect(service.getSnapshot().recap).toBeNull()

    root.unmount()
    host.remove()
    service.dispose()
  })
})
