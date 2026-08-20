import type { CSSProperties } from 'react'
import type { RadioStation } from './stations'

export function StationMark({
  station,
  compact = false,
}: {
  station: RadioStation
  compact?: boolean
}) {
  if (station.logo) {
    return (
      <img
        className={`radio-station__logo${compact ? ' is-compact' : ''}`}
        src={station.logo}
        alt=""
      />
    )
  }
  return (
    <span
      className={`radio-station__mark${compact ? ' is-compact' : ''}`}
      style={{ '--station-accent': station.accent } as CSSProperties}
      aria-hidden="true"
    >
      {station.mark}
    </span>
  )
}
