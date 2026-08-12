import { useEffect, useState } from 'react'
import { ApiError, getAlbum } from '../api/client'
import type { AlbumDetail } from '../api/types'
import { Artwork } from '../components/Artwork'
import { ScreenState } from '../components/ScreenState'
import { formatAlbumDuration, formatTrackDuration } from '../utils/format'

interface AlbumScreenProps {
  albumId: number
  onBack: () => void
}

export function AlbumScreen({ albumId, onBack }: AlbumScreenProps) {
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void getAlbum(albumId, controller.signal)
      .then(setAlbum)
      .catch((requestError) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        )
          return
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : 'This album could not be opened.',
        )
      })
    return () => controller.abort()
  }, [albumId])

  if (error) {
    return (
      <div className="screen">
        <button className="back-button" type="button" onClick={onBack}>
          ‹ Back to Library
        </button>
        <ScreenState title="Album unavailable" message={error} kind="error" />
      </div>
    )
  }

  if (!album) {
    return (
      <div className="screen">
        <button className="back-button" type="button" onClick={onBack}>
          ‹ Back to Library
        </button>
        <ScreenState
          title="Opening album"
          message="Loading its artwork and track list."
          kind="loading"
        />
      </div>
    )
  }

  const hasMultipleDiscs =
    new Set(album.tracks.map((track) => track.disc_number)).size > 1

  return (
    <div className="screen album-detail-screen">
      <button className="back-button" type="button" onClick={onBack}>
        ‹ Back to Library
      </button>
      <section className="album-hero" aria-labelledby="page-title">
        <Artwork
          artworkId={album.artwork_id}
          albumTitle={album.title}
          className="album-hero__artwork"
        />
        <div className="album-hero__copy">
          <p className="eyebrow">Album</p>
          <h1 id="page-title">{album.title}</h1>
          <p className="album-artist">{album.album_artist}</p>
          <p className="album-facts">
            {album.track_count} tracks ·{' '}
            {formatAlbumDuration(album.duration_seconds)}
          </p>
          <button className="disabled-action" type="button" disabled>
            Play Album · Coming later
          </button>
        </div>
      </section>
      <ol className="track-list" aria-label={`Tracks on ${album.title}`}>
        {album.tracks.map((track, index) => {
          const previousDisc = album.tracks[index - 1]?.disc_number
          const showDisc =
            hasMultipleDiscs && track.disc_number !== previousDisc
          return (
            <li key={track.id}>
              {showDisc ? <h2>Disc {track.disc_number ?? '—'}</h2> : null}
              <div className="track-row">
                <span
                  className="track-number"
                  aria-label={`Track ${track.track_number ?? 'unknown'}`}
                >
                  {track.track_number ?? '—'}
                </span>
                <span className="track-copy">
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <time>{formatTrackDuration(track.duration_seconds)}</time>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
