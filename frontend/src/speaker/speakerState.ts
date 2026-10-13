export const SPEAKER_STORAGE_KEY = 'pi-jukebox:speaker-state:v1'
// Empirically verified Edifier R1280DB remote-control positions, not loudness.
export const SPEAKER_MIN_VOLUME_STEPS = 0
export const SPEAKER_MAX_VOLUME_STEPS = 50
export type SpeakerEndpoint = 'min' | 'max'

export interface SpeakerState {
  source: 'tv' | 'pi-jukebox' | null
  volumeSteps: number | null
  muted: boolean
}

export type SpeakerCommand = 'tv' | 'pi-jukebox' | 'up' | 'down' | 'mute'

export const UNKNOWN_SPEAKER_STATE: SpeakerState = {
  source: null,
  volumeSteps: null,
  muted: false,
}

export const SPEAKER_INPUTS = { tv: 'OPTICAL', 'pi-jukebox': 'LINE 1' } as const

const commands = new Map<string, SpeakerCommand>([
  ['F1', 'tv'],
  ['F2', 'pi-jukebox'],
  ['F3', 'up'],
  ['F4', 'down'],
  ['F5', 'mute'],
])

export function speakerCommand(event: KeyboardEvent): SpeakerCommand | null {
  if (
    !event.ctrlKey ||
    !event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    event.isComposing
  )
    return null
  return commands.get(event.key) ?? null
}

// Apply one discrete press only; native repeats are handled as unknown by the hook.
export function applySpeakerCommand(
  state: SpeakerState,
  command: SpeakerCommand,
): SpeakerState {
  switch (command) {
    case 'tv':
    case 'pi-jukebox':
      return { ...state, source: command }
    case 'up':
      return {
        ...state,
        volumeSteps:
          state.volumeSteps === null
            ? null
            : Math.min(SPEAKER_MAX_VOLUME_STEPS, state.volumeSteps + 1),
      }
    case 'down':
      return {
        ...state,
        volumeSteps:
          state.volumeSteps === null
            ? null
            : Math.max(SPEAKER_MIN_VOLUME_STEPS, state.volumeSteps - 1),
      }
    case 'mute':
      return { ...state, muted: !state.muted }
  }
}

export function formatSpeakerStatus(state: SpeakerState): string {
  const source =
    state.source === 'tv'
      ? 'TV'
      : state.source === 'pi-jukebox'
        ? 'PI JUKEBOX'
        : '--'
  return `${source} | ${state.muted ? 'MUTED' : (state.volumeSteps ?? '--')}`
}

export function loadSpeakerState(): SpeakerState {
  try {
    const stored = window.localStorage.getItem(SPEAKER_STORAGE_KEY)
    if (!stored) return { ...UNKNOWN_SPEAKER_STATE }
    const parsed = JSON.parse(stored) as {
      version?: unknown
      state?: Partial<SpeakerState>
    }
    if (
      parsed.version !== 1 ||
      !parsed.state ||
      typeof parsed.state !== 'object'
    ) {
      return { ...UNKNOWN_SPEAKER_STATE }
    }
    const { source, volumeSteps, muted } = parsed.state
    return {
      source: source === 'tv' || source === 'pi-jukebox' ? source : null,
      volumeSteps:
        typeof volumeSteps === 'number' &&
        Number.isFinite(volumeSteps) &&
        Number.isInteger(volumeSteps) &&
        volumeSteps >= SPEAKER_MIN_VOLUME_STEPS &&
        volumeSteps <= SPEAKER_MAX_VOLUME_STEPS
          ? volumeSteps
          : null,
      muted: typeof muted === 'boolean' ? muted : false,
    }
  } catch {
    return { ...UNKNOWN_SPEAKER_STATE }
  }
}

export function saveSpeakerState(state: SpeakerState): void {
  try {
    window.localStorage.setItem(
      SPEAKER_STORAGE_KEY,
      JSON.stringify({ version: 1, state }),
    )
  } catch {
    // Match other browser-local preferences: storage failure cannot interrupt the UI.
  }
}
