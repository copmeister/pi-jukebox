import { useState } from 'react'
import { AudioPlayerProvider, useAudioPlayer } from './audio/AudioPlayerContext'
import { sleepPhysicalDisplay, wakePhysicalDisplay } from './api/client'
import { BluetoothProvider, useBluetooth } from './bluetooth/BluetoothContext'
import { MiniPlayer } from './components/MiniPlayer'
import { Navigation } from './components/Navigation'
import { SleepScreen } from './components/SleepScreen'
import {
  DisplaySizeProvider,
  useDisplaySize,
} from './display/DisplaySizeContext'
import { useCatalogue } from './hooks/useCatalogue'
import { useCdStatus } from './hooks/useCdStatus'
import type { Destination } from './navigation'
import { AlbumScreen } from './screens/AlbumScreen'
import { BluetoothScreen } from './screens/BluetoothScreen'
import { CdScreen } from './screens/CdScreen'
import { JukeboxScreen } from './screens/JukeboxScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { QueueScreen } from './screens/QueueScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { NowPlayingScreen } from './screens/NowPlayingScreen'
import { QueueProvider, useQueue } from './queue/QueueContext'

interface AppContentProps {
  sleeping: boolean
  onSleep: () => void
  onWake: () => void
}

function AppContent({ sleeping, onSleep, onWake }: AppContentProps) {
  const { displaySize } = useDisplaySize()
  const [activeDestination, setActiveDestination] =
    useState<Destination>('Jukebox')
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null)
  const catalogue = useCatalogue(sleeping)
  const cd = useCdStatus(() => void catalogue.refresh(), sleeping)
  const queue = useQueue()
  const bluetooth = useBluetooth()
  const player = useAudioPlayer()

  const sleep = () => {
    onSleep()
    void sleepPhysicalDisplay().catch(() => undefined)
  }

  const wake = () => {
    onWake()
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await wakePhysicalDisplay()
          if (result.adjusted || !result.available) return
        } catch {
          // A retry can recover from a brief backend restart during wake.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250))
      }
    })()
  }

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
  } else if (activeDestination === 'Bluetooth') {
    content = <BluetoothScreen />
  } else if (activeDestination === 'Now Playing') {
    content = <NowPlayingScreen onOpenBluetooth={() => navigate('Bluetooth')} />
  } else {
    content = <SettingsScreen sleeping={sleeping} />
  }

  const serviceReady = !catalogue.error
  return (
    <>
      <div
        className={`app-shell${sleeping ? ' is-sleeping' : ''}`}
        data-display-size={displaySize}
        aria-hidden={sleeping || undefined}
      >
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
            <button type="button" className="sleep-button" onClick={sleep}>
              Sleep
            </button>
            {bluetooth.status.mode_active ? (
              <button
                type="button"
                className="bluetooth-status-pill"
                onClick={() => navigate('Bluetooth')}
                aria-label="Open Bluetooth receiver controls"
              >
                Bluetooth · {bluetooth.status.state.replaceAll('_', ' ')}
              </button>
            ) : null}
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
          data-scroll-region="vertical"
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

        <MiniPlayer onOpenBluetooth={() => navigate('Bluetooth')} />
        <Navigation active={activeDestination} onNavigate={navigate} />
      </div>
      {sleeping ? (
        <SleepScreen
          trackTitle={
            player.status === 'playing' ? player.currentTrack?.title : undefined
          }
          trackArtist={
            player.status === 'playing'
              ? player.currentTrack?.artist
              : undefined
          }
          bluetoothAudio={bluetooth.status.state === 'audio_playing'}
          onWake={wake}
        />
      ) : null}
    </>
  )
}

export default function App() {
  const [sleeping, setSleeping] = useState(false)
  return (
    <DisplaySizeProvider>
      <BluetoothProvider>
        <QueueProvider>
          <AudioPlayerProvider sleeping={sleeping}>
            <AppContent
              sleeping={sleeping}
              onSleep={() => setSleeping(true)}
              onWake={() => setSleeping(false)}
            />
          </AudioPlayerProvider>
        </QueueProvider>
      </BluetoothProvider>
    </DisplaySizeProvider>
  )
}
