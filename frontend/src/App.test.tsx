import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BluetoothStatus } from './api/types'
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
let currentAlbumDetail = albumDetail

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
  installed_version: '0.6.12',
  latest_version: '0.6.12',
  checking: false,
  installing: false,
  update_available: false,
  install_available: false,
  stage: 'idle',
  outcome: null,
  requested_version: null,
  previous_version: null,
  message: 'This jukebox is up to date.',
  last_error: null,
  source: 'Authenticated GitHub Releases via the local GitHub CLI',
}

const bluetoothStatus: BluetoothStatus = {
  available: false,
  mode_active: false,
  state: 'unavailable',
  adapter_alias: null,
  discoverable: false,
  pairable: false,
  pairing_seconds_remaining: 0,
  connected_device_id: null,
  devices: [],
  pending_pairing: null,
  message: 'Bluetooth receiver mode is not enabled on this installation.',
}

const availableBluetoothStatus: BluetoothStatus = {
  ...bluetoothStatus,
  available: true,
  state: 'inactive',
  adapter_alias: 'Pi Jukebox',
  message: 'Bluetooth mode is off. Local jukebox playback remains available.',
}

let currentBluetoothStatus: BluetoothStatus = bluetoothStatus
let albumDeleted = false

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this)
  }
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
    currentAlbumDetail = albumDetail
    currentBluetoothStatus = bluetoothStatus
    albumDeleted = false
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/albums?limit=500'))
          return jsonResponse(albumDeleted ? [] : albums)
        if (url.endsWith('/api/tracks'))
          return jsonResponse(albumDeleted ? [] : albumDetail.tracks)
        if (url.endsWith('/api/queue')) return jsonResponse(emptyQueue)
        if (url.endsWith('/api/library/scan/status'))
          return jsonResponse(scanStatus)
        if (url.endsWith('/api/cd/status')) return jsonResponse(cdStatus)
        if (url.endsWith('/api/system/updates'))
          return jsonResponse(updateStatus)
        if (url.endsWith('/api/system/display/sleep'))
          return jsonResponse({
            available: true,
            adjusted: false,
            message: 'Hardware dimming unavailable.',
          })
        if (url.endsWith('/api/system/display/wake'))
          return jsonResponse({
            available: true,
            adjusted: true,
            message: 'Brightness restored.',
          })
        if (url.endsWith('/api/bluetooth/status'))
          return jsonResponse(currentBluetoothStatus)
        if (url.endsWith('/api/bluetooth/activate')) {
          currentBluetoothStatus = {
            ...availableBluetoothStatus,
            mode_active: true,
            state: 'not_connected',
            message:
              'Bluetooth mode is ready. Connect a trusted phone or pair a new one.',
          }
          return jsonResponse(currentBluetoothStatus)
        }
        if (url.endsWith('/api/bluetooth/deactivate')) {
          currentBluetoothStatus = availableBluetoothStatus
          return jsonResponse(currentBluetoothStatus)
        }
        if (url.endsWith('/api/albums/7') && init?.method === 'DELETE') {
          albumDeleted = true
          return jsonResponse({
            album_id: 7,
            title: 'Night Drive',
            album_artist: 'The House Band',
            track_count: 2,
            files_removed: 2,
            missing_files: 0,
            directories_removed: 1,
            album_artwork_removed: 1,
            runtime_artwork_removed: true,
            cd_artwork_removed: 1,
            queue_items_removed: 1,
            current_queue_item_removed: true,
            rip_jobs_removed: 1,
            message:
              'Deleted "Night Drive" from the jukebox. The CD can now be ripped again as a fresh album.',
          })
        }
        if (url.endsWith('/api/albums/7'))
          return jsonResponse(currentAlbumDetail)
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
    expect(within(navigation).getAllByRole('button')).toHaveLength(9)
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
      screen.queryByRole('heading', { name: 'Disc 1' }),
    ).not.toBeInTheDocument()
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
    expect(await screen.findByText('Pi Jukebox 0.6.12')).toBeInTheDocument()
  })

  it('shows clean disc headings for a genuinely multi-disc album', async () => {
    const user = userEvent.setup()
    const makeTrack = (
      id: number,
      discNumber: number,
      trackNumber: number,
    ) => ({
      ...albumDetail.tracks[0],
      id,
      relative_path: `night/${discNumber}-${trackNumber}.mp3`,
      filename: `${discNumber}-${trackNumber}.mp3`,
      title: `Movement ${id}`,
      disc_number: discNumber,
      track_number: trackNumber,
    })
    currentAlbumDetail = {
      ...albumDetail,
      track_count: 4,
      tracks: [
        makeTrack(11, 1, 1),
        makeTrack(12, 1, 2),
        makeTrack(13, 2, 1),
        makeTrack(14, 2, 2),
      ],
    }

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )

    expect(screen.getByRole('heading', { name: 'Disc 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Disc 2' })).toBeInTheDocument()
    expect(screen.getByText('Movement 11')).toBeInTheDocument()
    expect(screen.queryByText(/Disc 1 Movement/)).not.toBeInTheDocument()
  })

  it('requires the guarded multi-step flow and stops matching playback before deletion', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    await user.click(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    await user.click(screen.getByRole('button', { name: 'Play Now' }))

    expect(
      screen.queryByRole('button', { name: 'Delete Album' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage Album' }))
    expect(
      screen.getByRole('button', { name: 'Delete Album' }),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith('/api/albums/7') && init?.method === 'DELETE',
      ),
    ).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete Album' }))
    const confirmation = screen.getByRole('alertdialog', {
      name: 'Delete “Night Drive”?',
    })
    expect(
      within(confirmation).getByText(/The House Band · 2 tracks/),
    ).toBeInTheDocument()
    expect(
      within(confirmation).getByText(/cannot be undone/i),
    ).toBeInTheDocument()
    expect(
      within(confirmation).getByText(/ripped again as a fresh album/i),
    ).toBeInTheDocument()

    await user.click(
      within(confirmation).getByRole('button', {
        name: 'Delete from Jukebox',
      }),
    )
    await screen.findByRole('heading', { name: 'Library' })
    expect(
      screen.queryByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    const deletionRequest = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/api/albums/7') && init?.method === 'DELETE',
    )
    expect(deletionRequest?.[1]?.headers).toEqual({
      'X-Pi-Jukebox-Action': 'delete-album',
    })
  })

  it('shows local metadata and keeps unavailable status nonvisual in Spectrum', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    await user.click(screen.getByRole('button', { name: 'Play Now' }))
    await user.click(screen.getByRole('button', { name: 'Now Playing' }))

    expect(
      screen.getByRole('heading', { name: 'Northern Lights' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Guest Vocalist')).not.toHaveLength(0)
    expect(screen.getAllByText('Night Drive')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Open Spectrum' }))

    expect(
      screen.getByRole('heading', { name: 'Northern Lights' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Guest Vocalist · Night Drive/)).toBeInTheDocument()
    const source = FakeEventSource.instances.at(-1)
    expect(source?.url).toMatch(/\/api\/visualiser\/stream$/)
    act(() => {
      source?.onmessage?.({
        data: JSON.stringify({
          sequence: 2,
          status: 'unavailable',
          message: 'The monitor is unavailable. Playback is unaffected.',
          band_centres_hz: [60, 120, 240, 480],
          levels: [0, 0, 0, 0],
          max_levels: 16,
          rise_rate: 48,
          fall_rate: 36,
        }),
      } as MessageEvent<string>)
    })
    expect(document.querySelector('.spectrum-header')).not.toBeInTheDocument()
    expect(
      document.querySelector('.spectrum-unavailable'),
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('.spectrum-screen [role="status"]'),
    ).toHaveClass('visually-hidden')

    const stage = document.querySelector('.spectrum-stage')
    expect(stage).not.toBeNull()
    const swipe = (horizontal: number, vertical: number, pointerId: number) => {
      fireEvent.pointerDown(stage as Element, {
        pointerId,
        clientX: 500,
        clientY: 400,
      })
      fireEvent.pointerUp(stage as Element, {
        pointerId,
        clientX: 500 + horizontal,
        clientY: 400 + vertical,
      })
    }

    expect(
      screen.getByRole('img', {
        name: 'Real-time audio spectrum, smooth colours',
      }),
    ).toBeInTheDocument()
    swipe(-100, 4, 1)
    expect(
      screen.getByRole('img', { name: 'Golden Ratio audio visualiser' }),
    ).toBeInTheDocument()
    swipe(30, 2, 2)
    swipe(5, -100, 3)
    expect(
      screen.getByRole('img', { name: 'Golden Ratio audio visualiser' }),
    ).toBeInTheDocument()
    swipe(-100, 3, 4)
    expect(
      screen.getByRole('img', { name: 'Particle Galaxy audio visualiser' }),
    ).toBeInTheDocument()
    swipe(-100, 3, 5)
    expect(
      screen.getByRole('img', { name: 'Water audio visualiser' }),
    ).toBeInTheDocument()
    swipe(-100, 3, 6)
    expect(
      screen.getByRole('img', { name: 'Frequency Waves audio visualiser' }),
    ).toBeInTheDocument()
    expect(FakeEventSource.instances.at(-1)?.url).toMatch(
      /\/api\/visualiser\/stream$/,
    )
    swipe(-100, 3, 7)
    expect(
      screen.getByRole('img', {
        name: 'Real-time audio spectrum, smooth colours',
      }),
    ).toBeInTheDocument()
    expect(FakeEventSource.instances.at(-1)?.url).toMatch(
      /\/api\/visualiser\/stream$/,
    )
    swipe(4, -100, 8)
    expect(
      screen.getByRole('img', {
        name: 'Real-time audio spectrum, classic colours',
      }),
    ).toBeInTheDocument()

    const exitButton = screen.getByRole('button', { name: 'Exit Spectrum' })
    fireEvent.pointerDown(exitButton, {
      pointerId: 9,
      clientX: 900,
      clientY: 40,
    })
    fireEvent.pointerUp(exitButton, {
      pointerId: 9,
      clientX: 700,
      clientY: 42,
    })
    expect(
      screen.getByRole('img', {
        name: 'Real-time audio spectrum, classic colours',
      }),
    ).toBeInTheDocument()

    await user.click(exitButton)
    expect(source?.close).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: 'Open Spectrum' }),
    ).toBeInTheDocument()
  })

  it('uses honest Bluetooth source metadata fallback in Spectrum', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    currentBluetoothStatus = {
      ...availableBluetoothStatus,
      mode_active: true,
      state: 'audio_playing',
      connected_device_id: 'a'.repeat(16),
      devices: [
        {
          id: 'a'.repeat(16),
          name: 'Test Phone',
          paired: true,
          trusted: true,
          connected: true,
          audio_playing: true,
        },
      ],
      message: 'Playing audio from Test Phone.',
    }
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })
    await user.click(screen.getByRole('button', { name: 'Now Playing' }))
    expect(
      await screen.findByRole('heading', { name: 'Test Phone' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Spectrum' }))

    expect(
      screen.getByRole('heading', { name: 'Bluetooth audio' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Test Phone · Playing audio from Test Phone/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Unknown Artist')).not.toBeInTheDocument()
  })

  it('plays, switches, stops, and visualises radio without queue mutations', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })

    await user.click(screen.getByRole('button', { name: 'Radio' }))
    expect(screen.getByRole('heading', { name: 'Radio' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Play Classic FM' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Play Classic FM' }))
    expect(
      screen.getByRole('heading', { name: 'Classic FM' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Live Radio')).not.toHaveLength(0)
    expect(document.querySelectorAll('audio')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Play Smooth Radio' }))
    expect(
      screen.getByRole('heading', { name: 'Smooth Radio' }),
    ).toBeInTheDocument()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([input, init]) =>
            String(input).includes('/api/queue') && Boolean(init?.method),
        ),
    ).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Open Spectrum' }))
    expect(
      screen.getByRole('heading', { name: 'Smooth Radio' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Live Radio')).toBeInTheDocument()
    expect(FakeEventSource.instances.at(-1)?.url).toMatch(
      /\/api\/visualiser\/stream$/,
    )

    await user.click(screen.getByRole('button', { name: 'Exit Spectrum' }))
    await user.click(
      within(
        screen.getByRole('region', { name: 'Live radio controls' }),
      ).getByRole('button', { name: 'Stop' }),
    )
    expect(
      screen.queryByRole('region', { name: 'Live radio controls' }),
    ).not.toBeInTheDocument()
  })

  it('deactivates Bluetooth before starting radio', async () => {
    currentBluetoothStatus = {
      ...availableBluetoothStatus,
      mode_active: true,
      state: 'not_connected',
    }
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })
    await user.click(screen.getByRole('button', { name: 'Radio' }))
    await user.click(screen.getByRole('button', { name: 'Play LBC' }))

    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) =>
          String(input).endsWith('/api/bluetooth/deactivate'),
        ),
    ).toBe(true)
    expect(screen.getByRole('heading', { name: 'LBC' })).toBeInTheDocument()
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
      'Radio',
      'CD',
      'Bluetooth',
      'Now Playing',
      'Settings',
    ]) {
      await user.click(screen.getByRole('button', { name: destination }))
    }

    expect(audioContext).not.toHaveBeenCalled()
  })

  it('sleeps over the current screen and wakes without disturbing player context', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })
    await user.click(screen.getByRole('button', { name: 'Library' }))
    const miniPlayer = screen.getByRole('region', { name: 'Mini player' })

    await user.click(screen.getByRole('button', { name: 'Sleep' }))
    const sleepScreen = screen.getByRole('button', { name: 'Wake Pi Jukebox' })
    expect(sleepScreen).toHaveTextContent('Tap anywhere to wake')
    expect(miniPlayer).toBeInTheDocument()
    expect(document.querySelector('.app-shell')).toHaveClass('is-sleeping')

    await user.click(sleepScreen)
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Mini player' })).toBe(miniPlayer)
  })

  it('shows the playing local track and never pauses it during Sleep', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    await user.click(screen.getByRole('button', { name: 'Play Now' }))
    const audio = document.querySelector('audio')
    expect(audio?.paused).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Sleep' }))
    const sleepScreen = screen.getByRole('button', { name: 'Wake Pi Jukebox' })
    expect(within(sleepScreen).getByText('Northern Lights')).toBeInTheDocument()
    expect(within(sleepScreen).getByText('Guest Vocalist')).toBeInTheDocument()
    expect(audio?.paused).toBe(false)
  })

  it('keeps active Bluetooth connected and shows no invented metadata', async () => {
    currentBluetoothStatus = {
      ...availableBluetoothStatus,
      mode_active: true,
      state: 'audio_playing',
      connected_device_id: 'a'.repeat(16),
      devices: [
        {
          id: 'a'.repeat(16),
          name: 'Test Phone',
          paired: true,
          trusted: true,
          connected: true,
          audio_playing: true,
        },
      ],
      message: 'Playing audio from Test Phone.',
    }
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })

    await user.click(screen.getByRole('button', { name: 'Sleep' }))
    const sleepScreen = screen.getByRole('button', { name: 'Wake Pi Jukebox' })
    expect(within(sleepScreen).getByText('Bluetooth audio')).toBeInTheDocument()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) =>
          String(input).endsWith('/api/bluetooth/deactivate'),
        ),
    ).toBe(false)
  })

  it('pauses local playback for Bluetooth and keeps the local queue item paused', async () => {
    currentBluetoothStatus = availableBluetoothStatus
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Jukebox' })

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await user.click(
      screen.getByRole('button', {
        name: 'Open Night Drive by The House Band',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Queue actions for Northern Lights' }),
    )
    await user.click(screen.getByRole('button', { name: 'Play Now' }))
    expect(screen.getAllByText('Northern Lights')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Bluetooth' }))
    await user.click(screen.getByRole('button', { name: 'Use Bluetooth' }))
    expect(await screen.findAllByText(/Bluetooth mode is ready/)).toHaveLength(
      2,
    )
    expect(
      within(screen.getByRole('region', { name: 'Mini player' })).getByText(
        'Waiting for a phone',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Return to Jukebox' }))
    expect(
      within(screen.getByRole('region', { name: 'Mini player' })).getByText(
        'Northern Lights',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Mini player' })).getByText(
        'paused',
      ),
    ).toBeInTheDocument()
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
