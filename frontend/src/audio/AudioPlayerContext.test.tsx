import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem, QueueSnapshot, Track } from '../api/types'
import { DEFAULT_JUKEBOX_SOUND_SETTINGS } from '../jukebox/soundSettings'
import type { JukeboxSoundController } from '../jukebox/sounds'
import { QueueProvider, useQueue } from '../queue/QueueContext'
import { radioStationById } from '../radio/stations'
import { AudioPlayerProvider, useAudioPlayer } from './AudioPlayerContext'

const classicFm = radioStationById('classic-fm')!
const smoothRadio = radioStationById('smooth-radio')!

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

function item(track: Track, id: number, position: number): QueueItem {
  return {
    id,
    track_id: track.id,
    album_id: track.album_id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration_seconds: track.duration_seconds,
    artwork_id: track.artwork_id,
    position,
    status: position === 0 ? 'current' : 'upcoming',
    available: true,
  }
}

function snapshot(
  current: QueueItem | null = null,
  upcoming: QueueItem[] = [],
): QueueSnapshot {
  return {
    revision: 1,
    current,
    upcoming,
    upcoming_count: upcoming.length,
    upcoming_duration_seconds: upcoming.reduce(
      (total, queued) => total + (queued.duration_seconds ?? 0),
      0,
    ),
    warning: null,
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function queueFetch(initial = snapshot()) {
  let state = initial
  let nextId = 20
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (
        url.endsWith('/api/queue') &&
        (!init?.method || init.method === 'GET')
      ) {
        return jsonResponse(state)
      }
      const playNowMatch = url.match(/\/api\/queue\/tracks\/(\d+)\/play-now$/)
      if (playNowMatch) {
        const track = tracks.find(
          (candidate) => candidate.id === Number(playNowMatch[1]),
        )!
        state = snapshot(item(track, nextId++, 0), state.upcoming)
        return jsonResponse(state)
      }
      const addMatch = url.match(/\/api\/queue\/tracks\/(\d+)$/)
      if (addMatch) {
        const track = tracks.find(
          (candidate) => candidate.id === Number(addMatch[1]),
        )!
        state = snapshot(state.current, [
          ...state.upcoming,
          item(track, nextId++, state.upcoming.length + 1),
        ])
        return jsonResponse(state)
      }
      if (url.endsWith('/api/queue/advance')) {
        const body = JSON.parse(String(init?.body)) as {
          current_item_id: number
        }
        if (state.current?.id !== body.current_item_id)
          return jsonResponse({}, 409)
        const [next, ...remaining] = state.upcoming
        state = snapshot(
          next ? { ...next, position: 0, status: 'current' } : null,
          remaining.map((queued, index) => ({
            ...queued,
            position: index + 1,
          })),
        )
        return jsonResponse(state)
      }
      if (url.endsWith('/api/queue') && init?.method === 'DELETE') {
        state = snapshot()
        return jsonResponse(state)
      }
      throw new Error(`Unexpected request: ${url}`)
    },
  )
  return { fetchMock, getState: () => state }
}

function Harness() {
  const player = useAudioPlayer()
  const queue = useQueue()
  return (
    <div>
      <p>{player.currentTrack?.title ?? 'No track'}</p>
      <p>{player.status}</p>
      <p>{player.source}</p>
      <p>{player.radioStation?.name ?? 'No radio station'}</p>
      {player.error ? <p role="alert">{player.error}</p> : null}
      <button type="button" onClick={() => void player.playNow(tracks[0])}>
        Start
      </button>
      <button
        type="button"
        onClick={() => void player.playJukebox(tracks[0], 'B1')}
      >
        Start Jukebox
      </button>
      <button type="button" onClick={() => void player.playNow(tracks[1])}>
        Start modern second
      </button>
      <button type="button" onClick={() => void player.playRadio(classicFm)}>
        Start Classic FM
      </button>
      <button type="button" onClick={() => void player.playRadio(smoothRadio)}>
        Start Smooth Radio
      </button>
      <button type="button" onClick={player.stopRadio}>
        Stop Radio
      </button>
      <button type="button" onClick={() => void queue.addTrack(tracks[1].id)}>
        Add second
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
      <button type="button" onClick={() => void player.stopAndClear()}>
        Stop
      </button>
      <p>{player.presentation}</p>
      <p>{player.presentationMessage ?? 'No presentation message'}</p>
    </div>
  )
}

function soundController(
  settings: Partial<JukeboxSoundController['settings']> = {},
): JukeboxSoundController {
  return {
    settings: { ...DEFAULT_JUKEBOX_SOUND_SETTINGS, ...settings },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    playButton: vi.fn(),
    playMovement: vi.fn(),
    playConfirmation: vi.fn(),
    playLoading: vi.fn(() => vi.fn()),
    preview: vi.fn(),
  }
}

function renderPlayer(
  sounds = soundController(),
  jukeboxLoadingDelayMs = 900,
  radioRetryDelayMs = 4_000,
) {
  return render(
    <QueueProvider>
      <AudioPlayerProvider
        soundController={sounds}
        jukeboxLoadingDelayMs={jukeboxLoadingDelayMs}
        radioRetryDelayMs={radioRetryDelayMs}
      >
        <Harness />
      </AudioPlayerProvider>
    </QueueProvider>,
  )
}

async function flushAsyncWork() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

describe('AudioPlayerProvider queue integration', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('owns one audio element and advances exactly once for duplicate ended events', async () => {
    const queueApi = queueFetch()
    vi.stubGlobal('fetch', queueApi.fetchMock)
    const user = userEvent.setup()
    const { container } = renderPlayer()
    const audio = container.querySelector('audio') as HTMLAudioElement
    expect(container.querySelectorAll('audio')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('First Song')).toBeInTheDocument()
    expect(screen.getByText('playing')).toBeInTheDocument()
    expect(audio.src).toContain('/api/tracks/1/media')
    await user.click(screen.getByRole('button', { name: 'Add second' }))

    act(() => {
      audio.dispatchEvent(new Event('ended'))
      audio.dispatchEvent(new Event('ended'))
    })
    expect(await screen.findByText('Second Song')).toBeInTheDocument()
    expect(
      queueApi.fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/queue/advance'),
      ),
    ).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('First Song')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Seek' }))
    expect(audio.currentTime).toBe(45)
    await user.click(screen.getByRole('button', { name: 'Volume' }))
    expect(audio.volume).toBe(0.4)
    await user.click(screen.getByRole('button', { name: 'Mute' }))
    expect(audio.muted).toBe(true)
  })

  it('plays and switches radio on the single audio element without mutating the queue', async () => {
    const initial = snapshot(item(tracks[0], 10, 0), [item(tracks[1], 11, 1)])
    const queueApi = queueFetch(initial)
    vi.stubGlobal('fetch', queueApi.fetchMock)
    const user = userEvent.setup()
    const { container } = renderPlayer()
    const audio = container.querySelector('audio') as HTMLAudioElement
    await screen.findByText('First Song')

    await user.click(screen.getByRole('button', { name: 'Start Classic FM' }))
    expect(screen.getByText('Classic FM')).toBeInTheDocument()
    expect(screen.getByText('radio')).toBeInTheDocument()
    expect(screen.getByText('playing')).toBeInTheDocument()
    expect(audio.src).toBe(classicFm.streamUrl)
    expect(container.querySelectorAll('audio')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Start Smooth Radio' }))
    expect(screen.getByText('Smooth Radio')).toBeInTheDocument()
    expect(audio.src).toBe(smoothRadio.streamUrl)
    expect(queueApi.getState()).toEqual(initial)
    expect(
      queueApi.fetchMock.mock.calls.filter(([, init]) => init?.method),
    ).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Stop Radio' }))
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('No radio station')).toBeInTheDocument()
    expect(screen.getByText('First Song')).toBeInTheDocument()
    expect(screen.getByText('paused')).toBeInTheDocument()
    expect(audio.src).toContain('/api/tracks/1/media')
  })

  it('keeps a failed radio source isolated and retries until it is stopped', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    playMock
      .mockRejectedValueOnce(
        new DOMException('stream failed', 'NotSupportedError'),
      )
      .mockRejectedValueOnce(
        new DOMException('stream failed', 'NotSupportedError'),
      )
    const { container } = renderPlayer(soundController(), 900, 25)
    const audio = container.querySelector('audio') as HTMLAudioElement

    fireEvent.click(screen.getByRole('button', { name: 'Start Classic FM' }))
    await flushAsyncWork()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Classic FM is unavailable. Reconnecting shortly',
    )
    expect(screen.getByText('radio')).toBeInTheDocument()
    expect(playMock).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTime(25))
    await flushAsyncWork()
    expect(playMock).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Stop Radio' }))
    await act(async () => vi.advanceTimersByTime(100))
    expect(playMock).toHaveBeenCalledTimes(2)
    expect(audio.hasAttribute('src')).toBe(false)
    expect(screen.getByText('idle')).toBeInTheDocument()
    expect(screen.getByText('local')).toBeInTheDocument()
  })

  it('holds an idle Jukebox selection for the mechanical loading sequence', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const sounds = soundController()
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    const { container } = renderPlayer(sounds)
    const audio = container.querySelector('audio') as HTMLAudioElement

    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()

    expect(screen.getByText('First Song')).toBeInTheDocument()
    expect(screen.getByText('Loading B1…')).toBeInTheDocument()
    expect(screen.getByText('jukebox')).toBeInTheDocument()
    expect(audio.currentTime).toBe(0)
    expect(playMock).not.toHaveBeenCalled()
    expect(sounds.playConfirmation).toHaveBeenCalledTimes(1)
    expect(sounds.playLoading).toHaveBeenCalledWith(900)

    await act(async () => vi.advanceTimersByTime(899))
    expect(playMock).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(audio.src).toContain('/api/tracks/1/media')
    expect(audio.currentTime).toBe(0)
    expect(screen.getByText('playing')).toBeInTheDocument()
  })

  it('loads between queued Jukebox tracks without another latch or double advance', async () => {
    vi.useFakeTimers()
    const queueApi = queueFetch()
    vi.stubGlobal('fetch', queueApi.fetchMock)
    const sounds = soundController()
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    const { container } = renderPlayer(sounds)
    const audio = container.querySelector('audio') as HTMLAudioElement

    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    await act(async () => vi.advanceTimersByTime(900))
    fireEvent.click(screen.getByRole('button', { name: 'Add second' }))
    await flushAsyncWork()

    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
      audio.dispatchEvent(new Event('ended'))
      await Promise.resolve()
    })
    expect(screen.getByText('Second Song')).toBeInTheDocument()
    expect(screen.getByText('Changing record…')).toBeInTheDocument()
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(sounds.playLoading).toHaveBeenCalledTimes(2)
    expect(sounds.playConfirmation).toHaveBeenCalledTimes(1)
    expect(
      queueApi.fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/queue/advance'),
      ),
    ).toHaveLength(1)

    await act(async () => vi.advanceTimersByTime(900))
    expect(playMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      audio.dispatchEvent(new Event('ended'))
      await Promise.resolve()
    })
    await flushAsyncWork()
    expect(sounds.playLoading).toHaveBeenCalledTimes(2)
    expect(screen.getByText('No track')).toBeInTheDocument()
  })

  it('cancels a pending Jukebox start when Stop & Clear is chosen', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const cancelLoading = vi.fn()
    const sounds = soundController()
    vi.mocked(sounds.playLoading).mockReturnValue(cancelLoading)
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    renderPlayer(sounds)

    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await flushAsyncWork()
    await act(async () => vi.advanceTimersByTime(900))

    expect(cancelLoading).toHaveBeenCalledTimes(1)
    expect(playMock).not.toHaveBeenCalled()
    expect(screen.getByText('No track')).toBeInTheDocument()
    expect(screen.getByText('modern')).toBeInTheDocument()
  })

  it('cancels a pending Jukebox start when the provider unmounts', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const cancelLoading = vi.fn()
    const sounds = soundController()
    vi.mocked(sounds.playLoading).mockReturnValue(cancelLoading)
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    const { unmount } = renderPlayer(sounds)

    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    unmount()
    await act(async () => vi.advanceTimersByTime(900))

    expect(cancelLoading).toHaveBeenCalledTimes(1)
    expect(playMock).not.toHaveBeenCalled()
  })

  it('cancels a pending Jukebox start when modern Play Now supersedes it', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const cancelLoading = vi.fn()
    const sounds = soundController()
    vi.mocked(sounds.playLoading).mockReturnValue(cancelLoading)
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    const { container } = renderPlayer(sounds)

    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    fireEvent.click(screen.getByRole('button', { name: 'Start modern second' }))
    await flushAsyncWork()

    const audio = container.querySelector('audio') as HTMLAudioElement
    expect(cancelLoading).toHaveBeenCalledTimes(1)
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(audio.src).toContain('/api/tracks/2/media')
    expect(screen.getByText('modern')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(900))
    expect(playMock).toHaveBeenCalledTimes(1)
  })

  it('honours disabled, silent-loading, and pause-off settings', async () => {
    vi.useFakeTimers()
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)

    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const disabledSounds = soundController({ enabled: false })
    playMock.mockClear()
    renderPlayer(disabledSounds)
    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(disabledSounds.playConfirmation).not.toHaveBeenCalled()
    expect(disabledSounds.playLoading).not.toHaveBeenCalled()

    cleanup()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const silentLoading = soundController({ loadingVolume: 0 })
    playMock.mockClear()
    renderPlayer(silentLoading)
    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    expect(playMock).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(900))
    expect(playMock).toHaveBeenCalledTimes(1)

    cleanup()
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    const pauseOff = soundController({ loadingPause: false })
    playMock.mockClear()
    renderPlayer(pauseOff)
    fireEvent.click(screen.getByRole('button', { name: 'Start Jukebox' }))
    await flushAsyncWork()
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(pauseOff.playLoading).not.toHaveBeenCalled()
  })

  it('restores persisted current metadata paused without autoplay', async () => {
    const restored = snapshot(item(tracks[0], 10, 0), [item(tracks[1], 11, 1)])
    vi.stubGlobal('fetch', queueFetch(restored).fetchMock)
    const playMock = vi.mocked(HTMLMediaElement.prototype.play)
    playMock.mockClear()
    const user = userEvent.setup()
    const { container } = renderPlayer()

    expect(await screen.findByText('First Song')).toBeInTheDocument()
    expect(screen.getByText('paused')).toBeInTheDocument()
    expect(playMock).not.toHaveBeenCalled()
    expect(
      (container.querySelector('audio') as HTMLAudioElement).currentTime,
    ).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('playing')).toBeInTheDocument()
  })

  it('keeps a useful error when browser playback requires interaction', async () => {
    vi.stubGlobal('fetch', queueFetch().fetchMock)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(
      new DOMException('blocked', 'NotAllowedError'),
    )
    const user = userEvent.setup()
    const { container } = renderPlayer()

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
