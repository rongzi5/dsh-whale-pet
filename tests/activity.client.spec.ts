import { describe, expect, it } from 'vitest'
import {
  ACTIVE_MOODS,
  IDLE_ACTIVITY,
  SESSION_ENGAGED_MOODS,
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
