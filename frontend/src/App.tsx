import { useState } from 'react'
import { AudioPlayerProvider } from './audio/AudioPlayerContext'
import { MiniPlayer } from './components/MiniPlayer'
import { Navigation } from './components/Navigation'
import { useCatalogue } from './hooks/useCatalogue'
import { useCdStatus } from './hooks/useCdStatus'
import type { Destination } from './navigation'
import { AlbumScreen } from './screens/AlbumScreen'
import { CdScreen } from './screens/CdScreen'
import { JukeboxScreen } from './screens/JukeboxScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { QueueScreen } from './screens/QueueScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { NowPlayingScreen } from './screens/NowPlayingScreen'
import { QueueProvider, useQueue } from './queue/QueueContext'

function AppContent() {
  const [activeDestination, setActiveDestination] =
    useState<Destination>('Jukebox')
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null)
  const catalogue = useCatalogue()
  const cd = useCdStatus(() => void catalogue.refresh())
  const queue = useQueue()

  const navigate = (destination: Destination) => {
    setSelectedAlbumId(null)
    setActiveDestination(destination)
  }

  const openAlbum = (albumId: number) => {
    setActiveDestination('Library')
    setSelectedAlbumId(albumId)
  }

  let content
  if (selectedAlbumId !== null) {
    content = (
      <AlbumScreen
        key={selectedAlbumId}
        albumId={selectedAlbumId}
        onBack={() => setSelectedAlbumId(null)}
      />
    )
  } else if (activeDestination === 'Jukebox') {
    content = (
      <JukeboxScreen
        scanStatus={catalogue.scanStatus}
        catalogueError={catalogue.error}
        onOpenLibrary={() => navigate('Library')}
      />
    )
  } else if (activeDestination === 'Library') {
    content = (
      <LibraryScreen
        albums={catalogue.albums}
        scanStatus={catalogue.scanStatus}
        loading={catalogue.loading}
        error={catalogue.error}
        scanMessage={catalogue.scanMessage}
        onOpenAlbum={openAlbum}
        onRescan={() => void catalogue.rescan()}
        onRetry={() => void catalogue.refresh()}
      />
    )
  } else if (activeDestination === 'Search') {
    content = <SearchScreen onOpenAlbum={openAlbum} />
  } else if (activeDestination === 'Queue') {
    content = <QueueScreen onBrowse={() => navigate('Library')} />
  } else if (activeDestination === 'CD') {
    content = <CdScreen cd={cd} />
  } else if (activeDestination === 'Now Playing') {
    content = <NowPlayingScreen />
  } else {
    content = <SettingsScreen />
  }

  const serviceReady = !catalogue.error
  return (
    <div className="app-shell">
      <header className="top-bar">
        <button
          className="brand"
          type="button"
          onClick={() => navigate('Jukebox')}
          aria-label="Go to classic Jukebox"
        >
          <span className="brand__mark" aria-hidden="true">
            PJ
          </span>
          <span>Pi Jukebox</span>
        </button>
        <div className="top-statuses">
          {cd.status?.active && cd.status.latest_job ? (
            <button
              type="button"
              className="rip-status-pill"
              onClick={() => navigate('CD')}
              aria-label="Return to current CD rip"
            >
              Ripping {cd.status.latest_job.completed_tracks}/
              {cd.status.latest_job.total_tracks}
            </button>
          ) : null}
          <div
            className={`connection-status${serviceReady ? '' : ' is-offline'}`}
            role="status"
          >
            <span aria-hidden="true" />{' '}
            {serviceReady ? 'Local catalogue ready' : 'Backend unavailable'}
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className={`main-content${activeDestination === 'Jukebox' ? ' is-jukebox' : ''}`}
        tabIndex={-1}
      >
        {activeDestination !== 'Jukebox' && (queue.notice || queue.error) ? (
          <div
            className={`queue-feedback${queue.error ? ' is-error' : ''}`}
            role={queue.error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {queue.error ?? queue.notice}
          </div>
        ) : null}
        {content}
      </main>

      <MiniPlayer />
      <Navigation active={activeDestination} onNavigate={navigate} />
    </div>
  )
}

export default function App() {
  return (
    <QueueProvider>
      <AudioPlayerProvider>
        <AppContent />
      </AudioPlayerProvider>
    </QueueProvider>
  )
}
