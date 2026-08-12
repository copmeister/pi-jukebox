import { act, fireEvent, render, screen } from '@testing-library/react'
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

describe('SearchScreen', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('debounces search and opens the relevant album from a track result', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onOpenAlbum = vi.fn()
    render(<SearchScreen onOpenAlbum={onOpenAlbum} />)

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'north' },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(349)
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=north')

    expect(screen.getByText('Northern Lights')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /open album night drive for track/i }),
    )
    expect(onOpenAlbum).toHaveBeenCalledWith(7)
  })
})
