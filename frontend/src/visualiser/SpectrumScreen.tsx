import { useEffect, useState } from 'react'
import { visualiserStreamUrl } from '../api/client'
import type { SpectrumFrame } from '../api/types'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { useBluetooth } from '../bluetooth/BluetoothContext'
import { SpectrumCanvas } from './SpectrumCanvas'
import { parseSpectrumFrame } from './spectrum'

export function SpectrumScreen({ onBack }: { onBack: () => void }) {
  const player = useAudioPlayer()
  const bluetooth = useBluetooth()
  const [frame, setFrame] = useState<SpectrumFrame | null>(null)
  const [connectionMessage, setConnectionMessage] = useState(
    'Connecting to the jukebox audio output.',
  )

  useEffect(() => {
    let source: EventSource
    try {
      source = new EventSource(visualiserStreamUrl())
    } catch {
      const timer = window.setTimeout(() => {
        setConnectionMessage(
          'The spectrum stream is unavailable. Playback is unaffected.',
        )
      }, 0)
      return () => window.clearTimeout(timer)
    }
    source.onmessage = (event) => {
      try {
        const parsed = parseSpectrumFrame(JSON.parse(event.data) as unknown)
        if (!parsed) throw new Error('Invalid spectrum frame')
        setFrame(parsed)
        setConnectionMessage(parsed.message)
      } catch {
        setConnectionMessage(
          'The spectrum stream returned unreadable data. Playback is unaffected.',
        )
      }
    }
    source.onerror = () => {
      setConnectionMessage(
        'Reconnecting to the audio output monitor. Playback is unaffected.',
      )
    }
    return () => source.close()
  }, [])

  const device = bluetooth.status.devices.find(
    (candidate) => candidate.id === bluetooth.status.connected_device_id,
  )
  const title = bluetooth.status.mode_active
    ? 'Bluetooth audio'
    : (player.currentTrack?.title ?? 'Jukebox audio')
  const localDetails = player.currentTrack
    ? [player.currentTrack.artist, player.currentTrack.album]
        .filter(Boolean)
        .join(' · ') || 'Local jukebox playback'
    : 'Final DAC output'
  const details = bluetooth.status.mode_active
    ? `${device?.name ?? 'Bluetooth receiver'} · ${bluetooth.status.message}`
    : localDetails
  return (
    <div className="screen spectrum-screen">
      <div className="spectrum-stage">
        <SpectrumCanvas
          frame={frame}
          riseRate={frame?.rise_rate}
          fallRate={frame?.fall_rate}
        />
        <div className="spectrum-track-overlay">
          <h1>{title}</h1>
          <p>{details}</p>
        </div>
        <button type="button" className="spectrum-exit-button" onClick={onBack}>
          Exit Spectrum
        </button>
        <p className="visually-hidden" role="status" aria-live="polite">
          {connectionMessage}
        </p>
      </div>
    </div>
  )
}
