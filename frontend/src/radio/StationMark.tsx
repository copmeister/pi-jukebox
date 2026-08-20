import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { RadioStation } from './stations'

export function StationMark({
  station,
  compact = false,
}: {
  station: RadioStation
  compact?: boolean
}) {
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null)
  if (station.artwork && failedArtwork !== station.artwork) {
    return (
      <img
        className={`radio-station__logo${compact ? ' is-compact' : ''}`}
        src={station.artwork}
        alt=""
        onError={() => setFailedArtwork(station.artwork ?? null)}
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
