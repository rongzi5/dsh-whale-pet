import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

interface RecordedEntry {
  options: {
    id?: string
    order?: number
    label?: string
    name?: string
  }
}

describe('ui-whale-pet plugin contract', () => {
  it('registers one additive shell overlay entry through the slots service', () => {
    let injectedKey = ''
    let injectCallback: (() => void) | null = null
    let disposeEffect: (() => void) | null = null
    const entries: RecordedEntry[] = []

    const ctx = {
      sessions: undefined,
      effect(callback: () => void | (() => void)): () => void {
        const dispose = callback()
        disposeEffect = () => {
          if (typeof dispose === 'function') dispose()
        }
        return disposeEffect
      },
      provide(): () => void {
        return () => {}
      },
      slots: {
        inject(key: string, callback: () => void): () => void {
          injectedKey = key
          injectCallback = callback
          return () => {}
        },
        register(options: RecordedEntry['options']): () => void {
          const entry: RecordedEntry = { options }
          entries.push(entry)
          return () => {
            entries.splice(entries.indexOf(entry), 1)
          }
        },
      },
    }

    apply(ctx as never)

    expect(inject).toContain('slots')
    expect(inject).toContain('sessions')
    expect(injectedKey).toBe('shell.overlay')
    expect(injectCallback).not.toBeNull()
    injectCallback?.()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'whale-pet', order: 900, label: '3D whale pet' })

    disposeEffect?.()
  })

  it('registers the chat proxy route with the web server', () => {
    const routes: unknown[] = []
    const effectDisposes: Array<() => void> = []
    const ctx = {
      effect(callback: () => void | (() => void)): () => void {
        const dispose = callback()
        effectDisposes.push(() => {
          if (typeof dispose === 'function') dispose()
        })
        return () => {
          effectDisposes.forEach(dispose => dispose())
        }
      },
      webServer: {
        register(route: unknown): () => void {
          routes.push(route)
          return () => {
            routes.splice(routes.indexOf(route), 1)
          }
        },
      },
      sessions: {} as never,
    }

    nodeApply(ctx as never)

    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: '/api/whale-pet' })
    expect(routes[1]).toMatchObject({ kind: 'exact', path: '/api/whale-pet/progress' })

    effectDisposes.forEach(dispose => dispose())
    expect(routes).toHaveLength(0)
  })
})
