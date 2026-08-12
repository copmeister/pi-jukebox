import { useState } from 'react'
import { AudioPlayerProvider } from './audio/AudioPlayerContext'
import { MiniPlayer } from './components/MiniPlayer'
import { Navigation } from './components/Navigation'
import { useCatalogue } from './hooks/useCatalogue'
import type { Destination } from './navigation'
import { AlbumScreen } from './screens/AlbumScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { QueueScreen } from './screens/QueueScreen'
import { SearchScreen } from './screens/SearchScreen'
import { NowPlayingScreen } from './screens/NowPlayingScreen'
import { QueueProvider, useQueue } from './queue/QueueContext'

function AppContent() {
  const [activeDestination, setActiveDestination] =
    useState<Destination>('Home')
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null)
  const catalogue = useCatalogue()
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
  } else if (activeDestination === 'Home') {
    content = (
      <HomeScreen
        albums={catalogue.albums}
        scanStatus={catalogue.scanStatus}
        loading={catalogue.loading}
        error={catalogue.error}
        onBrowse={() => navigate('Library')}
        onOpenAlbum={openAlbum}
        onRetry={() => void catalogue.refresh()}
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
  } else {
    content = <NowPlayingScreen />
  }

  const serviceReady = !catalogue.error
  return (
    <div className="app-shell">
      <header className="top-bar">
        <button
          className="brand"
          type="button"
          onClick={() => navigate('Home')}
          aria-label="Go to Pi Jukebox home"
        >
          <span className="brand__mark" aria-hidden="true">
            PJ
          </span>
          <span>Pi Jukebox</span>
        </button>
        <div
          className={`connection-status${serviceReady ? '' : ' is-offline'}`}
          role="status"
        >
          <span aria-hidden="true" />{' '}
          {serviceReady ? 'Local catalogue ready' : 'Backend unavailable'}
        </div>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        {queue.notice || queue.error ? (
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
