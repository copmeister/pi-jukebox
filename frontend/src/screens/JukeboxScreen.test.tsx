import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueSnapshot, Track } from '../api/types'
import { AudioPlayerProvider } from '../audio/AudioPlayerContext'
import { DEFAULT_JUKEBOX_SOUND_SETTINGS } from '../jukebox/soundSettings'
import type { JukeboxSoundController } from '../jukebox/sounds'
import { QueueProvider } from '../queue/QueueContext'
import { JukeboxScreen } from './JukeboxScreen'

function makeTracks(count = 17): Track[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    album_id: index < 9 ? 1 : 2,
    relative_path: `music/track-${index + 1}.mp3`,
    filename: `track-${index + 1}.mp3`,
    title: `Selector Song ${index + 1}`,
    artist: `Selector Artist ${index + 1}`,
    album_artist: 'Selector Band',
    album: index < 9 ? 'First Album' : 'Second Album',
    disc_number: 1,
    track_number: index + 1,
    duration_seconds: 180,
    file_format: 'mp3',
    playback_support: 'required',
    artwork_id: null,
  }))
}

const emptyQueue: QueueSnapshot = {
  revision: 0,
  current: null,
  upcoming: [],
  upcoming_count: 0,
  upcoming_duration_seconds: 0,
  warning: null,
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function queueItem(track: Track, id: number, position: number) {
  return {
    id,
    track_id: track.id,
    album_id: track.album_id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration_seconds: track.duration_seconds,
    artwork_id: null,
    position,
    status: position === 0 ? ('current' as const) : ('upcoming' as const),
    available: true,
  }
}

function createSoundController(): JukeboxSoundController {
  return {
    settings: { ...DEFAULT_JUKEBOX_SOUND_SETTINGS },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    playButton: vi.fn(),
    playMovement: vi.fn(),
    playConfirmation: vi.fn(),
    playLoading: vi.fn(() => vi.fn()),
    preview: vi.fn(),
  }
}

function renderJukebox(
  options: {
    sounds?: JukeboxSoundController
    transitionDurationMs?: number
    jukeboxLoadingDelayMs?: number
    selectionResetMs?: number
  } = {},
) {
  const sounds = options.sounds ?? createSoundController()
  return {
    sounds,
    ...render(
      <QueueProvider>
        <AudioPlayerProvider
          soundController={sounds}
          jukeboxLoadingDelayMs={options.jukeboxLoadingDelayMs ?? 20}
        >
          <JukeboxScreen
            scanStatus={null}
            onOpenLibrary={vi.fn()}
            random={() => 0.42}
            transitionDurationMs={options.transitionDurationMs ?? 20}
            selectionResetMs={options.selectionResetMs ?? 100}
            soundController={sounds}
          />
        </AudioPlayerProvider>
      </QueueProvider>,
    ),
  }
}

function settledPanelOrder(): string[] {
  return screen
    .getAllByRole('region', { name: /^Panel [A-D]$/ })
    .map((panel) => panel.getAttribute('data-panel-letter') ?? '')
}

function panelTitles(letter: string): string[] {
  return [
    ...screen
      .getByRole('region', { name: `Panel ${letter}` })
      .querySelectorAll('.jukebox-song-copy strong'),
  ].map((item) => item.textContent ?? '')
}

describe('classic Jukebox screen', () => {
  const tracks = makeTracks()
  let confirmedQueue: QueueSnapshot
  let nextQueueItemId: number
  let failSelection: boolean

  beforeEach(() => {
    confirmedQueue = { ...emptyQueue }
    nextQueueItemId = 100
    failSelection = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/tracks')) return jsonResponse(tracks)
        if (url.endsWith('/api/queue') && method === 'GET')
          return jsonResponse(confirmedQueue)
        if (url.match(/\/api\/queue\/tracks\/\d+\/play-now$/)) {
          if (failSelection) return jsonResponse({}, 404)
          const trackId = Number(url.match(/tracks\/(\d+)/)?.[1])
          const track = tracks.find((candidate) => candidate.id === trackId)!
          confirmedQueue = {
            ...confirmedQueue,
            revision: confirmedQueue.revision + 1,
            current: queueItem(track, nextQueueItemId++, 0),
          }
          return jsonResponse(confirmedQueue)
        }
        if (url.match(/\/api\/queue\/tracks\/\d+$/) && method === 'POST') {
          const trackId = Number(url.match(/tracks\/(\d+)/)?.[1])
          const track = tracks.find((candidate) => candidate.id === trackId)!
          const upcoming = [
            ...confirmedQueue.upcoming,
            queueItem(
              track,
              nextQueueItemId++,
              confirmedQueue.upcoming.length + 1,
            ),
          ]
          confirmedQueue = {
            ...confirmedQueue,
            revision: confirmedQueue.revision + 1,
            upcoming,
            upcoming_count: upcoming.length,
            upcoming_duration_seconds: upcoming.length * 180,
          }
          return jsonResponse(confirmedQueue)
        }
        if (url.endsWith('/api/queue') && method === 'DELETE') {
          confirmedQueue = {
            ...emptyQueue,
            revision: confirmedQueue.revision + 1,
          }
          return jsonResponse(confirmedQueue)
        }
        throw new Error(`Unexpected request: ${method} ${url}`)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders four persistent colour-coded panels with eight unique songs each', async () => {
    renderJukebox()

    expect(
      await screen.findByRole('heading', { name: 'Jukebox' }),
    ).toBeInTheDocument()
    expect(settledPanelOrder()).toEqual(['A', 'B', 'C', 'D'])
    for (const letter of ['A', 'B', 'C', 'D']) {
      const panel = screen.getByRole('region', { name: `Panel ${letter}` })
      const codes = [...panel.querySelectorAll('[data-code]')].map((item) =>
        item.getAttribute('data-code'),
      )
      const titles = [
        ...panel.querySelectorAll('.jukebox-song-copy strong'),
      ].map((item) => item.textContent)
      expect(codes).toEqual(
        Array.from({ length: 8 }, (_, index) => `${letter}${index + 1}`),
      )
      expect(new Set(titles).size).toBe(8)
      expect(panel).toHaveClass(`jukebox-accent--${letter.toLowerCase()}`)
      expect(
        screen.getByRole('button', { name: `Select panel ${letter}` }),
      ).toHaveClass(`jukebox-accent--${letter.toLowerCase()}`)
    }
  })

  it('rotates owned identities forward and gives each recycled panel new tracks', async () => {
    const user = userEvent.setup()
    renderJukebox()
    const initialA = await screen.findByRole('region', { name: 'Panel A' })
    const initialAId = initialA.getAttribute('data-panel-id')
    const initialATitles = panelTitles('A')
    const next = screen.getByRole('button', { name: /NEXT/ })

    for (const expectedOrder of [
      ['B', 'C', 'D', 'A'],
      ['C', 'D', 'A', 'B'],
      ['D', 'A', 'B', 'C'],
      ['A', 'B', 'C', 'D'],
    ]) {
      await user.click(next)
      await waitFor(() => expect(settledPanelOrder()).toEqual(expectedOrder))
      await waitFor(() => expect(next).toBeEnabled())
      for (const letter of ['A', 'B', 'C', 'D']) {
        expect(
          screen.getByRole('region', { name: `Panel ${letter}` }),
        ).toHaveClass(`jukebox-accent--${letter.toLowerCase()}`)
        expect(
          screen.getAllByRole('region', { name: `Panel ${letter}` }),
        ).toHaveLength(1)
      }
    }

    const recycledA = screen.getByRole('region', { name: 'Panel A' })
    expect(recycledA).not.toHaveAttribute('data-panel-id', initialAId)
    expect(new Set(panelTitles('A'))).not.toEqual(new Set(initialATitles))
  })

  it('prepares five panels, slides once, and resets without a reverse transition', async () => {
    const user = userEvent.setup()
    const { sounds } = renderJukebox({ transitionDurationMs: 200 })
    await screen.findByRole('region', { name: 'Panel A' })
    const track = screen
      .getByLabelText('Song selection panels')
      .querySelector('.jukebox-panel-track')!

    await user.click(screen.getByRole('button', { name: /NEXT/ }))
    expect(track).toHaveAttribute('data-transition-phase', 'preparing')
    expect(track.querySelectorAll('.jukebox-panel')).toHaveLength(5)
    expect(track.querySelector('.jukebox-panel:last-child')).toHaveClass(
      'is-incoming',
    )

    await waitFor(() =>
      expect(track).toHaveAttribute('data-transition-phase', 'sliding'),
    )
    expect(track).toHaveClass('is-sliding')
    expect(sounds.playMovement).toHaveBeenCalledTimes(1)

    fireEvent.transitionEnd(track, { propertyName: 'opacity' })
    expect(track).toHaveAttribute('data-transition-phase', 'sliding')
    fireEvent.transitionEnd(track.firstElementChild!, {
      propertyName: 'transform',
    })
    expect(track).toHaveAttribute('data-transition-phase', 'sliding')

    fireEvent.transitionEnd(track, { propertyName: 'transform' })
    expect(track).toHaveAttribute('data-transition-phase', 'resetting')
    expect(track).toHaveClass('is-resetting')
    expect(track.querySelectorAll('.jukebox-panel')).toHaveLength(4)
    expect(settledPanelOrder()).toEqual(['B', 'C', 'D', 'A'])

    await waitFor(() =>
      expect(track).toHaveAttribute('data-transition-phase', 'idle'),
    )
    expect(track).not.toHaveClass('is-sliding', 'is-resetting')
  })

  it('uses the timeout fallback and keeps repeated advances locked', async () => {
    const user = userEvent.setup()
    const { sounds } = renderJukebox()
    await screen.findByRole('region', { name: 'Panel A' })
    const track = screen
      .getByLabelText('Song selection panels')
      .querySelector('.jukebox-panel-track')!
    const next = screen.getByRole('button', { name: /NEXT/ })

    await user.dblClick(next)
    await waitFor(() =>
      expect(track).toHaveAttribute('data-transition-phase', 'idle'),
    )
    expect(settledPanelOrder()).toEqual(['B', 'C', 'D', 'A'])
    expect(sounds.playMovement).toHaveBeenCalledTimes(1)
  })

  it('replaces panels immediately and stays silent for reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const user = userEvent.setup()
    const { sounds } = renderJukebox({ transitionDurationMs: 200 })
    await screen.findByRole('region', { name: 'Panel A' })

    await user.click(screen.getByRole('button', { name: /NEXT/ }))

    const track = screen
      .getByLabelText('Song selection panels')
      .querySelector('.jukebox-panel-track')!
    expect(track).toHaveAttribute('data-transition-phase', 'idle')
    expect(settledPanelOrder()).toEqual(['B', 'C', 'D', 'A'])
    expect(sounds.playMovement).not.toHaveBeenCalled()
  })

  it('maps A1 and B8 by owned panel identity after their screen positions move', async () => {
    const user = userEvent.setup()
    renderJukebox()
    await screen.findByRole('region', { name: 'Panel A' })
    const next = screen.getByRole('button', { name: /NEXT/ })

    await user.click(next)
    await waitFor(() =>
      expect(settledPanelOrder()).toEqual(['B', 'C', 'D', 'A']),
    )
    const rightmostASelection = screen
      .getByRole('region', {
        name: 'Panel A',
      })
      .querySelector('[data-code="A1"]')!
    const aTrack = tracks.find(
      (track) =>
        track.title ===
        rightmostASelection.querySelector('strong')?.textContent,
    )!
    await user.click(screen.getByRole('button', { name: 'Select panel A' }))
    await user.click(
      screen.getByRole('button', { name: 'Select song number 1' }),
    )
    await waitFor(() =>
      expect(confirmedQueue.current?.track_id).toBe(aTrack.id),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select panel A' }),
      ).toHaveAttribute('aria-pressed', 'false'),
    )

    await user.click(next)
    await waitFor(() =>
      expect(settledPanelOrder()).toEqual(['C', 'D', 'A', 'B']),
    )
    const rightmostBSelection = screen
      .getByRole('region', {
        name: 'Panel B',
      })
      .querySelector('[data-code="B8"]')!
    const bTrack = tracks.find(
      (track) =>
        track.title ===
        rightmostBSelection.querySelector('strong')?.textContent,
    )!
    await user.click(screen.getByRole('button', { name: 'Select panel B' }))
    await user.click(
      screen.getByRole('button', { name: 'Select song number 8' }),
    )
    await waitFor(() =>
      expect(confirmedQueue.upcoming.at(-1)?.track_id).toBe(bTrack.id),
    )
  })

  it('requires letter then number, replaces letters, starts first, and appends deliberate duplicates', async () => {
    const user = userEvent.setup()
    const { container, sounds } = renderJukebox()
    await screen.findByRole('region', { name: 'Panel A' })

    await user.click(
      screen.getByRole('button', { name: 'Select song number 7' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Choose a letter first.',
    )

    const buttonA = screen.getByRole('button', { name: 'Select panel A' })
    const buttonB = screen.getByRole('button', { name: 'Select panel B' })
    await user.click(buttonA)
    expect(sounds.playButton).toHaveBeenCalledTimes(2)
    expect(buttonA).toHaveAttribute('aria-pressed', 'true')
    await user.click(buttonB)
    expect(buttonA).toHaveAttribute('aria-pressed', 'false')
    expect(buttonB).toHaveAttribute('aria-pressed', 'true')
    expect(buttonB).toHaveClass('jukebox-accent--b', 'is-selected')

    const selection = container.querySelector('[data-code="B7"]')!
    const selectedTitle = selection.querySelector('strong')!.textContent!
    const selectedTrack = tracks.find((track) => track.title === selectedTitle)!
    const numberSeven = screen.getByRole('button', {
      name: 'Select song number 7',
    })
    await user.dblClick(numberSeven)

    expect(await screen.findByText('B7 added')).toBeInTheDocument()
    expect(sounds.playConfirmation).toHaveBeenCalledTimes(1)
    expect(selection.closest('.jukebox-panel')).toHaveClass('jukebox-accent--b')
    expect(confirmedQueue.current?.track_id).toBe(selectedTrack.id)
    expect(confirmedQueue.upcoming).toHaveLength(0)

    await waitFor(() =>
      expect(buttonB).toHaveAttribute('aria-pressed', 'false'),
    )
    await user.click(buttonB)
    await user.click(numberSeven)
    await waitFor(() => expect(confirmedQueue.upcoming).toHaveLength(1))
    await waitFor(() =>
      expect(buttonB).toHaveAttribute('aria-pressed', 'false'),
    )
    await user.click(buttonB)
    await user.click(numberSeven)
    await waitFor(() => expect(confirmedQueue.upcoming).toHaveLength(2))

    expect(confirmedQueue.upcoming.map((item) => item.track_id)).toEqual([
      selectedTrack.id,
      selectedTrack.id,
    ])
    expect(confirmedQueue.upcoming[0].id).not.toBe(
      confirmedQueue.upcoming[1].id,
    )
    expect(sounds.playLoading).toHaveBeenCalledTimes(1)
    expect(sounds.playConfirmation).toHaveBeenCalledTimes(3)
  })

  it('highlights a confirmed selection before its visual reset', async () => {
    const user = userEvent.setup()
    const { container } = renderJukebox({ selectionResetMs: 10_000 })
    await screen.findByRole('region', { name: 'Panel B' })

    const selection = container.querySelector('[data-code="B7"]')!
    await user.click(screen.getByRole('button', { name: 'Select panel B' }))
    await user.click(
      screen.getByRole('button', { name: 'Select song number 7' }),
    )

    expect(await screen.findByText('B7 added')).toBeInTheDocument()
    expect(selection).toHaveClass('is-confirmed')
  })

  it('plays exactly two heavy clicks and one accepted latch for B1', async () => {
    const user = userEvent.setup()
    const { sounds } = renderJukebox({ jukeboxLoadingDelayMs: 500 })
    await screen.findByRole('region', { name: 'Panel B' })

    await user.click(screen.getByRole('button', { name: 'Select panel B' }))
    await user.click(
      screen.getByRole('button', { name: 'Select song number 1' }),
    )

    expect(await screen.findByText('Loading B1…')).toBeInTheDocument()
    expect(sounds.playButton).toHaveBeenCalledTimes(2)
    expect(sounds.playConfirmation).toHaveBeenCalledTimes(1)
    expect(sounds.playLoading).toHaveBeenCalledTimes(1)
  })

  it('advances once by NEXT or a left swipe, ignores right swipes, and resets incomplete input', async () => {
    const user = userEvent.setup()
    const { sounds } = renderJukebox()
    const firstPanel = await screen.findByRole('region', { name: 'Panel A' })
    const initialFirstId = firstPanel.getAttribute('data-panel-id')
    const viewport = screen.getByLabelText('Song selection panels')

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 190, clientY: 53 })
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 190, clientY: 53 })
    expect(screen.getByRole('region', { name: 'Panel A' })).toHaveAttribute(
      'data-panel-id',
      initialFirstId,
    )
    expect(sounds.playMovement).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Select panel A' }))
    await user.click(
      screen.getByRole('button', { name: 'Select song number 1' }),
    )
    await waitFor(() => expect(confirmedQueue.current).not.toBeNull())
    const selectedQueueItemId = confirmedQueue.current?.id
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select panel A' }),
      ).toHaveAttribute('aria-pressed', 'false'),
    )

    await user.click(screen.getByRole('button', { name: 'Select panel C' }))
    await user.dblClick(screen.getByRole('button', { name: /NEXT/ }))
    await waitFor(() =>
      expect(settledPanelOrder()).toEqual(['B', 'C', 'D', 'A']),
    )
    await waitFor(() =>
      expect(viewport.querySelector('.jukebox-panel-track')).toHaveAttribute(
        'data-transition-phase',
        'idle',
      ),
    )
    expect(sounds.playMovement).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Select panel C' }),
    ).toHaveAttribute('aria-pressed', 'false')

    const afterNextOrder = settledPanelOrder()
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 190, clientY: 50 })
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 90, clientY: 55 })
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 40, clientY: 58 })
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 40, clientY: 58 })
    await waitFor(() =>
      expect(settledPanelOrder()).toEqual(['C', 'D', 'A', 'B']),
    )
    expect(sounds.playMovement).toHaveBeenCalledTimes(2)
    expect(afterNextOrder).toEqual(['B', 'C', 'D', 'A'])
    expect(confirmedQueue.current?.id).toBe(selectedQueueItemId)

    const queueMutations = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).includes('/api/queue') && init?.method,
      )
    expect(queueMutations).toHaveLength(1)
  })

  it('shows no false confirmation after a queue API failure', async () => {
    const user = userEvent.setup()
    const { container, sounds } = renderJukebox()
    await screen.findByRole('region', { name: 'Panel A' })
    failSelection = true

    await user.click(screen.getByRole('button', { name: 'Select panel A' }))
    await user.click(
      screen.getByRole('button', { name: 'Select song number 1' }),
    )

    expect(
      await screen.findByText(
        'That selection could not be added. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(container.querySelector('.jukebox-panel li.is-confirmed')).toBeNull()
    expect(sounds.playButton).toHaveBeenCalledTimes(2)
    expect(sounds.playConfirmation).not.toHaveBeenCalled()
  })

  it('opens accessible sound settings, previews categories, resets, and restores focus', async () => {
    const user = userEvent.setup()
    const { sounds } = renderJukebox()
    await screen.findByRole('region', { name: 'Panel A' })
    const settingsButton = screen.getByRole('button', { name: 'Sounds' })

    await user.click(settingsButton)
    const dialog = screen.getByRole('dialog', { name: 'Jukebox Sounds' })
    expect(dialog).toBeInTheDocument()
    expect(
      within(dialog).getByText(/do not change music playback/i),
    ).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Sound effects enabled',
      }),
    )
    expect(sounds.updateSettings).toHaveBeenCalledWith({ enabled: false })

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Mechanical loading pause',
      }),
    )
    expect(sounds.updateSettings).toHaveBeenCalledWith({ loadingPause: false })

    fireEvent.change(
      within(dialog).getByRole('slider', { name: 'Master effects volume' }),
      { target: { value: '48' } },
    )
    expect(sounds.updateSettings).toHaveBeenCalledWith({ masterVolume: 0.48 })
    fireEvent.change(
      within(dialog).getByRole('slider', {
        name: 'Loading mechanism volume',
      }),
      { target: { value: '31' } },
    )
    expect(sounds.updateSettings).toHaveBeenCalledWith({ loadingVolume: 0.31 })

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Preview button click volume',
      }),
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Preview panel movement volume',
      }),
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Preview selection confirmation volume',
      }),
    )
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Preview loading mechanism volume',
      }),
    )
    expect(sounds.preview).toHaveBeenNthCalledWith(1, 'button')
    expect(sounds.preview).toHaveBeenNthCalledWith(2, 'movement')
    expect(sounds.preview).toHaveBeenNthCalledWith(3, 'confirmation')
    expect(sounds.preview).toHaveBeenNthCalledWith(4, 'loading')

    await user.click(
      within(dialog).getByRole('button', { name: 'Reset to defaults' }),
    )
    expect(sounds.resetSettings).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Jukebox Sounds' })).toBeNull()
    await waitFor(() => expect(settingsButton).toHaveFocus())

    await user.click(settingsButton)
    expect(
      screen.getByRole('dialog', { name: 'Jukebox Sounds' }),
    ).toBeInTheDocument()
  })

  it('cancels or confirms Stop & Clear and resets the single audio element', async () => {
    confirmedQueue = {
      ...emptyQueue,
      revision: 4,
      current: queueItem(tracks[0], 90, 0),
      upcoming: [queueItem(tracks[1], 91, 1)],
      upcoming_count: 1,
      upcoming_duration_seconds: 180,
    }
    const user = userEvent.setup()
    const { container } = renderJukebox()
    await screen.findByRole('region', { name: 'Panel A' })

    await user.click(screen.getByRole('button', { name: 'Stop & Clear' }))
    expect(
      screen.getByRole('alertdialog', {
        name: 'Stop playback and clear everything?',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirmedQueue.current).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Stop & Clear' }))
    const confirmation = screen.getByRole('alertdialog', {
      name: 'Stop playback and clear everything?',
    })
    await user.click(
      within(confirmation).getByRole('button', { name: 'Stop & Clear' }),
    )
    await waitFor(() => expect(confirmedQueue.current).toBeNull())
    expect(confirmedQueue.upcoming).toEqual([])
    expect(container.querySelectorAll('audio')).toHaveLength(1)
    expect(container.querySelector('audio')).not.toHaveAttribute('src')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Playback stopped and queue cleared.',
    )
  })
})
