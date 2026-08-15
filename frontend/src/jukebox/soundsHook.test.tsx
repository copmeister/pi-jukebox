import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_JUKEBOX_SOUND_SETTINGS,
  JUKEBOX_SOUND_STORAGE_KEY,
} from './soundSettings'
import { useJukeboxSounds } from './sounds'

function SoundSettingsHarness() {
  const sounds = useJukeboxSounds()

  return (
    <>
      <output aria-label="Master effects volume">
        {sounds.settings.masterVolume}
      </output>
      <button
        type="button"
        onClick={() => sounds.updateSettings({ masterVolume: 0.2 })}
      >
        Change
      </button>
      <button type="button" onClick={sounds.resetSettings}>
        Reset
      </button>
    </>
  )
}

describe('useJukeboxSounds', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('restores, saves, and resets the versioned local settings', async () => {
    localStorage.setItem(
      JUKEBOX_SOUND_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        settings: {
          ...DEFAULT_JUKEBOX_SOUND_SETTINGS,
          masterVolume: 0.3,
        },
      }),
    )
    const user = userEvent.setup()
    render(<SoundSettingsHarness />)

    expect(
      screen.getByRole('status', { name: 'Master effects volume' }),
    ).toHaveTextContent('0.3')

    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(
      JSON.parse(localStorage.getItem(JUKEBOX_SOUND_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({ version: 1, settings: { masterVolume: 0.2 } })

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(
      screen.getByRole('status', { name: 'Master effects volume' }),
    ).toHaveTextContent(String(DEFAULT_JUKEBOX_SOUND_SETTINGS.masterVolume))
    expect(
      JSON.parse(localStorage.getItem(JUKEBOX_SOUND_STORAGE_KEY) ?? '{}'),
    ).toEqual({ version: 1, settings: DEFAULT_JUKEBOX_SOUND_SETTINGS })
  })
})
