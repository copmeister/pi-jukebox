import { useState } from 'react'
import { artworkUrl } from '../api/client'

interface ArtworkProps {
  artworkId: number | null
  albumTitle: string
  className?: string
}

export function Artwork({
  artworkId,
  albumTitle,
  className = '',
}: ArtworkProps) {
  const [failedArtworkId, setFailedArtworkId] = useState<number | null>(null)
  const showImage = artworkId !== null && failedArtworkId !== artworkId

  return (
    <div className={`artwork ${className}`.trim()}>
      {showImage ? (
        <img
          src={artworkUrl(artworkId)}
          alt={`Cover artwork for ${albumTitle}`}
          onError={() => setFailedArtworkId(artworkId)}
        />
      ) : (
        <div
          className="artwork__placeholder"
          aria-label={`No artwork for ${albumTitle}`}
        >
          <span aria-hidden="true">♪</span>
          <small>No artwork</small>
        </div>
      )}
    </div>
  )
}
