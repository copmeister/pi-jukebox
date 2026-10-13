import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SpeakerFeedback } from './SpeakerFeedback'
import {
  saveSpeakerState,
  loadSpeakerState,
  UNKNOWN_SPEAKER_STATE,
} from './speakerState'
import {
  useSpeakerStatus,
  SPEAKER_FEEDBACK_MS,
  SPEAKER_MIN_RESYNC_MS,
  SPEAKER_MAX_RESYNC_MS,
} from './useSpeakerStatus'

function down(key: string, repeat = false, extra: KeyboardEventInit = {}) {
  return fireEvent.keyDown(window, {
    key,
    ctrlKey: true,
    shiftKey: true,
    repeat,
    ...extra,
  })
}
function up(key: string) {
  fireEvent.keyUp(window, { key })
}
function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('lets normal keys and incomplete chords reach existing keyboard handlers', () => {
  const handler = vi.fn()
  window.addEventListener('keydown', handler)
  const { result } = renderHook(useSpeakerStatus)
  expect(down('F1', false, { ctrlKey: false })).toBe(true)
  expect(down('Enter', false, { ctrlKey: false, shiftKey: false })).toBe(true)
  expect(handler).toHaveBeenCalledTimes(2)
  expect(result.current.state).toEqual(UNKNOWN_SPEAKER_STATE)
  expect(result.current.feedback).toBeNull()
  expect(down('F1')).toBe(false)
  expect(handler).toHaveBeenCalledTimes(2)
  window.removeEventListener('keydown', handler)
})

it('selects sources once per press and leaves the feedback timer alone on source repeats', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F1')
  expect(result.current.state.source).toBe('tv')
  advance(1000)
  down('F1', true)
  advance(800)
  expect(result.current.feedback).toBeNull()
  up('F1')
  down('F2')
  expect(result.current.state.source).toBe('pi-jukebox')
})

it('toggles mute only once until keyup, even for duplicate non-repeat keydowns', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F5')
  down('F5', true)
  down('F5')
  expect(result.current.state.muted).toBe(true)
  up('F5')
  down('F5')
  expect(result.current.state.muted).toBe(false)
})

it('counts each clean volume tap exactly once, ignoring duplicate non-repeat keydowns', () => {
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 })
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  down('F3')
  up('F3')
  expect(result.current.state.volumeSteps).toBe(25)
  down('F4')
  down('F4')
  up('F4')
  expect(result.current.state.volumeSteps).toBe(24)
  down('F3')
  up('F3')
  expect(result.current.state.volumeSteps).toBe(25)
})

it('keeps known volume at zero after clean Down taps', () => {
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 0 })
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  up('F4')
  down('F4')
  up('F4')
  expect(result.current.state.volumeSteps).toBe(0)
})

it('keeps known volume at 50 after clean Up taps', () => {
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 50 })
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  up('F3')
  down('F3')
  up('F3')
  expect(result.current.state.volumeSteps).toBe(50)
})

it.each(['F3', 'F4'])(
  'keeps unknown volume unknown after ordinary %s taps',
  (key) => {
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    up(key)
    down(key)
    up(key)
    expect(result.current.state.volumeSteps).toBeNull()
  },
)

it.each(['F3', 'F4'])(
  'makes a detected %s hold unknown without counting repeats and refreshes feedback',
  (key) => {
    saveSpeakerState({ source: 'tv', volumeSteps: 50, muted: false })
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    expect(result.current.state.volumeSteps).toBe(key === 'F3' ? 50 : 49)
    advance(1500)
    down(key, true)
    expect(result.current.state.volumeSteps).toBeNull()
    down(key, true)
    down(key, true)
    expect(result.current.state.volumeSteps).toBeNull()
    expect(loadSpeakerState().volumeSteps).toBeNull()
    advance(SPEAKER_FEEDBACK_MS - 1)
    expect(result.current.feedback).toEqual({ syncedEndpoint: null })
    advance(1)
    expect(result.current.feedback).toBeNull()
    up(key)
    advance(SPEAKER_MIN_RESYNC_MS * 2)
    expect(result.current.state.volumeSteps).toBeNull()
    down('F3')
    up('F3')
    down('F4')
    up('F4')
    expect(result.current.state.volumeSteps).toBeNull()
  },
)

it('calibrates a continuous Volume Up hold at MAX and retains confirmation during further repeats', () => {
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 })
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  down('F3', true)
  advance(SPEAKER_MAX_RESYNC_MS - 1)
  expect(result.current.state.volumeSteps).toBeNull()
  advance(1)
  expect(result.current.state.volumeSteps).toBe(50)
  expect(result.current.feedback).toEqual({ syncedEndpoint: 'max' })
  down('F3', true)
  expect(result.current.state.volumeSteps).toBe(50)
  expect(result.current.feedback).toEqual({ syncedEndpoint: 'max' })
  expect(loadSpeakerState()).toEqual(result.current.state)
  up('F3')
  down('F4')
  expect(result.current.state.volumeSteps).toBe(49)
  expect(result.current.feedback).toEqual({ syncedEndpoint: null })
})

it.each(['tv', 'pi-jukebox'] as const)(
  'shows -- in temporary feedback when %s tracking becomes unknown',
  (source) => {
    saveSpeakerState({ source, volumeSteps: 24, muted: false })
    function FeedbackHarness() {
      const speaker = useSpeakerStatus()
      return speaker.feedback ? (
        <SpeakerFeedback
          state={speaker.state}
          syncedEndpoint={speaker.feedback.syncedEndpoint}
        />
      ) : null
    }
    render(<FeedbackHarness />)
    down('F3')
    expect(screen.getByRole('status')).toHaveTextContent(
      `${source === 'tv' ? 'TV' : 'PI JUKEBOX'} | 25`,
    )
    down('F3', true)
    expect(screen.getByRole('status')).toHaveTextContent(
      `${source === 'tv' ? 'TV' : 'PI JUKEBOX'} | --`,
    )
    expect(screen.queryByText('VOLUME SYNCED')).not.toBeInTheDocument()
    advance(SPEAKER_FEEDBACK_MS)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  },
)

it('establishes zero after exactly eight continuous seconds and retains confirmation during repeats', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F2')
  up('F2')
  down('F4')
  for (let i = 0; i < 15; i += 1) {
    advance(500)
    down('F4', true)
    expect(result.current.state.volumeSteps).toBeNull()
  }
  advance(499)
  expect(result.current.state.volumeSteps).toBeNull()
  advance(1)
  expect(result.current.state.volumeSteps).toBe(0)
  expect(result.current.feedback).toEqual({ syncedEndpoint: 'min' })
  down('F4', true)
  expect(result.current.state.volumeSteps).toBe(0)
  expect(result.current.feedback).toEqual({ syncedEndpoint: 'min' })
  expect(loadSpeakerState()).toEqual(result.current.state)
  up('F4')
  down('F3')
  expect(result.current.state.volumeSteps).toBe(1)
  expect(result.current.feedback).toEqual({ syncedEndpoint: null })
})

it('resynchronises an existing value after Down repeats make it unknown without clearing mute', () => {
  saveSpeakerState({ source: 'tv', volumeSteps: 2, muted: true })
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  down('F4', true)
  down('F4', true)
  expect(result.current.state).toEqual({
    source: 'tv',
    volumeSteps: null,
    muted: true,
  })
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(result.current.state.volumeSteps).toBe(0)
  down('F4', true)
  expect(result.current.state.volumeSteps).toBe(0)
  expect(result.current.feedback?.syncedEndpoint).toBe('min')
  expect(result.current.state.muted).toBe(true)
})

it('requires one continuous hold rather than accumulating several short presses', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  advance(5000)
  up('F4')
  down('F4')
  advance(5000)
  expect(result.current.state.volumeSteps).toBeNull()
  up('F4')
  advance(5000)
  expect(result.current.state.volumeSteps).toBeNull()
})

it.each(['Control', 'Shift', 'blur', 'hidden', 'up', 'invalid chord'])(
  'cancels unfinished calibration on %s',
  (reason) => {
    const { result } = renderHook(useSpeakerStatus)
    down('F4')
    advance(3000)
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    else if (reason === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    } else if (reason === 'up') {
      down('F3')
      up('F3')
    } else if (reason === 'invalid chord') down('F4', true, { ctrlKey: false })
    else up(reason)
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBeNull()
  },
)

it.each(['Control', 'Shift', 'blur', 'hidden', 'down', 'invalid chord'])(
  'cancels unfinished MAX calibration on %s',
  (reason) => {
    const { result } = renderHook(useSpeakerStatus)
    down('F3')
    down('F3', true)
    advance(3000)
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    else if (reason === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    } else if (reason === 'down') {
      down('F4')
      up('F4')
    } else if (reason === 'invalid chord') down('F3', true, { ctrlKey: false })
    else up(reason)
    advance(SPEAKER_MAX_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBeNull()
  },
)

it('requires a full new hold duration when direction changes', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  down('F4', true)
  advance(3000)
  down('F3')
  down('F3', true)
  up('F4')
  advance(SPEAKER_MAX_RESYNC_MS - 1)
  expect(result.current.state.volumeSteps).toBeNull()
  advance(1)
  expect(result.current.state.volumeSteps).toBe(50)
})

it('prevents orphan repeats after focus loss from starting calibration and accepts a fresh press', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  fireEvent(window, new Event('blur'))
  down('F4', true)
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(result.current.state.volumeSteps).toBeNull()
  down('F4')
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(result.current.state.volumeSteps).toBe(0)
})

it.each(['F3', 'F4'])(
  'makes known volume unknown on orphan %s repeats without starting calibration',
  (key) => {
    saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 })
    const { result } = renderHook(useSpeakerStatus)
    down(key, true)
    expect(result.current.state.volumeSteps).toBeNull()
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBeNull()
    expect(loadSpeakerState().volumeSteps).toBeNull()
  },
)

it.each([
  ['F4', SPEAKER_MIN_RESYNC_MS, 0],
  ['F3', SPEAKER_MAX_RESYNC_MS, 50],
] as const)(
  'persists %s endpoint and restores state without replaying feedback or a hold',
  (key, duration, volumeSteps) => {
    const first = renderHook(useSpeakerStatus)
    down('F1')
    down('F5')
    down(key)
    advance(duration)
    first.unmount()
    const { result } = renderHook(useSpeakerStatus)
    expect(result.current.state).toEqual({
      source: 'tv',
      volumeSteps,
      muted: true,
    })
    expect(result.current.feedback).toBeNull()
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.feedback).toBeNull()
  },
)

it('cleans up listeners and timers when unmounted during a hold', () => {
  const { unmount } = renderHook(useSpeakerStatus)
  down('F4')
  unmount()
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(loadSpeakerState().volumeSteps).toBeNull()
  expect(down('F1')).toBe(true)
})

it.each([
  ['min', 0, 'VOLUME SYNCED · MIN'],
  ['max', 50, 'VOLUME SYNCED · MAX'],
] as const)(
  'renders %s endpoint status and confirmation without volume controls',
  (syncedEndpoint, volumeSteps, confirmation) => {
    render(
      <SpeakerFeedback
        state={{ source: 'pi-jukebox', volumeSteps, muted: false }}
        syncedEndpoint={syncedEndpoint}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      `PI JUKEBOX | ${volumeSteps}`,
    )
    expect(screen.getByText(confirmation)).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  },
)
