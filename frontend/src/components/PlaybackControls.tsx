import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { formatTrackDuration } from '../utils/format'

interface PlaybackControlsProps {
  detailed?: boolean
}

export function PlaybackControls({ detailed = false }: PlaybackControlsProps) {
  const player = useAudioPlayer()
  const duration = player.duration || player.currentTrack?.duration_seconds || 0

  return (
    <div className={`playback-controls${detailed ? ' is-detailed' : ''}`}>
      {detailed ? (
        <div className="seek-control">
          <span>{formatTrackDuration(player.currentTime)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(1, duration)}
            step="1"
            value={Math.min(player.currentTime, Math.max(1, duration))}
            onChange={(event) => player.seek(Number(event.target.value))}
            disabled={!player.currentTrack}
            aria-label="Track position"
          />
          <span>{formatTrackDuration(duration)}</span>
        </div>
      ) : null}
      <div className="transport-controls">
        <button
          type="button"
          onClick={player.previous}
          disabled={!player.canGoPrevious}
          aria-label="Previous track"
        >
          |&lt;
        </button>
        <button
          className="play-button"
          type="button"
          onClick={player.togglePlayback}
          disabled={!player.currentTrack}
          aria-label={player.status === 'playing' ? 'Pause' : 'Play'}
        >
          {player.status === 'playing' ? 'Ⅱ' : '▶'}
        </button>
        <button
          type="button"
          onClick={player.next}
          disabled={!player.canGoNext}
          aria-label="Next track"
        >
          &gt;|
        </button>
      </div>
      {detailed ? (
        <div className="volume-control">
          <button
            type="button"
            onClick={player.toggleMute}
            aria-label={player.muted ? 'Unmute' : 'Mute'}
          >
            {player.muted ? 'Muted' : 'Volume'}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={player.muted ? 0 : player.volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            aria-label="Volume"
          />
        </div>
      ) : null}
    </div>
  )
}
