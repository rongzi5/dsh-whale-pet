import { describe, expect, it } from 'vitest'
import {
  ACTIVE_MOODS,
  IDLE_ACTIVITY,
  SESSION_ENGAGED_MOODS,
  classifyTool,
  isActiveMood,
  isSessionEngaged,
  sameActivity,
  type WhaleMood,
} from '../src/client/activity.ts'

const ALL_MOODS: readonly WhaleMood[] = [
  'idle',
  'thinking',
  'working',
  'focused',
  'celebrating',
  'error',
  'sleeping',
  'listening',
]

/** The one place that spells out the intended classification by hand. */
const ACTIVE_EXPECTATION: Readonly<Record<WhaleMood, boolean>> = {
  idle: false,
  thinking: true,
  working: true,
  focused: true,
  celebrating: true,
  error: false,
  sleeping: false,
  listening: false,
}

const ENGAGED_EXPECTATION: Readonly<Record<WhaleMood, boolean>> = {
  idle: false,
  thinking: true,
  working: true,
  focused: true,
  celebrating: false,
  error: false,
  sleeping: false,
  listening: false,
}

describe('activity mood vocabulary', () => {
  it('declares the active set as a subset of the mood union', () => {
    for (const mood of ALL_MOODS) {
      expect(ACTIVE_MOODS.has(mood), `ACTIVE_MOODS mentions ${mood}`).toBe(ACTIVE_EXPECTATION[mood])
      expect(SESSION_ENGAGED_MOODS.has(mood), `SESSION_ENGAGED_MOODS mentions ${mood}`).toBe(
        ENGAGED_EXPECTATION[mood],
      )
    }
  })

  it('classifies active moods used for wake and patrol decisions', () => {
    for (const mood of ALL_MOODS) {
      expect(isActiveMood(mood), `isActiveMood(${mood})`).toBe(ACTIVE_EXPECTATION[mood])
    }
  })

  it('classifies session-engaged moods used for input-area gaze', () => {
    for (const mood of ALL_MOODS) {
      expect(isSessionEngaged(mood), `isSessionEngaged(${mood})`).toBe(ENGAGED_EXPECTATION[mood])
    }
  })

  it('keeps session engagement a strict subset of activity', () => {
    for (const mood of ALL_MOODS) {
      if (isSessionEngaged(mood)) expect(isActiveMood(mood)).toBe(true)
    }
    expect(ACTIVE_MOODS.size).toBe(SESSION_ENGAGED_MOODS.size + 1)
  })

  it('excludes celebration from session engagement but not from activity', () => {
    expect(isActiveMood('celebrating')).toBe(true)
    expect(isSessionEngaged('celebrating')).toBe(false)
  })

  it('exposes the sets as frozen read-only collections', () => {
    expect(Object.isFrozen(ACTIVE_MOODS)).toBe(true)
    expect(Object.isFrozen(SESSION_ENGAGED_MOODS)).toBe(true)
  })

  it('keeps the idle activity constant and equality predicate stable', () => {
    expect(IDLE_ACTIVITY).toEqual({ mood: 'idle', intensity: 0 })
    expect(sameActivity(IDLE_ACTIVITY, { mood: 'idle', intensity: 0 })).toBe(true)
    expect(sameActivity(IDLE_ACTIVITY, { mood: 'idle', intensity: 0.5 })).toBe(false)
    expect(sameActivity(IDLE_ACTIVITY, { mood: 'sleeping', intensity: 0 })).toBe(false)
  })
})

describe('classifyTool', () => {
  it('focuses on shell-style tools', () => {
    expect(classifyTool('bash')).toBe('focus')
    expect(classifyTool('Bash')).toBe('focus')
    expect(classifyTool('pwsh')).toBe('focus')
    expect(classifyTool('run-shell')).toBe('focus')
  })

  it('scans on search and web tools', () => {
    expect(classifyTool('web')).toBe('scan')
    expect(classifyTool('web-search')).toBe('scan')
    expect(classifyTool('fs-search')).toBe('scan')
    expect(classifyTool('fetch-url')).toBe('scan')
  })

  it('gets happy on explicit write-style tools', () => {
    expect(classifyTool('fs-write')).toBe('happy')
    expect(classifyTool('edit-file')).toBe('happy')
    expect(classifyTool('patch')).toBe('happy')
    expect(classifyTool('create-doc')).toBe('happy')
  })

  it('reads fs-style tool intent from its JSON arguments', () => {
    expect(classifyTool('fs', '{"action":"write","path":"a.txt"}')).toBe('happy')
    expect(classifyTool('fs', '{"action":"edit","path":"a.txt"}')).toBe('happy')
    expect(classifyTool('fs', '{"action":"mkdir"}')).toBe('happy')
    expect(classifyTool('fs', '{"action":"read","path":"a.txt"}')).toBe('scan')
    expect(classifyTool('fs', '{"action":"search","query":"x"}')).toBe('scan')
    expect(classifyTool('fs', '{"path":"a.txt"}')).toBe('none')
  })

  it('returns none for unknown tools and missing arguments', () => {
    expect(classifyTool('todo')).toBe('none')
    expect(classifyTool('goal')).toBe('none')
    expect(classifyTool('')).toBe('none')
    expect(classifyTool('fs')).toBe('none')
  })
})
