import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_JUKEBOX_SOUND_SETTINGS,
  JUKEBOX_SOUND_STORAGE_KEY,
  loadJukeboxSoundSettings,
  saveJukeboxSoundSettings,
} from './soundSettings'

describe('Jukebox sound settings', () => {
  it('restores versioned settings and clamps stored volumes', () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          version: 1,
          settings: {
            enabled: false,
            masterVolume: 1.8,
            buttonVolume: -0.5,
            movementVolume: 0.42,
            confirmationVolume: 'loud',
          },
        }),
      ),
    }

    expect(loadJukeboxSoundSettings(storage)).toEqual({
      enabled: false,
      masterVolume: 1,
      buttonVolume: 0,
      movementVolume: 0.42,
      confirmationVolume: DEFAULT_JUKEBOX_SOUND_SETTINGS.confirmationVolume,
      loadingVolume: DEFAULT_JUKEBOX_SOUND_SETTINGS.loadingVolume,
      loadingPause: DEFAULT_JUKEBOX_SOUND_SETTINGS.loadingPause,
    })
  })

  it('supplies loading defaults when restoring settings saved before loading support', () => {
    expect(
      loadJukeboxSoundSettings({
        getItem: () =>
          JSON.stringify({
            version: 1,
            settings: {
              enabled: true,
              masterVolume: 0.4,
              buttonVolume: 0.5,
              movementVolume: 0.3,
              confirmationVolume: 0.6,
            },
          }),
      }),
    ).toMatchObject({
      masterVolume: 0.4,
      loadingVolume: 0.45,
      loadingPause: true,
    })
  })

  it('falls back safely for corrupted, unavailable, or old settings', () => {
    expect(loadJukeboxSoundSettings({ getItem: () => '{not-json' })).toEqual(
      DEFAULT_JUKEBOX_SOUND_SETTINGS,
    )
    expect(
      loadJukeboxSoundSettings({
        getItem: () => JSON.stringify({ version: 99, settings: {} }),
      }),
    ).toEqual(DEFAULT_JUKEBOX_SOUND_SETTINGS)
    expect(
      loadJukeboxSoundSettings({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toEqual(DEFAULT_JUKEBOX_SOUND_SETTINGS)
  })

  it('persists immediately in the versioned local format and ignores failures', () => {
    const setItem = vi.fn()
    saveJukeboxSoundSettings(DEFAULT_JUKEBOX_SOUND_SETTINGS, { setItem })

    expect(setItem).toHaveBeenCalledWith(
      JUKEBOX_SOUND_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        settings: DEFAULT_JUKEBOX_SOUND_SETTINGS,
      }),
    )
    expect(() =>
      saveJukeboxSoundSettings(DEFAULT_JUKEBOX_SOUND_SETTINGS, {
        setItem: () => {
          throw new Error('full')
        },
      }),
    ).not.toThrow()
  })
})
