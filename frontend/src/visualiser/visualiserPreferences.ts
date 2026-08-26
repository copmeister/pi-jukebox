import { VISUALISER_IDS, type VisualiserId } from './visualiserTypes'
import {
  DEFAULT_CONCENTRIC_SQUARE_COLOUR,
  isConcentricSquareColour,
  type ConcentricSquareColour,
} from './concentricSquares'
import { clampVisualiserSensitivity } from './sensitivity'

export const VISUALISER_PREFERENCES_STORAGE_KEY =
  'pi-jukebox:visualiser-preferences'
const VISUALISER_PREFERENCES_VERSION = 3

export type VisualiserSensitivity = Record<VisualiserId, number>

export const DEFAULT_VISUALISER_SENSITIVITY: VisualiserSensitivity = {
  spectrum: 0,
  'golden-ratio': 2,
  'concentric-squares': 0,
}

export interface VisualiserPreferences {
  enabled: VisualiserId[]
  current: VisualiserId
  sensitivity: VisualiserSensitivity
  concentricColour: ConcentricSquareColour
}

export const DEFAULT_VISUALISER_PREFERENCES: VisualiserPreferences = {
  enabled: [...VISUALISER_IDS],
  current: 'spectrum',
  sensitivity: { ...DEFAULT_VISUALISER_SENSITIVITY },
  concentricColour: DEFAULT_CONCENTRIC_SQUARE_COLOUR,
}

export function loadVisualiserPreferences(
  storage?: Pick<Storage, 'getItem'> | null,
): VisualiserPreferences {
  try {
    const availableStorage =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage
    const stored = availableStorage?.getItem(VISUALISER_PREFERENCES_STORAGE_KEY)
    if (!stored) return cloneDefaults()
    const parsed = JSON.parse(stored) as {
      version?: unknown
      enabled?: unknown
      current?: unknown
      sensitivity?: unknown
      concentricColour?: unknown
    }
    if (
      ![1, 2, VISUALISER_PREFERENCES_VERSION].includes(
        Number(parsed.version),
      ) ||
      !Array.isArray(parsed.enabled)
    )
      return cloneDefaults()
    const storedEnabled =
      Number(parsed.version) === VISUALISER_PREFERENCES_VERSION
        ? parsed.enabled
        : [...parsed.enabled, 'concentric-squares']
    const enabled = VISUALISER_IDS.filter((id) => storedEnabled.includes(id))
    if (enabled.length === 0) return cloneDefaults()
    const requested = isVisualiserId(parsed.current)
      ? parsed.current
      : enabled[0]
    const storedSensitivity =
      parsed.sensitivity && typeof parsed.sensitivity === 'object'
        ? (parsed.sensitivity as Record<string, unknown>)
        : {}
    return {
      enabled,
      current: resolveEnabledVisualiser(requested, enabled),
      sensitivity: Object.fromEntries(
        VISUALISER_IDS.map((id) => [
          id,
          storedSensitivity[id] === undefined
            ? DEFAULT_VISUALISER_SENSITIVITY[id]
            : clampVisualiserSensitivity(storedSensitivity[id]),
        ]),
      ) as VisualiserSensitivity,
      concentricColour: isConcentricSquareColour(parsed.concentricColour)
        ? parsed.concentricColour
        : DEFAULT_CONCENTRIC_SQUARE_COLOUR,
    }
  } catch {
    return cloneDefaults()
  }
}

export function saveVisualiserPreferences(
  preferences: VisualiserPreferences,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const availableStorage =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage
    availableStorage?.setItem(
      VISUALISER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: VISUALISER_PREFERENCES_VERSION,
        ...preferences,
      }),
    )
  } catch {
    // Visualiser choices are optional; storage failure must stay harmless.
  }
}

export function setVisualiserEnabled(
  preferences: VisualiserPreferences,
  id: VisualiserId,
  enabled: boolean,
): VisualiserPreferences {
  const nextEnabled = VISUALISER_IDS.filter((candidate) =>
    candidate === id ? enabled : preferences.enabled.includes(candidate),
  )
  if (nextEnabled.length === 0) return preferences
  return {
    enabled: nextEnabled,
    current: resolveEnabledVisualiser(preferences.current, nextEnabled),
    sensitivity: preferences.sensitivity,
    concentricColour: preferences.concentricColour,
  }
}

export function setVisualiserSensitivity(
  preferences: VisualiserPreferences,
  id: VisualiserId,
  sensitivityDb: number,
): VisualiserPreferences {
  return {
    ...preferences,
    sensitivity: {
      ...preferences.sensitivity,
      [id]: clampVisualiserSensitivity(sensitivityDb),
    },
  }
}

export function setConcentricSquareColour(
  preferences: VisualiserPreferences,
  colour: ConcentricSquareColour,
): VisualiserPreferences {
  return { ...preferences, concentricColour: colour }
}

export function cycleVisualiser(
  current: VisualiserId,
  enabled: readonly VisualiserId[],
  direction: 'next' | 'previous',
): VisualiserId {
  if (enabled.length === 0) return 'spectrum'
  const ordered = VISUALISER_IDS.filter((id) => enabled.includes(id))
  const currentIndex = ordered.indexOf(
    resolveEnabledVisualiser(current, ordered),
  )
  const offset = direction === 'next' ? 1 : -1
  return ordered[(currentIndex + offset + ordered.length) % ordered.length]
}

export function resolveEnabledVisualiser(
  requested: VisualiserId,
  enabled: readonly VisualiserId[],
): VisualiserId {
  if (enabled.includes(requested)) return requested
  const requestedIndex = VISUALISER_IDS.indexOf(requested)
  for (let offset = 1; offset <= VISUALISER_IDS.length; offset += 1) {
    const candidate =
      VISUALISER_IDS[(requestedIndex + offset) % VISUALISER_IDS.length]
    if (enabled.includes(candidate)) return candidate
  }
  return 'spectrum'
}

function isVisualiserId(value: unknown): value is VisualiserId {
  return VISUALISER_IDS.includes(value as VisualiserId)
}

function cloneDefaults(): VisualiserPreferences {
  return {
    enabled: [...DEFAULT_VISUALISER_PREFERENCES.enabled],
    current: DEFAULT_VISUALISER_PREFERENCES.current,
    sensitivity: { ...DEFAULT_VISUALISER_PREFERENCES.sensitivity },
    concentricColour: DEFAULT_VISUALISER_PREFERENCES.concentricColour,
  }
}
