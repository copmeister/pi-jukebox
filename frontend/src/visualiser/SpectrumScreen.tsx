import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { visualiserStreamUrl } from '../api/client'
import type { SpectrumFrame } from '../api/types'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { useBluetooth } from '../bluetooth/BluetoothContext'
import { SpectrumCanvas } from './SpectrumCanvas'
import {
  cycleSpectrumColourScheme,
  horizontalSwipeDirection,
  loadSpectrumColourScheme,
  parseSpectrumFrame,
  saveSpectrumColourScheme,
} from './spectrum'

const SPECTRUM_SWIPE_THRESHOLD = 72

export function SpectrumScreen({ onBack }: { onBack: () => void }) {
  const player = useAudioPlayer()
  const bluetooth = useBluetooth()
  const [frame, setFrame] = useState<SpectrumFrame | null>(null)
  const [connectionMessage, setConnectionMessage] = useState(
    'Connecting to the jukebox audio output.',
  )
  const [colourScheme, setColourScheme] = useState(loadSpectrumColourScheme)
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null)

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

  useEffect(() => {
    saveSpectrumColourScheme(colourScheme)
  }, [colourScheme])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.spectrum-exit-button')
    ) {
      return
    }
    pointerStart.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start || start.id !== event.pointerId) return
    const direction = horizontalSwipeDirection(
      event.clientX - start.x,
      event.clientY - start.y,
      SPECTRUM_SWIPE_THRESHOLD,
    )
    if (!direction) return
    setColourScheme((current) => cycleSpectrumColourScheme(current, direction))
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStart.current?.id === event.pointerId)
      pointerStart.current = null
  }

  const device = bluetooth.status.devices.find(
    (candidate) => candidate.id === bluetooth.status.connected_device_id,
  )
  const title = bluetooth.status.mode_active
    ? 'Bluetooth audio'
    : player.source === 'radio' && player.radioStation
      ? player.radioStation.name
      : (player.currentTrack?.title ?? 'Jukebox audio')
  const localDetails = player.currentTrack
    ? [player.currentTrack.artist, player.currentTrack.album]
        .filter(Boolean)
        .join(' · ') || 'Local jukebox playback'
    : 'Final DAC output'
  const details = bluetooth.status.mode_active
    ? `${device?.name ?? 'Bluetooth receiver'} · ${bluetooth.status.message}`
    : player.source === 'radio' && player.radioStation
      ? 'Live Radio'
      : localDetails
  return (
    <div className="screen spectrum-screen">
      <div
        className="spectrum-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <SpectrumCanvas
          frame={frame}
          riseRate={frame?.rise_rate}
          fallRate={frame?.fall_rate}
          colourScheme={colourScheme}
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
        <p className="visually-hidden" role="status" aria-live="polite">
          Spectrum colours: {colourScheme}
        </p>
      </div>
    </div>
  )
}
