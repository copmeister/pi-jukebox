import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem, QueueSnapshot } from '../api/types'
import { QueueProvider } from '../queue/QueueContext'
import { QueueScreen } from './QueueScreen'

function queued(id: number, title: string, position: number): QueueItem {
  return {
    id,
    track_id: id + 100,
    album_id: 7,
    title,
    artist: 'Queue Artist',
    album: 'Queue Album',
    duration_seconds: 120,
    artwork_id: null,
    position,
    status: position === 0 ? 'current' : 'upcoming',
    available: true,
  }
}

function makeSnapshot(
  upcoming = [queued(2, 'Duplicate Song', 1), queued(3, 'Duplicate Song', 2)],
): QueueSnapshot {
  return {
    revision: 1,
    current: queued(1, 'Current Song', 0),
    upcoming,
    upcoming_count: upcoming.length,
    upcoming_duration_seconds: upcoming.length * 120,
    warning: null,
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function queueApi(failRemove = false) {
  let state = makeSnapshot()
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (
        url.endsWith('/api/queue') &&
        (!init?.method || init.method === 'GET')
      )
        return jsonResponse(state)
      const move = url.match(/\/api\/queue\/items\/(\d+)\/move$/)
      if (move) {
        const itemId = Number(move[1])
        const direction = (
          JSON.parse(String(init?.body)) as { direction: 'up' | 'down' }
        ).direction
        const reordered = [...state.upcoming]
        const index = reordered.findIndex((item) => item.id === itemId)
        const target = direction === 'up' ? index - 1 : index + 1
        ;[reordered[index], reordered[target]] = [
          reordered[target],
          reordered[index],
        ]
        state = makeSnapshot(
          reordered.map((item, itemIndex) => ({
            ...item,
            position: itemIndex + 1,
          })),
        )
        return jsonResponse(state)
      }
      const remove = url.match(/\/api\/queue\/items\/(\d+)$/)
      if (remove && init?.method === 'DELETE') {
        if (failRemove) return jsonResponse({ detail: 'failed' }, 500)
        state = makeSnapshot(
          state.upcoming
            .filter((item) => item.id !== Number(remove[1]))
            .map((item, index) => ({ ...item, position: index + 1 })),
        )
        return jsonResponse(state)
      }
      if (url.endsWith('/api/queue/upcoming') && init?.method === 'DELETE') {
        state = makeSnapshot([])
        return jsonResponse(state)
      }
      throw new Error(`Unexpected request: ${url}`)
    },
  )
  return { fetchMock, getState: () => state }
}

function renderQueue() {
  render(
    <QueueProvider>
      <QueueScreen onBrowse={vi.fn()} />
    </QueueProvider>,
  )
}

describe('QueueScreen', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders duplicate entries and supports up/down reordering and removal', async () => {
    const api = queueApi()
    vi.stubGlobal('fetch', api.fetchMock)
    const user = userEvent.setup()
    renderQueue()

    expect(await screen.findByText('Current Song')).toBeInTheDocument()
    expect(screen.getAllByText('Duplicate Song')).toHaveLength(2)
    expect(screen.getByText('2 upcoming')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Move Duplicate Song up' })[0],
    ).toBeDisabled()

    await user.click(
      screen.getAllByRole('button', { name: 'Move Duplicate Song down' })[0],
    )
    expect(api.getState().upcoming.map((item) => item.id)).toEqual([3, 2])
    await user.click(
      screen.getAllByRole('button', {
        name: 'Remove Duplicate Song from queue',
      })[0],
    )
    expect(await screen.findByText('1 upcoming')).toBeInTheDocument()
    expect(api.getState().upcoming).toHaveLength(1)
  })

  it('requires confirmation before clearing and preserves the current item', async () => {
    const api = queueApi()
    vi.stubGlobal('fetch', api.fetchMock)
    const user = userEvent.setup()
    renderQueue()
    await screen.findByText('Current Song')

    await user.click(screen.getByRole('button', { name: 'Clear Queue' }))
    expect(
      screen.getByRole('alertdialog', { name: 'Clear upcoming tracks?' }),
    ).toBeInTheDocument()
    expect(api.getState().upcoming).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Clear Upcoming' }))
    expect(
      await screen.findByText(
        'Nothing upcoming. The current track will finish normally.',
      ),
    )
    expect(screen.getByText('Current Song')).toBeInTheDocument()
    expect(api.getState().current?.title).toBe('Current Song')
  })

  it('keeps confirmed state after an API failure and blocks repeated taps', async () => {
    const api = queueApi(true)
    vi.stubGlobal('fetch', api.fetchMock)
    renderQueue()
    await screen.findByText('Current Song')
    const remove = screen.getAllByRole('button', {
      name: 'Remove Duplicate Song from queue',
    })[0]

    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(
      api.fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/api/queue/items/') &&
          init?.method === 'DELETE',
      ),
    ).toHaveLength(1)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'queue action could not be completed',
    )
    await waitFor(() =>
      expect(screen.getAllByText('Duplicate Song')).toHaveLength(2),
    )
  })
})
