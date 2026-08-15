import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { Artwork } from '../components/Artwork'
import { PlaybackControls } from '../components/PlaybackControls'
import { ScreenState } from '../components/ScreenState'

export function NowPlayingScreen() {
  const player = useAudioPlayer()

  if (!player.currentTrack) {
    return (
      <div className="screen now-playing-screen">
        <ScreenState
          title="Nothing playing"
          message="Choose a track from an album or search result to start listening."
        />
      </div>
    )
  }

  return (
    <div className="screen now-playing-screen">
      <section className="now-playing-card" aria-labelledby="page-title">
        <Artwork
          artworkId={player.currentTrack.artwork_id}
          albumTitle={player.currentTrack.album}
          className="now-playing-artwork"
        />
        <div className="now-playing-copy">
          <p className="eyebrow">
            {player.presentationMessage ??
              (player.status === 'loading' ? 'Loading audio' : player.status)}
          </p>
          <h1 id="page-title">{player.currentTrack.title}</h1>
          <p className="now-playing-artist">{player.currentTrack.artist}</p>
          <p className="now-playing-album">{player.currentTrack.album}</p>
          <PlaybackControls detailed />
          {player.error ? (
            <p className="player-error" role="alert">
              {player.error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
