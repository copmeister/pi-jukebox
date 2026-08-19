import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { useBluetooth } from '../bluetooth/BluetoothContext'
import { formatTrackDuration } from '../utils/format'
import { Artwork } from './Artwork'
import { PlaybackControls } from './PlaybackControls'

export function MiniPlayer({
  onOpenBluetooth,
}: {
  onOpenBluetooth: () => void
}) {
  const player = useAudioPlayer()
  const bluetooth = useBluetooth()
  const duration = player.duration || player.currentTrack?.duration_seconds || 0
  const progress = duration > 0 ? (player.currentTime / duration) * 100 : 0

  if (bluetooth.status.mode_active) {
    const device = bluetooth.status.devices.find(
      (candidate) => candidate.id === bluetooth.status.connected_device_id,
    )
    return (
      <section className="mini-player is-bluetooth" aria-label="Mini player">
        <div className="album-placeholder bluetooth-mark" aria-hidden="true">
          B
        </div>
        <div className="mini-player__details">
          <p className="eyebrow">Bluetooth receiver</p>
          <p className="mini-player__title">
            {device?.name ?? 'Waiting for a phone'}
          </p>
          <small>{bluetooth.status.message}</small>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onOpenBluetooth}
        >
          Bluetooth
        </button>
      </section>
    )
  }

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
          {player.currentTrack
            ? (player.presentationMessage ?? player.status)
            : 'Nothing playing'}
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
