import { VISUALISER_IDS, type VisualiserId } from './visualiserTypes'

export const VISUALISER_PREFERENCES_STORAGE_KEY =
  'pi-jukebox:visualiser-preferences'

export interface VisualiserPreferences {
  enabled: VisualiserId[]
  current: VisualiserId
}

export const DEFAULT_VISUALISER_PREFERENCES: VisualiserPreferences = {
  enabled: [...VISUALISER_IDS],
  current: 'spectrum',
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
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.enabled))
      return cloneDefaults()
    const storedEnabled = parsed.enabled
    const enabled = VISUALISER_IDS.filter((id) => storedEnabled.includes(id))
    if (enabled.length === 0) return cloneDefaults()
    const requested = isVisualiserId(parsed.current)
      ? parsed.current
      : enabled[0]
    return { enabled, current: resolveEnabledVisualiser(requested, enabled) }
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
      JSON.stringify({ version: 1, ...preferences }),
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
  }
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
  }
}
