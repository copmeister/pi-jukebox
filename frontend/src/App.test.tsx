import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const albums = [
  {
    id: 7,
    title: 'Night Drive',
    album_artist: 'The House Band',
    artwork_id: null,
    track_count: 2,
    duration_seconds: 360,
  },
]

const scanStatus = {
  configured: true,
  available: true,
  configuration_error: null,
  running: false,
  latest_scan: {
    id: 3,
    status: 'completed',
    started_at: '2026-08-12T09:00:00Z',
    finished_at: '2026-08-12T09:00:01Z',
    files_discovered: 2,
    files_added: 0,
    files_updated: 0,
    files_unchanged: 2,
    files_removed: 0,
    files_with_errors: 0,
    error_message: null,
  },
}

const albumDetail = {
  ...albums[0],
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
    id: 51,
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

const cdStatus = {
  drive: {
    configured: true,
    available: true,
    disc_present: false,
    message: 'Insert an audio CD.',
    disc: null,
  },
  storage: {
    configured: true,
    available: true,
    mounted: true,
    writable: true,
    free_bytes: 20_000_000_000,
    message: 'External storage is ready.',
  },
  metadata_state: 'idle',
  metadata_message: null,
  release_candidates: [],
  selected_release_id: null,
  active: false,
  latest_job: null,
  rip_action: {
    action: 'unavailable',
    message: 'Insert and identify an audio CD first.',
    source_job_id: null,
  },
}

const updateStatus = {
  installed_version: '0.5.0',
  latest_version: '0.5.0',
  checking: false,
  installing: false,
  update_available: false,
  install_available: false,
  message: 'This jukebox is up to date.',
  last_error: null,
  source: 'Authenticated GitHub Releases via the local GitHub CLI',
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('App catalogue interface', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/albums?limit=500')) return jsonResponse(albums)
        if (url.endsWith('/api/tracks')) return jsonResponse(albumDetail.tracks)
        if (url.endsWith('/api/queue')) return jsonResponse(emptyQueue)
        if (url.endsWith('/api/library/scan/status'))
          return jsonResponse(scanStatus)
        if (url.endsWith('/api/cd/status')) return jsonResponse(cdStatus)
        if (url.endsWith('/api/system/updates'))
          return jsonResponse(updateStatus)
        if (url.endsWith('/api/albums/7')) return jsonResponse(albumDetail)
        if (url.endsWith('/api/queue/tracks/11/play-now'))
          return jsonResponse(playingQueue)
        if (url.endsWith('/api/queue/albums/7/play'))
          return jsonResponse(playingQueue)
        if (url.endsWith('/api/queue/albums/7'))
          return jsonResponse({
            ...playingQueue,
            upcoming: [
              {
                ...playingQueue.current,
                id: 52,
                position: 1,
                status: 'upcoming',
              },
            ],
            upcoming_count: 1,
            upcoming_duration_seconds: 180,
          })
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('opens on Jukebox and preserves the modern Library and playback screens', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Jukebox' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jukebox' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()
    const navigation = screen.getByRole('navigation', {
      name: 'Primary navigation',
    })
    expect(navigation).toBeInTheDocument()
    expect(within(navigation).getAllByRole('button')).toHaveLength(7)
    expect(document.querySelector('.main-content')).toHaveAttribute(
      'data-scroll-region',
      'vertical',
    )

    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Night Drive' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Northern Lights')).toBeInTheDocument()
    expect(screen.getByText('Guest Vocalist')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    await user.click(screen.getByRole('button', { name: 'Play Now' }))
    expect(screen.getAllByText('Northern Lights')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Jukebox' }))
    expect(
      within(screen.getByRole('region', { name: 'Mini player' })).getByText(
        'Northern Lights',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Now Playing' }))
    expect(
      screen.getByRole('heading', { name: 'Northern Lights' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Play Album' }))
    expect(
      screen.getByRole('alertdialog', { name: 'Replace the current queue?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Replace and Play' }))
    await user.click(screen.getByRole('button', { name: 'Add Album to Queue' }))

    await user.click(screen.getByRole('button', { name: '‹ Back to Library' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Library' }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'CD' }))
    expect(screen.getByRole('heading', { name: 'CD' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Insert an audio CD' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('Pi Jukebox 0.5.0')).toBeInTheDocument()
  })

  it('does not create Jukebox effects while navigating other screens', async () => {
    const audioContext = vi.fn()
    vi.stubGlobal('AudioContext', audioContext)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })

    for (const destination of [
      'Library',
      'Search',
      'Queue',
      'CD',
      'Now Playing',
      'Settings',
    ]) {
      await user.click(screen.getByRole('button', { name: destination }))
    }

    expect(audioContext).not.toHaveBeenCalled()
  })

  it('shows a clear backend-unavailable state for network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: 'Jukebox unavailable',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/backend is running/i)).not.toHaveLength(0)
    expect(screen.getByText('Backend unavailable')).toBeInTheDocument()
  })

  it('handles an invalid catalogue response without rendering unsafe data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/queue')) return jsonResponse(emptyQueue)
        if (url.endsWith('/api/tracks')) return jsonResponse(albumDetail.tracks)
        if (url.endsWith('/api/albums?limit=500'))
          return jsonResponse({ albums: 'invalid' })
        if (url.endsWith('/api/library/scan/status'))
          return jsonResponse(scanStatus)
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: 'Jukebox unavailable',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/unexpected information/i)).toBeInTheDocument()
  })

  it('handles invalid CD status without breaking existing playback screens', async () => {
    const originalFetch = vi.mocked(fetch)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/cd/status'))
          return jsonResponse({ drive: 'invalid' })
        return originalFetch(input, init)
      }),
    )
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })
    await user.click(screen.getByRole('button', { name: 'CD' }))
    expect(
      await screen.findByRole('heading', { name: 'CD service unavailable' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/unexpected information/i)).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()
  })
})
