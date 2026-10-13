import { afterEach, expect, it, vi } from 'vitest'
import {
  applySpeakerCommand,
  formatSpeakerStatus,
  loadSpeakerState,
  saveSpeakerState,
  speakerCommand,
  SPEAKER_INPUTS,
  SPEAKER_STORAGE_KEY,
  UNKNOWN_SPEAKER_STATE,
} from './speakerState'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

it.each([
  ['F1', 'tv'],
  ['F2', 'pi-jukebox'],
  ['F3', 'up'],
  ['F4', 'down'],
  ['F5', 'mute'],
])('recognises Ctrl+Shift+%s', (key, command) => {
  expect(
    speakerCommand(
      new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true }),
    ),
  ).toBe(command)
})

it.each([
  { key: 'F1' },
  { key: 'F2', ctrlKey: true },
  { key: 'F3', shiftKey: true },
  { key: 'F4', ctrlKey: true, shiftKey: true, altKey: true },
  { key: 'F5', ctrlKey: true, shiftKey: true, metaKey: true },
  { key: 'F6', ctrlKey: true, shiftKey: true },
  { key: 'toString', ctrlKey: true, shiftKey: true },
  { key: 'F1', ctrlKey: true, shiftKey: true, isComposing: true },
])('rejects incomplete or unrelated commands: %j', (init) => {
  expect(speakerCommand(new KeyboardEvent('keydown', init))).toBeNull()
})

it('starts unknown and does not invent a volume from up/down commands', () => {
  expect(loadSpeakerState()).toEqual(UNKNOWN_SPEAKER_STATE)
  expect(
    applySpeakerCommand(UNKNOWN_SPEAKER_STATE, 'up').volumeSteps,
  ).toBeNull()
  expect(
    applySpeakerCommand(UNKNOWN_SPEAKER_STATE, 'down').volumeSteps,
  ).toBeNull()
})

it('selects absolute sources and their inputs without clearing mute or volume', () => {
  const state = { ...UNKNOWN_SPEAKER_STATE, volumeSteps: 12, muted: true }
  expect(applySpeakerCommand(state, 'tv')).toEqual({ ...state, source: 'tv' })
  expect(applySpeakerCommand(state, 'pi-jukebox')).toEqual({
    ...state,
    source: 'pi-jukebox',
  })
  expect(SPEAKER_INPUTS).toEqual({ tv: 'OPTICAL', 'pi-jukebox': 'LINE 1' })
})

it('counts single taps within the verified 0-50 range and clamps at both endpoints', () => {
  const state = { ...UNKNOWN_SPEAKER_STATE, volumeSteps: 24 }
  expect(applySpeakerCommand(state, 'up').volumeSteps).toBe(25)
  expect(applySpeakerCommand(state, 'down').volumeSteps).toBe(23)
  expect(
    applySpeakerCommand({ ...state, volumeSteps: 50 }, 'up').volumeSteps,
  ).toBe(50)
  expect(
    applySpeakerCommand({ ...state, volumeSteps: 0 }, 'down').volumeSteps,
  ).toBe(0)
})

it.each([
  [null, null, false, '-- | --'],
  ['tv', null, false, 'TV | --'],
  ['pi-jukebox', 50, false, 'PI JUKEBOX | 50'],
  ['tv', 0, false, 'TV | 0'],
  ['tv', 50, false, 'TV | 50'],
  ['tv', null, true, 'TV | MUTED'],
  ['pi-jukebox', 50, true, 'PI JUKEBOX | MUTED'],
] as const)(
  'formats tracked status',
  (source, volumeSteps, muted, expected) => {
    expect(formatSpeakerStatus({ source, volumeSteps, muted })).toBe(expected)
  },
)

it.each([null, 0, 24, 50])(
  'persists known or unknown steps with source and mute',
  (volumeSteps) => {
    const state = { source: 'pi-jukebox' as const, volumeSteps, muted: true }
    saveSpeakerState(state)
    expect(loadSpeakerState()).toEqual(state)
  },
)

it.each([
  'invalid json',
  'null',
  '{"version":2}',
  '{"version":1,"state":null}',
])('recovers from malformed or unsupported stored state', (stored) => {
  localStorage.setItem(SPEAKER_STORAGE_KEY, stored)
  expect(loadSpeakerState()).toEqual(UNKNOWN_SPEAKER_STATE)
})

it.each([-1, 51, 500, 1.5, '50', null])(
  'does not trust an invalid persisted volume: %j',
  (volumeSteps) => {
    localStorage.setItem(
      SPEAKER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { source: 'tv', volumeSteps, muted: true },
      }),
    )
    expect(loadSpeakerState()).toEqual({
      source: 'tv',
      volumeSteps: null,
      muted: true,
    })
  },
)

it('handles unavailable storage without breaking the application', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(loadSpeakerState()).toEqual(UNKNOWN_SPEAKER_STATE)
  expect(() => saveSpeakerState(UNKNOWN_SPEAKER_STATE)).not.toThrow()
})
