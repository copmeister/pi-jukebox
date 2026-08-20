import { useEffect, useState } from 'react'
import { visualiserStreamUrl } from '../api/client'
import type { SpectrumFrame } from '../api/types'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { useBluetooth } from '../bluetooth/BluetoothContext'
import { formatTrackDuration } from '../utils/format'
import { SpectrumCanvas } from './SpectrumCanvas'
import { parseSpectrumFrame } from './spectrum'

export function SpectrumScreen({ onBack }: { onBack: () => void }) {
  const player = useAudioPlayer()
  const bluetooth = useBluetooth()
  const [frame, setFrame] = useState<SpectrumFrame | null>(null)
  const [connectionMessage, setConnectionMessage] = useState(
    'Connecting to the jukebox audio output.',
  )
  const [streamFailed, setStreamFailed] = useState(false)

  useEffect(() => {
    let source: EventSource
    try {
      source = new EventSource(visualiserStreamUrl())
    } catch {
      const timer = window.setTimeout(() => {
        setStreamFailed(true)
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
        setStreamFailed(parsed.status === 'unavailable')
        setConnectionMessage(parsed.message)
      } catch {
        setStreamFailed(true)
        setConnectionMessage(
          'The spectrum stream returned unreadable data. Playback is unaffected.',
        )
      }
    }
    source.onerror = () => {
      setStreamFailed(true)
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
  const details = bluetooth.status.mode_active
    ? `${device?.name ?? 'Bluetooth receiver'} · ${bluetooth.status.message}`
    : player.currentTrack
      ? `${player.currentTrack.artist} · ${player.currentTrack.album}`
      : 'Final DAC output'
  const duration = player.duration || player.currentTrack?.duration_seconds || 0
  const time =
    !bluetooth.status.mode_active && duration > 0
      ? `${formatTrackDuration(player.currentTime)} / ${formatTrackDuration(duration)}`
      : null
  const showNotice = frame?.status !== 'ready'

  return (
    <div className="screen spectrum-screen">
      <header className="spectrum-header">
        <button type="button" className="back-button" onClick={onBack}>
          ‹ Now Playing
        </button>
        <div className="spectrum-track-copy">
          <h1>{title}</h1>
          <p>
            {details}
            {time ? <span className="spectrum-time"> · {time}</span> : null}
          </p>
        </div>
        <span
          className={`spectrum-status${frame?.status === 'ready' ? ' is-ready' : ''}`}
          title={connectionMessage}
          aria-label={connectionMessage}
        >
          {frame?.status === 'ready' ? 'Live' : 'Waiting'}
        </span>
      </header>
      <div className="spectrum-stage">
        <SpectrumCanvas
          frame={frame}
          riseRate={frame?.rise_rate}
          fallRate={frame?.fall_rate}
        />
        {showNotice ? (
          <div className="spectrum-unavailable" role="status">
            <strong>
              {streamFailed ? 'Spectrum unavailable' : 'Connecting spectrum'}
            </strong>
            <span>{connectionMessage}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
