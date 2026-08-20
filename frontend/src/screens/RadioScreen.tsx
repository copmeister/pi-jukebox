import { useState } from 'react'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { StationMark } from '../radio/StationMark'
import { RADIO_STATIONS, type RadioStation } from '../radio/stations'
import { SpectrumScreen } from '../visualiser/SpectrumScreen'

function stationStatus(
  station: RadioStation,
  status: ReturnType<typeof useAudioPlayer>['status'],
  error: string | null,
): string {
  if (error) return error
  if (status === 'playing') return 'Playing live through the jukebox output.'
  if (status === 'paused') return 'Radio is paused.'
  return `Connecting to ${station.name}…`
}

export function RadioScreen() {
  const player = useAudioPlayer()
  const [showSpectrum, setShowSpectrum] = useState(false)
  const activeStation = player.source === 'radio' ? player.radioStation : null

  if (showSpectrum && activeStation) {
    return <SpectrumScreen onBack={() => setShowSpectrum(false)} />
  }

  return (
    <div className="screen radio-screen">
      <header className="screen-header radio-header">
        <div>
          <p className="eyebrow">Internet radio</p>
          <h1>Radio</h1>
        </div>
      </header>

      {activeStation ? (
        <section className="radio-active" aria-label="Live radio controls">
          <StationMark station={activeStation} compact />
          <div className="radio-active__copy">
            <p className="eyebrow">Live Radio</p>
            <h2>{activeStation.name}</h2>
            <p
              role={player.status === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {stationStatus(activeStation, player.status, player.error)}
            </p>
          </div>
          <div className="radio-active__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={player.stopRadio}
            >
              Stop
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => setShowSpectrum(true)}
            >
              Open Spectrum
            </button>
          </div>
        </section>
      ) : null}

      <section className="radio-grid" aria-label="Radio stations">
        {RADIO_STATIONS.map((station) => {
          const active = activeStation?.id === station.id
          return (
            <button
              type="button"
              className={`radio-station${active ? ' is-active' : ''}`}
              aria-label={`${active ? 'Restart' : 'Play'} ${station.name}`}
              aria-pressed={active}
              onClick={() => void player.playRadio(station)}
              key={station.id}
            >
              <StationMark station={station} />
              <strong>{station.name}</strong>
              <span>{active ? 'Playing live' : 'Tap to play'}</span>
            </button>
          )
        })}
      </section>
    </div>
  )
}
