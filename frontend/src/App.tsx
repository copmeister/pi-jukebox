import { useState } from 'react'
import { AudioPlayerProvider, useAudioPlayer } from './audio/AudioPlayerContext'
import { MiniPlayer } from './components/MiniPlayer'
import { Navigation } from './components/Navigation'
import { useCatalogue } from './hooks/useCatalogue'
import type { Destination } from './navigation'
import { AlbumScreen } from './screens/AlbumScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { PlaceholderScreen } from './screens/PlaceholderScreen'
import { SearchScreen } from './screens/SearchScreen'
import { NowPlayingScreen } from './screens/NowPlayingScreen'

function AppContent() {
  const [activeDestination, setActiveDestination] =
    useState<Destination>('Home')
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null)
  const catalogue = useCatalogue()
  const player = useAudioPlayer()

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
    content = (
      <SearchScreen
        onOpenAlbum={openAlbum}
        onPlayTrack={(track) => player.playTrack(track)}
      />
    )
  } else if (activeDestination === 'Queue') {
    content = (
      <PlaceholderScreen
        kicker="Up next"
        title="Queue"
        message="A persistent, touch-reorderable queue will arrive with playback. Nothing can be queued yet."
      />
    )
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
        {content}
      </main>

      <MiniPlayer />
      <Navigation active={activeDestination} onNavigate={navigate} />
    </div>
  )
}

export default function App() {
  return (
    <AudioPlayerProvider>
      <AppContent />
    </AudioPlayerProvider>
  )
}
