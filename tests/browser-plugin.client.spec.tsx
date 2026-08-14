// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return { ctx, fiber }
}

describe('ui-whale-pet browser plugin', () => {
  it('registers one additive shell overlay entry', async () => {
    const { ctx, fiber } = await bench()
    await fiber.await()

    const entries = ctx.slots.entries('shell.overlay')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'whale-pet', order: 900 })
  })

  it('withdraws and cleanly re-registers with the plugin fiber', async () => {
    const { ctx, fiber } = await bench()
    await fiber.await()
    await fiber.dispose()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)

    const reloaded = ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(1)
  })

  it('has no host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
