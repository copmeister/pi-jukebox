import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../api/types'
import { AudioPlayerProvider, useAudioPlayer } from './AudioPlayerContext'

const tracks: Track[] = [
  {
    id: 1,
    album_id: 9,
    relative_path: 'album/01.mp3',
    filename: '01.mp3',
    title: 'First Song',
    artist: 'Test Artist',
    album_artist: 'Test Artist',
    album: 'Test Album',
    disc_number: 1,
    track_number: 1,
    duration_seconds: 100,
    file_format: 'mp3',
    playback_support: 'required',
    artwork_id: null,
  },
  {
    id: 2,
    album_id: 9,
    relative_path: 'album/02.mp3',
    filename: '02.mp3',
    title: 'Second Song',
    artist: 'Test Artist',
    album_artist: 'Test Artist',
    album: 'Test Album',
    disc_number: 1,
    track_number: 2,
    duration_seconds: 120,
    file_format: 'mp3',
    playback_support: 'required',
    artwork_id: null,
  },
]

function Harness() {
  const player = useAudioPlayer()
  return (
    <div>
      <p>{player.currentTrack?.title ?? 'No track'}</p>
      <p>{player.status}</p>
      {player.error ? <p role="alert">{player.error}</p> : null}
      <button type="button" onClick={() => player.playTrack(tracks[0], tracks)}>
        Start
      </button>
      <button type="button" onClick={player.togglePlayback}>
        Toggle
      </button>
      <button type="button" onClick={player.previous}>
        Previous
      </button>
      <button type="button" onClick={player.next}>
        Next
      </button>
      <button type="button" onClick={() => player.seek(45)}>
        Seek
      </button>
      <button type="button" onClick={() => player.setVolume(0.4)}>
        Volume
      </button>
      <button type="button" onClick={player.toggleMute}>
        Mute
      </button>
    </div>
  )
}

describe('AudioPlayerProvider', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('owns one audio element and controls an album playback context', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>,
    )
    const audio = container.querySelector('audio') as HTMLAudioElement
    expect(container.querySelectorAll('audio')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByText('First Song')).toBeInTheDocument()
    expect(screen.getByText('playing')).toBeInTheDocument()
    expect(audio.src).toContain('/api/tracks/1/media')

    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByText('paused')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByText('playing')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Seek' }))
    expect(audio.currentTime).toBe(45)
    await user.click(screen.getByRole('button', { name: 'Volume' }))
    expect(audio.volume).toBe(0.4)
    await user.click(screen.getByRole('button', { name: 'Mute' }))
    expect(audio.muted).toBe(true)

    act(() => audio.dispatchEvent(new Event('ended')))
    expect(screen.getByText('Second Song')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() =>
      expect(screen.getByText('First Song')).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Second Song')).toBeInTheDocument()
  })

  it('shows a useful message when browser playback needs interaction', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(
      new DOMException('blocked', 'NotAllowedError'),
    )
    const user = userEvent.setup()
    const { container } = render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Playback needs a tap',
    )
    expect(screen.getByText('error')).toBeInTheDocument()

    act(() =>
      container.querySelector('audio')?.dispatchEvent(new Event('pause')),
    )
    expect(screen.getByText('error')).toBeInTheDocument()
  })
})
