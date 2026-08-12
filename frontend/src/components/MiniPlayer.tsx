import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { formatTrackDuration } from '../utils/format'
import { Artwork } from './Artwork'
import { PlaybackControls } from './PlaybackControls'

export function MiniPlayer() {
  const player = useAudioPlayer()
  const duration = player.duration || player.currentTrack?.duration_seconds || 0
  const progress = duration > 0 ? (player.currentTime / duration) * 100 : 0

  return (
    <section className="mini-player" aria-label="Mini player">
      {player.currentTrack ? (
        <Artwork
          artworkId={player.currentTrack.artwork_id}
          albumTitle={player.currentTrack.album}
          className="mini-player__artwork"
        />
      ) : (
        <div className="album-placeholder" aria-hidden="true">
          ♪
        </div>
      )}
      <div className="mini-player__details">
        <p className="eyebrow">
          {player.currentTrack ? player.status : 'Nothing playing'}
        </p>
        <p className="mini-player__title">
          {player.error ??
            player.currentTrack?.title ??
            'Choose a track from your library'}
        </p>
        {player.currentTrack ? (
          <small>{player.currentTrack.artist}</small>
        ) : null}
      </div>
      <div className="mini-player__progress" aria-label="Playback progress">
        <span style={{ width: `${Math.min(100, progress)}%` }} />
        <time>
          {formatTrackDuration(player.currentTime)} /{' '}
          {formatTrackDuration(duration)}
        </time>
      </div>
      <PlaybackControls />
    </section>
  )
}
