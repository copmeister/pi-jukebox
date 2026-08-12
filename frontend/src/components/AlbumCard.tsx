import type { AlbumSummary } from '../api/types'
import { formatAlbumDuration, pluralize } from '../utils/format'
import { Artwork } from './Artwork'

interface AlbumCardProps {
  album: AlbumSummary
  onOpen: (albumId: number) => void
  compact?: boolean
}

export function AlbumCard({ album, onOpen, compact = false }: AlbumCardProps) {
  return (
    <button
      className={`album-card${compact ? ' album-card--compact' : ''}`}
      type="button"
      onClick={() => onOpen(album.id)}
      aria-label={`Open ${album.title} by ${album.album_artist}`}
    >
      <Artwork artworkId={album.artwork_id} albumTitle={album.title} />
      <span className="album-card__copy">
        <strong>{album.title}</strong>
        <span>{album.album_artist}</span>
        <small>
          {pluralize(album.track_count, 'track')} ·{' '}
          {formatAlbumDuration(album.duration_seconds)}
        </small>
      </span>
    </button>
  )
}
