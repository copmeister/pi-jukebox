import type { AlbumSummary, ScanStatus } from '../api/types'
import { AlbumCard } from '../components/AlbumCard'
import { ScreenState } from '../components/ScreenState'
import { pluralize } from '../utils/format'

interface HomeScreenProps {
  albums: AlbumSummary[]
  scanStatus: ScanStatus | null
  loading: boolean
  error: string | null
  onBrowse: () => void
  onOpenAlbum: (albumId: number) => void
  onRetry: () => void
}

export function HomeScreen({
  albums,
  scanStatus,
  loading,
  error,
  onBrowse,
  onOpenAlbum,
  onRetry,
}: HomeScreenProps) {
  const trackCount = albums.reduce(
    (total, album) => total + album.track_count,
    0,
  )

  return (
    <div className="screen home-screen">
      <section className="home-hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Local collection</p>
          <h1 id="page-title">Your music, all in one place.</h1>
          <p>
            {loading
              ? 'Checking your local catalogue…'
              : `${pluralize(albums.length, 'album')} and ${pluralize(trackCount, 'track')} ready to browse.`}
          </p>
          <button className="primary-button" type="button" onClick={onBrowse}>
            Browse Library
          </button>
        </div>
        <div className="library-totals" aria-label="Library totals">
          <span>
            <strong>{loading ? '—' : albums.length}</strong>
            Albums
          </span>
          <span>
            <strong>{loading ? '—' : trackCount}</strong>
            Tracks
          </span>
        </div>
      </section>

      {error ? (
        <ScreenState
          title="The library is out of reach"
          message={error}
          kind="error"
          actionLabel="Try again"
          onAction={onRetry}
        />
      ) : !loading && !scanStatus?.configured ? (
        <ScreenState
          title="Choose a music folder"
          message="Add your library folder to the local configuration, then return here to scan it."
        />
      ) : albums.length > 0 ? (
        <section className="home-selection" aria-labelledby="available-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">On this jukebox</p>
              <h2 id="available-heading">Available albums</h2>
            </div>
          </div>
          <div className="album-row">
            {albums.slice(0, 3).map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onOpen={onOpenAlbum}
                compact
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
