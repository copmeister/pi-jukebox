import { useState } from 'react'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { useBluetooth } from '../bluetooth/BluetoothContext'
import { Artwork } from '../components/Artwork'
import { PlaybackControls } from '../components/PlaybackControls'
import { ScreenState } from '../components/ScreenState'
import { StationMark } from '../radio/StationMark'
import { radioNowPlayingText } from '../radio/nowPlaying'
import { SpectrumScreen } from '../visualiser/SpectrumScreen'

export function NowPlayingScreen({
  onOpenBluetooth,
  onOpenRadio,
}: {
  onOpenBluetooth: () => void
  onOpenRadio: () => void
}) {
  const player = useAudioPlayer()
  const bluetooth = useBluetooth()
  const [showSpectrum, setShowSpectrum] = useState(false)

  if (showSpectrum) {
    return <SpectrumScreen onBack={() => setShowSpectrum(false)} />
  }

  if (bluetooth.status.mode_active) {
    const device = bluetooth.status.devices.find(
      (candidate) => candidate.id === bluetooth.status.connected_device_id,
    )
    return (
      <div className="screen now-playing-screen">
        <section className="now-playing-card bluetooth-now-playing">
          <div
            className="now-playing-artwork bluetooth-now-playing__mark"
            aria-hidden="true"
          >
            B
          </div>
          <div className="now-playing-copy">
            <p className="eyebrow">Bluetooth receiver</p>
            <h1>{device?.name ?? 'Waiting for a phone'}</h1>
            <p className="now-playing-artist">{bluetooth.status.message}</p>
            <p className="now-playing-album">
              Playback is controlled on the connected phone.
            </p>
            <div className="now-playing-actions">
              <button
                type="button"
                className="primary-button"
                onClick={onOpenBluetooth}
              >
                Open Bluetooth Controls
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowSpectrum(true)}
              >
                Open Spectrum
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  if (player.source === 'radio' && player.radioStation) {
    const nowPlaying = radioNowPlayingText(player.radioNowPlaying)
    return (
      <div className="screen now-playing-screen">
        <section className="now-playing-card radio-now-playing">
          <StationMark station={player.radioStation} />
          <div className="now-playing-copy">
            <p className="eyebrow">Live Radio · {player.status}</p>
            <h1>{player.radioStation.name}</h1>
            <p className="now-playing-artist">
              {player.error ?? nowPlaying ?? 'Live Radio'}
            </p>
            <div className="now-playing-actions">
              <button
                type="button"
                className="primary-button"
                onClick={onOpenRadio}
              >
                Open Radio
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={player.stopRadio}
              >
                Stop
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowSpectrum(true)}
              >
                Open Spectrum
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }

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
          <button
            type="button"
            className="secondary-button spectrum-open-button"
            onClick={() => setShowSpectrum(true)}
          >
            Open Spectrum
          </button>
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
