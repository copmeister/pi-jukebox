import { useState } from 'react'
import { Artwork } from '../components/Artwork'
import { ConfirmationPanel } from '../components/ConfirmationPanel'
import { ScreenState } from '../components/ScreenState'
import { useQueue } from '../queue/QueueContext'
import { formatAlbumDuration, formatTrackDuration } from '../utils/format'

interface QueueScreenProps {
  onBrowse: () => void
}

export function QueueScreen({ onBrowse }: QueueScreenProps) {
  const queue = useQueue()
  const [confirmClear, setConfirmClear] = useState(false)
  const snapshot = queue.snapshot
  const busy = queue.mutating !== null

  if (queue.loading && !snapshot) {
    return (
      <div className="screen queue-screen">
        <ScreenState
          title="Loading queue"
          message="Restoring the saved jukebox order."
          kind="loading"
        />
      </div>
    )
  }

  if (queue.error && !snapshot) {
    return (
      <div className="screen queue-screen">
        <ScreenState
          title="Queue unavailable"
          message={queue.error}
          kind="error"
          actionLabel="Try again"
          onAction={() => void queue.refresh()}
        />
      </div>
    )
  }

  if (!snapshot?.current && !snapshot?.upcoming.length) {
    return (
      <div className="screen queue-screen">
        <header className="screen-header">
          <div>
            <p className="eyebrow">Your listening order</p>
            <h1 id="page-title">Queue</h1>
          </div>
        </header>
        <ScreenState
          title="Nothing is queued"
          message="Browse your library and choose Play Now, Play Next, or Add to Queue."
          actionLabel="Browse Library"
          onAction={onBrowse}
        />
      </div>
    )
  }

  return (
    <div className="screen queue-screen">
      <header className="screen-header queue-heading">
        <div>
          <p className="eyebrow">Your listening order</p>
          <h1 id="page-title">Queue</h1>
        </div>
        <div className="queue-summary">
          <strong>{snapshot.upcoming_count} upcoming</strong>
          <span>{formatAlbumDuration(snapshot.upcoming_duration_seconds)}</span>
        </div>
      </header>

      {queue.error ? (
        <p className="queue-inline-error" role="alert">
          {queue.error}
        </p>
      ) : null}

      <section
        className="queue-current"
        aria-labelledby="queue-current-heading"
      >
        <h2 id="queue-current-heading">Now Playing</h2>
        {snapshot.current ? (
          <div className="queue-current__card">
            <Artwork
              artworkId={snapshot.current.artwork_id}
              albumTitle={snapshot.current.album}
              className="queue-current__artwork"
            />
            <div>
              <strong>{snapshot.current.title}</strong>
              <p>{snapshot.current.artist}</p>
              <small>{snapshot.current.album}</small>
              {!snapshot.current.available ? (
                <span className="unavailable-badge">
                  Unavailable — will be skipped
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="queue-current__empty">
            No track is currently selected.
          </p>
        )}
      </section>

      <section
        className="queue-upcoming"
        aria-labelledby="queue-upcoming-heading"
      >
        <div className="queue-upcoming__heading">
          <h2 id="queue-upcoming-heading">Upcoming</h2>
          {snapshot.upcoming.length ? (
            <button
              type="button"
              className="clear-queue-button"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
            >
              Clear Queue
            </button>
          ) : null}
        </div>

        {confirmClear ? (
          <ConfirmationPanel
            title="Clear upcoming tracks?"
            message="The current track will keep playing. Only upcoming items will be removed."
            confirmLabel="Clear Upcoming"
            disabled={busy}
            onCancel={() => setConfirmClear(false)}
            onConfirm={() => {
              setConfirmClear(false)
              void queue.clear()
            }}
          />
        ) : null}

        {snapshot.upcoming.length ? (
          <ol className="queue-list">
            {snapshot.upcoming.map((item, index) => (
              <li className="queue-row" key={item.id}>
                <span className="queue-row__position">{index + 1}</span>
                <div className="queue-row__copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.artist} · {item.album}
                  </small>
                  {!item.available ? (
                    <span className="unavailable-badge">
                      Unavailable — will be skipped
                    </span>
                  ) : null}
                </div>
                <time>{formatTrackDuration(item.duration_seconds)}</time>
                <div className="queue-row__controls">
                  <button
                    type="button"
                    onClick={() => void queue.move(item.id, 'up')}
                    disabled={busy || index === 0}
                    aria-label={`Move ${item.title} up`}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => void queue.move(item.id, 'down')}
                    disabled={busy || index === snapshot.upcoming.length - 1}
                    aria-label={`Move ${item.title} down`}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="queue-remove"
                    onClick={() => void queue.remove(item.id)}
                    disabled={busy}
                    aria-label={`Remove ${item.title} from queue`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="queue-current__empty">
            Nothing upcoming. The current track will finish normally.
          </p>
        )}
      </section>
    </div>
  )
}
