import type { AlbumSummary, ScanStatus } from '../api/types'
import { AlbumCard } from '../components/AlbumCard'
import { ScreenState } from '../components/ScreenState'

interface LibraryScreenProps {
  albums: AlbumSummary[]
  scanStatus: ScanStatus | null
  loading: boolean
  error: string | null
  scanMessage: string | null
  onOpenAlbum: (albumId: number) => void
  onRescan: () => void
  onRetry: () => void
}

function scanSummary(scanStatus: ScanStatus | null): string {
  if (scanStatus?.running) return 'Scanning your music folder now…'
  const scan = scanStatus?.latest_scan
  if (!scan) return 'This library has not been scanned yet.'
  if (scan.status === 'failed') return 'The last scan could not finish.'
  return `${scan.files_discovered} files checked · ${scan.files_added} added · ${scan.files_updated} updated · ${scan.files_removed} removed`
}

export function LibraryScreen({
  albums,
  scanStatus,
  loading,
  error,
  scanMessage,
  onOpenAlbum,
  onRescan,
  onRetry,
}: LibraryScreenProps) {
  const canScan = Boolean(scanStatus?.configured && scanStatus.available)
  const unavailableMessage = !scanStatus?.configured
    ? 'No music folder is configured. Add one to your local .env file, then restart the backend.'
    : 'The configured music folder is unavailable. Check that the drive or folder can be opened.'

  return (
    <div className="screen library-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Local collection</p>
          <h1 id="page-title">Library</h1>
          <p>
            {loading
              ? 'Loading albums…'
              : `${albums.length} albums in your catalogue`}
          </p>
        </div>
        <button
          className="secondary-button scan-button"
          type="button"
          onClick={onRescan}
          disabled={!canScan || scanStatus?.running}
          aria-describedby="scan-summary"
        >
          {scanStatus?.running ? 'Scanning…' : 'Rescan Library'}
        </button>
      </header>

      <div
        className="scan-strip"
        data-running={scanStatus?.running || undefined}
      >
        <span className="scan-strip__dot" aria-hidden="true" />
        <p id="scan-summary" role="status" aria-live="polite">
          {scanMessage ?? scanSummary(scanStatus)}
        </p>
      </div>

      {error ? (
        <ScreenState
          title="The catalogue could not be loaded"
          message={error}
          kind="error"
          actionLabel="Try again"
          onAction={onRetry}
        />
      ) : loading ? (
        <ScreenState
          title="Opening your library"
          message="Fetching albums and artwork from the local catalogue."
          kind="loading"
        />
      ) : !scanStatus?.available ? (
        <ScreenState
          title="Music folder unavailable"
          message={unavailableMessage}
        />
      ) : albums.length === 0 ? (
        <ScreenState
          title="No music found yet"
          message="Add supported audio files to the configured folder, then choose Rescan Library."
        />
      ) : (
        <section className="album-grid" aria-label="Albums">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} onOpen={onOpenAlbum} />
          ))}
        </section>
      )}
    </div>
  )
}
