import { Fragment, useEffect, useState } from 'react'
import { ApiError, getAlbum } from '../api/client'
import type { AlbumDetail } from '../api/types'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { Artwork } from '../components/Artwork'
import { ConfirmationPanel } from '../components/ConfirmationPanel'
import { ScreenState } from '../components/ScreenState'
import { TrackActions } from '../components/TrackActions'
import { useQueue } from '../queue/QueueContext'
import { formatAlbumDuration, formatTrackDuration } from '../utils/format'
import { groupAlbumTracks } from './albumTrackGroups'

interface AlbumScreenProps {
  albumId: number
  onBack: () => void
}

export function AlbumScreen({ albumId, onBack }: AlbumScreenProps) {
  const player = useAudioPlayer()
  const queue = useQueue()
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)

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

  const trackGroups = groupAlbumTracks(album.tracks)
  const queueIsNonEmpty = Boolean(
    queue.snapshot?.current || queue.snapshot?.upcoming.length,
  )

  const playAlbum = () => {
    if (queueIsNonEmpty) {
      setConfirmReplace(true)
      return
    }
    void player.playAlbum(album.id)
  }

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
          <div className="album-actions">
            <button
              className="primary-button album-play-button"
              type="button"
              onClick={playAlbum}
              disabled={!album.tracks.length || queue.mutating !== null}
            >
              Play Album
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void queue.addAlbum(album.id)}
              disabled={!album.tracks.length || queue.mutating !== null}
            >
              Add Album to Queue
            </button>
          </div>
        </div>
      </section>
      {confirmReplace ? (
        <ConfirmationPanel
          title="Replace the current queue?"
          message={`Play Album will replace the current item and all upcoming tracks with ${album.title}.`}
          confirmLabel="Replace and Play"
          disabled={queue.mutating !== null}
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => {
            setConfirmReplace(false)
            void player.playAlbum(album.id)
          }}
        />
      ) : null}
      <ol className="track-list" aria-label={`Tracks on ${album.title}`}>
        {trackGroups.map((group) => (
          <Fragment key={group.key}>
            {group.label ? (
              <li className="track-disc-heading">
                <h2>{group.label}</h2>
              </li>
            ) : null}
            {group.tracks.map((track) => (
              <li key={track.id}>
                <div
                  className={`track-row${player.currentTrack?.id === track.id ? ' is-current' : ''}`}
                >
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
                  <span className="track-play-state" aria-hidden="true">
                    {player.currentTrack?.id === track.id &&
                    player.status === 'playing'
                      ? 'Ⅱ'
                      : ''}
                  </span>
                  <TrackActions track={track} />
                </div>
              </li>
            ))}
          </Fragment>
        ))}
      </ol>
    </div>
  )
}
