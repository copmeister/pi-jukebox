export const JUKEBOX_SOUND_STORAGE_KEY = 'pi-jukebox:sound-settings:v1'

export interface JukeboxSoundSettings {
  enabled: boolean
  masterVolume: number
  buttonVolume: number
  movementVolume: number
  confirmationVolume: number
  loadingVolume: number
  loadingPause: boolean
}

export const DEFAULT_JUKEBOX_SOUND_SETTINGS: JukeboxSoundSettings = {
  enabled: true,
  masterVolume: 0.6,
  buttonVolume: 0.7,
  movementVolume: 0.35,
  confirmationVolume: 0.65,
  loadingVolume: 0.45,
  loadingPause: true,
}

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

export function validateJukeboxSoundSettings(
  value: unknown,
): JukeboxSoundSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_JUKEBOX_SOUND_SETTINGS }
  }

  const candidate = value as Partial<JukeboxSoundSettings>
  return {
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_JUKEBOX_SOUND_SETTINGS.enabled,
    masterVolume: clampVolume(
      candidate.masterVolume,
      DEFAULT_JUKEBOX_SOUND_SETTINGS.masterVolume,
    ),
    buttonVolume: clampVolume(
      candidate.buttonVolume,
      DEFAULT_JUKEBOX_SOUND_SETTINGS.buttonVolume,
    ),
    movementVolume: clampVolume(
      candidate.movementVolume,
      DEFAULT_JUKEBOX_SOUND_SETTINGS.movementVolume,
    ),
    confirmationVolume: clampVolume(
      candidate.confirmationVolume,
      DEFAULT_JUKEBOX_SOUND_SETTINGS.confirmationVolume,
    ),
    loadingVolume: clampVolume(
      candidate.loadingVolume,
      DEFAULT_JUKEBOX_SOUND_SETTINGS.loadingVolume,
    ),
    loadingPause:
      typeof candidate.loadingPause === 'boolean'
        ? candidate.loadingPause
        : DEFAULT_JUKEBOX_SOUND_SETTINGS.loadingPause,
  }
}

export function loadJukeboxSoundSettings(
  storage?: Pick<Storage, 'getItem'> | null,
): JukeboxSoundSettings {
  try {
    const availableStorage =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage
    if (!availableStorage) return { ...DEFAULT_JUKEBOX_SOUND_SETTINGS }
    const stored = availableStorage.getItem(JUKEBOX_SOUND_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_JUKEBOX_SOUND_SETTINGS }
    const parsed = JSON.parse(stored) as {
      version?: unknown
      settings?: unknown
    }
    if (parsed.version !== 1) return { ...DEFAULT_JUKEBOX_SOUND_SETTINGS }
    return validateJukeboxSoundSettings(parsed.settings)
  } catch {
    return { ...DEFAULT_JUKEBOX_SOUND_SETTINGS }
  }
}

export function saveJukeboxSoundSettings(
  settings: JukeboxSoundSettings,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const availableStorage =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage
    if (!availableStorage) return
    availableStorage.setItem(
      JUKEBOX_SOUND_STORAGE_KEY,
      JSON.stringify({ version: 1, settings }),
    )
  } catch {
    // Device-local preferences are optional; storage failure must stay harmless.
  }
}
