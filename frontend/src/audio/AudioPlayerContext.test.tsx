import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem, QueueSnapshot, Track } from '../api/types'
import { QueueProvider, useQueue } from '../queue/QueueContext'
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
      {player.error ? <p role="alert">{player.error}</p> : null}
      <button type="button" onClick={() => void player.playNow(tracks[0])}>
        Start
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
    </div>
  )
}

function renderPlayer() {
  return render(
    <QueueProvider>
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>
    </QueueProvider>,
  )
}

describe('AudioPlayerProvider queue integration', () => {
  afterEach(() => {
    cleanup()
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
