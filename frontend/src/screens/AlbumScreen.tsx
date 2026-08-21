import { Fragment, useEffect, useState } from 'react'
import { ApiError, deleteAlbum, getAlbum } from '../api/client'
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
  onDeleted: () => void
}

export function AlbumScreen({ albumId, onBack, onDeleted }: AlbumScreenProps) {
  const player = useAudioPlayer()
  const queue = useQueue()
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
      setManageOpen(false)
      setConfirmDelete(false)
      setConfirmReplace(true)
      return
    }
    void player.playAlbum(album.id)
  }

  const deleteSelectedAlbum = async () => {
    setDeleting(true)
    setDeleteError(null)
    player.prepareAlbumDeletion(album.id)
    try {
      const result = await deleteAlbum(album.id)
      await queue.refresh()
      queue.notify(result.message)
      onDeleted()
    } catch (requestError) {
      setDeleteError(
        requestError instanceof ApiError
          ? requestError.message
          : 'The album could not be deleted safely.',
      )
    } finally {
      setDeleting(false)
    }
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
            <button
              className="secondary-button album-manage-button"
              type="button"
              onClick={() => {
                setConfirmReplace(false)
                setConfirmDelete(false)
                setDeleteError(null)
                setManageOpen((current) => !current)
              }}
              disabled={deleting}
            >
              Manage Album
            </button>
          </div>
        </div>
      </section>
      {manageOpen && !confirmDelete ? (
        <section
          className="album-manage-panel"
          aria-labelledby="manage-album-title"
        >
          <div>
            <h2 id="manage-album-title">Manage Album</h2>
            <p>Secondary actions for this album.</p>
          </div>
          <button
            type="button"
            className="secondary-button danger-button"
            onClick={() => setConfirmDelete(true)}
          >
            Delete Album
          </button>
        </section>
      ) : null}
      {confirmDelete ? (
        <ConfirmationPanel
          title={`Delete “${album.title}”?`}
          message={`${album.album_artist} · ${album.track_count} track${album.track_count === 1 ? '' : 's'}. This permanently removes the music files and album artwork from the jukebox. It cannot be undone here. The CD can subsequently be ripped again as a fresh album.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete from Jukebox'}
          disabled={deleting}
          onCancel={() => {
            setConfirmDelete(false)
            setDeleteError(null)
          }}
          onConfirm={() => void deleteSelectedAlbum()}
        />
      ) : null}
      {deleteError ? (
        <p className="album-delete-error" role="alert">
          {deleteError}
        </p>
      ) : null}
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
