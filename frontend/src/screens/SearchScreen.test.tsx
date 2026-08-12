import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function searchResponse() {
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
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
    const fetchMock = vi.fn().mockImplementation(searchResponse)
    vi.stubGlobal('fetch', fetchMock)
    render(<SearchScreen onOpenAlbum={vi.fn()} onPlayTrack={vi.fn()} />)
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=n')
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

  it('keeps physical keyboard input and track/album actions working', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(searchResponse)
    vi.stubGlobal('fetch', fetchMock)
    const onOpenAlbum = vi.fn()
    const onPlayTrack = vi.fn()
    render(<SearchScreen onOpenAlbum={onOpenAlbum} onPlayTrack={onPlayTrack} />)

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'physical keyboard' },
    })
    expect(screen.getByRole('searchbox')).toHaveValue('physical keyboard')
    await finishDebounce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=physical+keyboard')

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Play Northern Lights by Guest Vocalist',
      }),
    )
    expect(onPlayTrack).toHaveBeenCalledWith(results.tracks[0])
    fireEvent.click(
      screen.getByRole('button', { name: /open album night drive for track/i }),
    )
    expect(onOpenAlbum).toHaveBeenCalledWith(7)
  })
})
