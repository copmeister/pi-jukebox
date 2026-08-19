interface SleepScreenProps {
  time: string
  onWake: () => void
}

export function SleepScreen({ time, onWake }: SleepScreenProps) {
  return (
    <button
      type="button"
      className="sleep-screen"
      aria-label="Wake Pi Jukebox"
      onClick={onWake}
    >
      <time>{time}</time>
      <span>Tap anywhere to wake</span>
    </button>
  )
}
