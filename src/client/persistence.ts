/**
 * Safe localStorage-backed persistence for the whale pet's user state.
 *
 * Every access is guarded: browsers can throw in private mode or when storage
 * is disabled, so the module degrades to in-memory defaults instead of
 * crashing the pet. All values are validated on load, so a hand-edited or
 * version-skewed payload cannot corrupt the runtime state.
 */

export interface WhalePetPersistedState {
  /** User-given name shown in recap bubbles. */
  name: string
  /** Whether the pet is hidden by the keyboard shortcut. */
  hidden: boolean
  /** Whether released drags glide to the nearest corner. */
  snapToCorner: boolean
  /** Last pet position (CSS pixels, pet top-left); null = default edge rest. */
  x: number | null
  y: number | null
  /** ISO timestamp of the first run; drives the "days together" recap. */
  since: string
  /** Local calendar day (`YYYY-MM-DD`) of the last unsolicited greeting. */
  lastGreetDay: string
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'dsh.whale-pet.v1'
const NAME_MAX_LENGTH = 32

export const WHALE_PET_DEFAULTS: Readonly<WhalePetPersistedState> = Object.freeze({
  name: '鲸鲸',
  hidden: false,
  snapToCorner: true,
  x: null,
  y: null,
  since: '',
  lastGreetDay: '',
})

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Read and validate the persisted state; any failure falls back to defaults. */
export function loadWhalePetState(storage: StorageLike | null): WhalePetPersistedState {
  const fallback = { ...WHALE_PET_DEFAULTS }
  if (storage === null) return fallback
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return fallback
  }
  if (raw === null) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback
  const record = parsed as Record<string, unknown>
  return {
    name: typeof record.name === 'string' && record.name.trim() !== ''
      ? record.name.trim().slice(0, NAME_MAX_LENGTH)
      : WHALE_PET_DEFAULTS.name,
    hidden: typeof record.hidden === 'boolean' ? record.hidden : WHALE_PET_DEFAULTS.hidden,
    snapToCorner: typeof record.snapToCorner === 'boolean' ? record.snapToCorner : WHALE_PET_DEFAULTS.snapToCorner,
    x: finiteNumber(record.x),
    y: finiteNumber(record.y),
    since: typeof record.since === 'string' ? record.since : '',
    lastGreetDay: typeof record.lastGreetDay === 'string' ? record.lastGreetDay : '',
  }
}

/** Merge a patch over the current persisted state and write it back. */
export function saveWhalePetState(storage: StorageLike | null, patch: Partial<WhalePetPersistedState>): void {
  if (storage === null) return
  const next = { ...loadWhalePetState(storage), ...patch }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable (private mode / quota): keep running in-memory.
  }
}

/** The browser's localStorage when available; null otherwise. */
export function browserStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage
    if (storage === null || storage === undefined) return null
    return storage
  } catch {
    return null
  }
}

/** Local calendar day key used to rate-limit unsolicited greetings. */
export function localDayKey(now: number = Date.now()): string {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Whole days since the first run (0 on the first day, 0 for unknown dates). */
export function daysSince(since: string, now: number = Date.now()): number {
  if (since === '') return 0
  const start = Date.parse(since)
  if (!Number.isFinite(start)) return 0
  return Math.max(0, Math.floor((now - start) / 86_400_000))
}
