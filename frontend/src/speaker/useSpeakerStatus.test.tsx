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
  SPEAKER_STORAGE_KEY,
  UNKNOWN_SPEAKER_STATE,
} from './speakerState'
import {
  useSpeakerStatus,
  SPEAKER_FEEDBACK_MS,
  SPEAKER_MIN_RESYNC_MS,
  SPEAKER_HOLD_STEP_MS,
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
function FeedbackHarness() {
  const speaker = useSpeakerStatus()
  return speaker.feedback ? (
    <SpeakerFeedback
      state={speaker.state}
      syncedEndpoint={speaker.feedback.syncedEndpoint}
    />
  ) : null
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
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

it('selects sources once per press without extending feedback on source repeats', () => {
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

it('toggles mute only once per press including duplicate non-repeat keydowns', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F5')
  down('F5', true)
  down('F5')
  expect(result.current.state.muted).toBe(true)
  up('F5')
  down('F5')
  expect(result.current.state.muted).toBe(false)
})

it.each([
  ['F3', 25],
  ['F4', 23],
] as const)(
  'counts a clean %s tap once with no timer double-count',
  (key, value) => {
    saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 })
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    down(key)
    advance(80)
    up(key)
    expect(result.current.state.volumeSteps).toBe(value)
    advance(1000)
    expect(result.current.state.volumeSteps).toBe(value)
    expect(loadSpeakerState().volumeSteps).toBe(value)
  },
)

it.each([
  ['F3', 50],
  ['F4', 0],
] as const)('clamps clean %s taps at %i', (key, volumeSteps) => {
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps })
  const { result } = renderHook(useSpeakerStatus)
  down(key)
  up(key)
  down(key)
  up(key)
  expect(result.current.state.volumeSteps).toBe(volumeSteps)
})

it.each([
  ['F3', 25, 26, 27],
  ['F4', 23, 22, 21],
] as const)(
  'advances held %s by elapsed time at 128 ms per additional speaker step',
  (key, initial, second, third) => {
    expect(SPEAKER_HOLD_STEP_MS).toBe(128)
    saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 })
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    expect(result.current.state.volumeSteps).toBe(initial)
    advance(127)
    expect(result.current.state.volumeSteps).toBe(initial)
    advance(1)
    expect(result.current.state.volumeSteps).toBe(second)
    advance(128)
    expect(result.current.state.volumeSteps).toBe(third)
    down(key, true)
    expect(result.current.state.volumeSteps).toBe(third)
    up(key)
    advance(500)
    expect(result.current.state.volumeSteps).toBe(third)
  },
)

it.each(['F3', 'F4'])(
  'retains known volume on %s repeats and ignores their count and frequency',
  (key) => {
    saveSpeakerState({ source: 'tv', volumeSteps: 24, muted: false })
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    advance(268)
    const value = key === 'F3' ? 27 : 21
    expect(result.current.state.volumeSteps).toBe(value)
    for (let i = 0; i < 100; i += 1) down(key, true)
    expect(result.current.state.volumeSteps).toBe(value)
    advance(40)
    down(key, true)
    expect(result.current.state.volumeSteps).toBe(value)
    advance(76)
    expect(result.current.state.volumeSteps).toBe(key === 'F3' ? 28 : 20)
    up(key)
    expect(loadSpeakerState().volumeSteps).toBe(key === 'F3' ? 28 : 20)
  },
)

it('catches up after a delayed callback without accumulating interval-count drift', () => {
  let now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 12 })
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  now = 2000
  advance(128) // One callback runs late; 1000 ms of real elapsed time passed.
  expect(result.current.state.volumeSteps).toBe(20)
  now = 2024
  advance(24) // Next wake is aligned to the original timestamp's 1024 ms boundary.
  expect(result.current.state.volumeSteps).toBe(21)
  up('F3')
  advance(1000)
  expect(result.current.state.volumeSteps).toBe(21)
})

it('samples elapsed time on release if the final timer callback was delayed', () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 12 })
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  now = 512
  up('F3')
  expect(result.current.state.volumeSteps).toBe(17)
  advance(1000)
  expect(result.current.state.volumeSteps).toBe(17)
})

it.each([
  ['F3', 49, 50],
  ['F4', 1, 0],
] as const)(
  'holds %s at the endpoint with no false calibration',
  (key, start, end) => {
    saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: start })
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    advance(SPEAKER_MIN_RESYNC_MS - 1)
    down(key, true)
    expect(result.current.state.volumeSteps).toBe(end)
    expect(result.current.feedback).toEqual({ syncedEndpoint: null })
    up(key)
  },
)

it.each(['F3', 'F4'])(
  'keeps unknown volume unknown during ordinary %s taps and short holds',
  (key) => {
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    up(key)
    down(key)
    advance(SPEAKER_MIN_RESYNC_MS - 100)
    down(key, true)
    expect(result.current.state.volumeSteps).toBeNull()
    expect(result.current.feedback).toEqual({ syncedEndpoint: null })
    up(key)
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBeNull()
  },
)

it('does not calibrate unknown volume or show a MAX confirmation on a long Up hold', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  advance(SPEAKER_MIN_RESYNC_MS * 2)
  expect(result.current.state.volumeSteps).toBeNull()
  expect(result.current.feedback).toEqual({ syncedEndpoint: null })
  up('F3')
})

it.each(['tv', 'pi-jukebox'] as const)(
  'calibrates %s from the first-ever Down press without priming or an existing overlay',
  (source) => {
    expect(SPEAKER_MIN_RESYNC_MS).toBe(8000)
    saveSpeakerState({ source, volumeSteps: null, muted: false })
    render(<FeedbackHarness />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    down('F4')
    const label = source === 'tv' ? 'TV' : 'PI JUKEBOX'
    expect(screen.getByRole('status')).toHaveTextContent(`${label} | --`)
    for (let elapsed = 100; elapsed < SPEAKER_MIN_RESYNC_MS; elapsed += 100) {
      advance(100)
      down('F4', true)
    }
    expect(loadSpeakerState().volumeSteps).toBeNull()
    expect(screen.queryByText('VOLUME SYNCED · MIN')).not.toBeInTheDocument()
    advance(99)
    expect(loadSpeakerState().volumeSteps).toBeNull()
    advance(1)
    expect(screen.getByRole('status')).toHaveTextContent(`${label} | 0`)
    expect(screen.getByText('VOLUME SYNCED · MIN')).toBeInTheDocument()
    down('F4', true)
    advance(2000)
    expect(screen.getByText('VOLUME SYNCED · MIN')).toBeInTheDocument()
    up('F4')
    advance(SPEAKER_FEEDBACK_MS - 1)
    expect(screen.getByRole('status')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  },
)

it.each([false, true])(
  'starts calibration on the first qualifying Down event (repeat=%s)',
  (repeat) => {
    const { result } = renderHook(useSpeakerStatus)
    down('F4', false, { ctrlKey: false })
    down('F4', repeat)
    advance(SPEAKER_MIN_RESYNC_MS - 1)
    expect(result.current.state.volumeSteps).toBeNull()
    advance(1)
    expect(result.current.state.volumeSteps).toBe(0)
    expect(result.current.feedback?.syncedEndpoint).toBe('min')
  },
)

it('does not restart the calibration clock when source/mute or overlay renders change', () => {
  const { result, rerender } = renderHook(useSpeakerStatus)
  down('F4')
  advance(SPEAKER_MIN_RESYNC_MS / 2)
  down('F1')
  up('F1')
  down('F5')
  up('F5')
  rerender()
  advance(SPEAKER_MIN_RESYNC_MS / 2 - 1)
  expect(result.current.state.volumeSteps).toBeNull()
  advance(1)
  expect(result.current.state).toEqual({
    source: 'tv',
    volumeSteps: 0,
    muted: true,
  })
  expect(result.current.feedback?.syncedEndpoint).toBe('min')
})

it.each([
  ['F3', 50],
  ['F4', null],
] as const)(
  'keeps %s feedback visible while held and times out only after release',
  (key, start) => {
    saveSpeakerState({ source: 'tv', volumeSteps: start, muted: false })
    render(<FeedbackHarness />)
    down(key)
    advance(4000)
    expect(screen.getByRole('status')).toHaveTextContent(
      `TV | ${start ?? '--'}`,
    )
    up(key)
    advance(SPEAKER_FEEDBACK_MS - 1)
    expect(screen.getByRole('status')).toBeInTheDocument()
    advance(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  },
)

it('updates integer feedback during a known hold without hiding or resetting its clock', () => {
  saveSpeakerState({ source: 'pi-jukebox', volumeSteps: 12, muted: false })
  render(<FeedbackHarness />)
  down('F3')
  expect(screen.getByRole('status')).toHaveTextContent('PI JUKEBOX | 13')
  advance(128)
  expect(screen.getByRole('status')).toHaveTextContent('PI JUKEBOX | 14')
  advance(128 * 20)
  expect(screen.getByRole('status')).toHaveTextContent('PI JUKEBOX | 34')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  up('F3')
})

it('requires one continuous Down hold rather than accumulating shorter presses', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  advance(SPEAKER_MIN_RESYNC_MS - 100)
  up('F4')
  down('F4')
  advance(SPEAKER_MIN_RESYNC_MS - 100)
  expect(result.current.state.volumeSteps).toBeNull()
  up('F4')
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(result.current.state.volumeSteps).toBeNull()
})

it.each(['Control', 'Shift', 'blur', 'hidden', 'up', 'invalid chord'])(
  'cancels an incomplete calibration on %s and rejects late repeats',
  (reason) => {
    const { result } = renderHook(useSpeakerStatus)
    down('F4')
    advance(SPEAKER_MIN_RESYNC_MS - 100)
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    else if (reason === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    } else if (reason === 'up') {
      down('F3')
      up('F3')
    } else if (reason === 'invalid chord') down('F4', true, { ctrlKey: false })
    else up(reason)
    down('F4', true)
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBeNull()
    up('F4')
    down('F4')
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBe(0)
  },
)

it.each(['F3', 'F4'])(
  'stops %s estimated movement on focus loss without losing known state',
  (key) => {
    saveSpeakerState({ ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 })
    const { result } = renderHook(useSpeakerStatus)
    down(key)
    advance(512)
    fireEvent(window, new Event('blur'))
    const final = key === 'F3' ? 29 : 19
    expect(result.current.state.volumeSteps).toBe(final)
    down(key, true)
    advance(SPEAKER_MIN_RESYNC_MS)
    expect(result.current.state.volumeSteps).toBe(final)
  },
)

it('requires the full Down duration after switching direction and ignores old Up repeats', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F3')
  advance(10000)
  down('F4')
  down('F3', true)
  up('F3')
  advance(SPEAKER_MIN_RESYNC_MS - 1)
  expect(result.current.state.volumeSteps).toBeNull()
  advance(1)
  expect(result.current.state.volumeSteps).toBe(0)
})

it('persists a final estimated value without gesture state or resumed movement', () => {
  saveSpeakerState({ source: 'tv', volumeSteps: 12, muted: true })
  const first = renderHook(useSpeakerStatus)
  down('F3')
  advance(512)
  up('F3')
  expect(loadSpeakerState()).toEqual({
    source: 'tv',
    volumeSteps: 17,
    muted: true,
  })
  expect(JSON.parse(localStorage.getItem(SPEAKER_STORAGE_KEY)!)).toEqual({
    version: 1,
    state: { source: 'tv', volumeSteps: 17, muted: true },
  })
  first.unmount()
  const { result } = renderHook(useSpeakerStatus)
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(result.current.state.volumeSteps).toBe(17)
  expect(result.current.feedback).toBeNull()
})

it('restores a calibrated zero with source/mute and no startup feedback', () => {
  const first = renderHook(useSpeakerStatus)
  down('F2')
  up('F2')
  down('F5')
  up('F5')
  down('F4')
  advance(SPEAKER_MIN_RESYNC_MS)
  first.unmount()
  const { result } = renderHook(useSpeakerStatus)
  expect(result.current.state).toEqual({
    source: 'pi-jukebox',
    volumeSteps: 0,
    muted: true,
  })
  expect(result.current.feedback).toBeNull()
})

it('retains calibrated zero if focus is lost after synchronisation', () => {
  const { result } = renderHook(useSpeakerStatus)
  down('F4')
  advance(SPEAKER_MIN_RESYNC_MS)
  fireEvent(window, new Event('blur'))
  down('F4', true)
  advance(1000)
  expect(result.current.state.volumeSteps).toBe(0)
  expect(loadSpeakerState().volumeSteps).toBe(0)
})

it('cleans up timers and listeners when unmounted during an incomplete hold', () => {
  const { unmount } = renderHook(useSpeakerStatus)
  down('F4')
  unmount()
  advance(SPEAKER_MIN_RESYNC_MS)
  expect(loadSpeakerState().volumeSteps).toBeNull()
  expect(down('F1')).toBe(true)
})

it('renders MIN confirmation and raw integer status without volume controls', () => {
  render(
    <SpeakerFeedback
      state={{ source: 'pi-jukebox', volumeSteps: 0, muted: false }}
      syncedEndpoint="min"
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('PI JUKEBOX | 0')
  expect(screen.getByText('VOLUME SYNCED · MIN')).toBeInTheDocument()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})
