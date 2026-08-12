import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioPlayerProvider } from '../audio/AudioPlayerContext'
import { QueueProvider } from '../queue/QueueContext'
import { SearchScreen } from './SearchScreen'

const results = {
  query: 'northern',
  albums: [
    {
      id: 7,
      title: 'Night Drive',
      album_artist: 'The House Band',
      artwork_id: null,
      track_count: 1,
      duration_seconds: 180,
    },
  ],
  tracks: [
    {
      id: 11,
      album_id: 7,
      relative_path: 'night/01.mp3',
      filename: '01.mp3',
      title: 'Northern Lights',
      artist: 'Guest Vocalist',
      album_artist: 'The House Band',
      album: 'Night Drive',
      disc_number: 1,
      track_number: 1,
      duration_seconds: 180,
      file_format: 'mp3',
      playback_support: 'required',
      artwork_id: null,
    },
  ],
}

const emptyQueue = {
  revision: 0,
  current: null,
  upcoming: [],
  upcoming_count: 0,
  upcoming_duration_seconds: 0,
  warning: null,
}

const playingQueue = {
  ...emptyQueue,
  revision: 1,
  current: {
    id: 41,
    track_id: 11,
    album_id: 7,
    title: 'Northern Lights',
    artist: 'Guest Vocalist',
    album: 'Night Drive',
    duration_seconds: 180,
    artwork_id: null,
    position: 0,
    status: 'current',
    available: true,
  },
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function searchFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/queue')) return jsonResponse(emptyQueue)
    if (url.includes('/api/search?')) return jsonResponse(results)
    if (url.endsWith('/api/queue/tracks/11/play-now'))
      return jsonResponse(playingQueue)
    if (url.endsWith('/api/queue/tracks/11/next'))
      return jsonResponse(playingQueue)
    if (url.endsWith('/api/queue/tracks/11')) return jsonResponse(playingQueue)
    throw new Error(`Unexpected request: ${url}`)
  })
}

function renderSearch(onOpenAlbum = vi.fn()) {
  render(
    <QueueProvider>
      <AudioPlayerProvider>
        <SearchScreen onOpenAlbum={onOpenAlbum} />
      </AudioPlayerProvider>
    </QueueProvider>,
  )
}

async function finishDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350)
  })
}

describe('SearchScreen', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('supports complete touch-keypad entry and updates results', async () => {
    vi.useFakeTimers()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.click(screen.getByRole('button', { name: 'Enter A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter space' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter 1' }))
    expect(input).toHaveValue('ab 1')
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(input).toHaveValue('ab ')
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0])
    expect(input).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Enter N' }))
    await finishDebounce()
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('q=n')),
    ).toBe(true)
    expect(screen.getByText('Northern Lights')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide keypad' }))
    expect(
      screen.queryByRole('region', { name: 'Touch search keypad' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show keypad' }))
    expect(
      screen.getByRole('region', { name: 'Touch search keypad' }),
    ).toBeInTheDocument()
  })

  it('keeps physical input and exposes Play Now, Play Next, and Add to Queue', async () => {
    vi.useFakeTimers()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    const onOpenAlbum = vi.fn()
    renderSearch(onOpenAlbum)

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'physical keyboard' },
    })
    expect(screen.getByRole('searchbox')).toHaveValue('physical keyboard')
    await finishDebounce()

    fireEvent.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    expect(screen.getByRole('button', { name: 'Play Now' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Play Next' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add to Queue' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play Now' }))
    await act(async () => Promise.resolve())
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/api/queue/tracks/11/play-now'),
      ),
    ).toBe(true)

    fireEvent.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play Next' }))
    await act(async () => Promise.resolve())
    fireEvent.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to Queue' }))
    await act(async () => Promise.resolve())
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/api/queue/tracks/11/next'),
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/api/queue/tracks/11'),
      ),
    ).toBe(true)

    fireEvent.click(
      screen.getByRole('button', { name: /open album night drive for track/i }),
    )
    expect(onOpenAlbum).toHaveBeenCalledWith(7)
  })
})
