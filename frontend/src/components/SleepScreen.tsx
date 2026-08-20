import { useEffect, useState } from 'react'

interface SleepScreenProps {
  trackTitle?: string
  trackArtist?: string
  bluetoothAudio?: boolean
  onWake: () => void
}

const clockFormatter = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function SleepScreen({
  trackTitle,
  trackArtist,
  bluetoothAudio = false,
  onWake,
}: SleepScreenProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: number | undefined
    const scheduleNextMinute = () => {
      const current = new Date()
      const delay =
        60_000 - (current.getSeconds() * 1000 + current.getMilliseconds())
      timer = window.setTimeout(() => {
        setNow(new Date())
        scheduleNextMinute()
      }, delay)
    }
    scheduleNextMinute()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  return (
    <button
      type="button"
      className="sleep-screen"
      aria-label="Wake Pi Jukebox"
      onClick={onWake}
    >
      <time dateTime={now.toISOString()}>{clockFormatter.format(now)}</time>
      {trackTitle ? (
        <span className="sleep-screen__track">
          <strong>{trackTitle}</strong>
          {trackArtist ? <small>{trackArtist}</small> : null}
        </span>
      ) : bluetoothAudio ? (
        <span className="sleep-screen__track">
          <strong>Bluetooth audio</strong>
        </span>
      ) : null}
      <span>Tap anywhere to wake</span>
    </button>
  )
}
