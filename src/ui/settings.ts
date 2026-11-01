import { knownStation } from '../audio/radio.ts'

export type ShadowSetting = 'off' | 'low' | 'high'
export type QualitySetting = 'low' | 'medium' | 'high'

export type Settings = {
  ambient: number
  music: number
  sfx: number
  shadows: ShadowSetting
  distance: number
  quality: QualitySetting
  /** Station id, or empty when the radio is off. */
  station: string
}

export const SETTINGS_KEY = 'burbank-settings'

export function defaultSettings(): Settings {
  return { ambient: 1, music: 1, sfx: 1, shadows: 'high', distance: 1, quality: 'high', station: '' }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function parseSettings(raw: string | null): Settings {
  const base = defaultSettings()
  if (!raw) return base
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return base
  }
  if (!data || typeof data !== 'object') return base
  const row = data as Record<string, unknown>
  return {
    ambient: clamp(row.ambient, 0, 1, base.ambient),
    music: clamp(row.music, 0, 1, base.music),
    sfx: clamp(row.sfx, 0, 1, base.sfx),
    shadows: pick(row.shadows, ['off', 'low', 'high'] as const, base.shadows),
    distance: clamp(row.distance, 0.45, 1, base.distance),
    quality: pick(row.quality, ['low', 'medium', 'high'] as const, base.quality),
    station: knownStation(row.station) ? row.station : '',
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing can refuse storage. The sliders still work this visit.
  }
}
