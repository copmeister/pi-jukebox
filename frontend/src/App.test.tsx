import { render, screen, waitFor } from '@testing-library/react'
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('App catalogue interface', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/albums?limit=500')) return jsonResponse(albums)
        if (url.endsWith('/api/library/scan/status'))
          return jsonResponse(scanStatus)
        if (url.endsWith('/api/albums/7')) return jsonResponse(albumDetail)
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows catalogue totals and opens an album from the Library screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      await screen.findByText('1 album and 2 tracks ready to browse.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Browse Library' }))
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
      screen.getByRole('button', {
        name: 'Play Northern Lights by Guest Vocalist',
      }),
    )
    expect(screen.getAllByText('Northern Lights')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByText('Northern Lights')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: '‹ Back to Library' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Library' }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()
  })

  it('shows a clear backend-unavailable state for network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: 'The library is out of reach',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/backend is running/i)).toBeInTheDocument()
    expect(screen.getByText('Backend unavailable')).toBeInTheDocument()
  })

  it('handles an invalid catalogue response without rendering unsafe data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
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
        name: 'The library is out of reach',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/unexpected information/i)).toBeInTheDocument()
  })
})
