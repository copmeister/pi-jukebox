import { useState } from 'react'
import type { Track } from '../api/types'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { useQueue } from '../queue/QueueContext'

interface TrackActionsProps {
  track: Track
}

export function TrackActions({ track }: TrackActionsProps) {
  const player = useAudioPlayer()
  const queue = useQueue()
  const [open, setOpen] = useState(false)
  const disabled = queue.mutating !== null

  const complete = (action: () => Promise<unknown>) => {
    setOpen(false)
    void action()
  }

  return (
    <div className="track-actions">
      <button
        type="button"
        className="track-actions__toggle"
        aria-expanded={open}
        aria-label={`Queue actions for ${track.title}`}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        Actions
      </button>
      {open ? (
        <div
          className="track-actions__menu"
          aria-label={`Actions for ${track.title}`}
        >
          <button
            type="button"
            onClick={() => complete(() => player.playNow(track))}
          >
            Play Now
          </button>
          <button
            type="button"
            onClick={() => complete(() => queue.playNext(track.id))}
          >
            Play Next
          </button>
          <button
            type="button"
            onClick={() => complete(() => queue.addTrack(track.id))}
          >
            Add to Queue
          </button>
        </div>
      ) : null}
    </div>
  )
}
