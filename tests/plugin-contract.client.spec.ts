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
    const entries: RecordedEntry[] = []

    const ctx = {
      slots: {
        inject(key: string, callback: () => void): void {
          injectedKey = key
          injectCallback = callback
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
    expect(injectedKey).toBe('shell.overlay')
    expect(injectCallback).not.toBeNull()
    injectCallback?.()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'whale-pet', order: 900, label: '3D whale pet' })
  })

  it('has no host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
