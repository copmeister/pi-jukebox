import { useState } from 'react'
import { MiniPlayer } from './components/MiniPlayer'
import { Navigation } from './components/Navigation'
import type { Destination } from './navigation'

const pageCopy: Record<
  Destination,
  { kicker: string; title: string; description: string }
> = {
  Home: {
    kicker: 'Welcome back',
    title: 'Your music, ready when you are.',
    description:
      'The first albums and listening shortcuts will live here once the library is connected.',
  },
  Library: {
    kicker: 'Local collection',
    title: 'Library',
    description:
      'Albums and tracks from your configured music folder will appear here in a later milestone.',
  },
  Search: {
    kicker: 'Find a favourite',
    title: 'Search',
    description:
      'Search by album, artist, or track after the catalogue and scanner have been added.',
  },
  Queue: {
    kicker: 'Up next',
    title: 'Queue',
    description:
      'Your persistent, reorderable queue will be implemented after playback foundations.',
  },
  'Now Playing': {
    kicker: 'Current session',
    title: 'Now Playing',
    description:
      'Artwork, track details, controls, and the live visualiser will eventually fill this screen.',
  },
}

function App() {
  const [activeDestination, setActiveDestination] =
    useState<Destination>('Home')
  const copy = pageCopy[activeDestination]

  return (
    <div className="app-shell">
      <header className="top-bar">
        <a className="brand" href="#main-content" aria-label="Pi Jukebox home">
          <span className="brand__mark" aria-hidden="true">
            PJ
          </span>
          <span>Pi Jukebox</span>
        </a>
        <div className="connection-status" role="status">
          <span aria-hidden="true" /> Foundation ready
        </div>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        <section className="welcome-panel" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">{copy.kicker}</p>
            <h1 id="page-title">{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className="record-motif" aria-hidden="true">
            <span>♪</span>
          </div>
        </section>

        <section className="feature-grid" aria-label="Project status">
          <article>
            <span className="feature-number">01</span>
            <div>
              <h2>Touch first</h2>
              <p>Large controls for 1024×600 and 800×480 screens.</p>
            </div>
          </article>
          <article>
            <span className="feature-number">02</span>
            <div>
              <h2>Local by design</h2>
              <p>Your catalogue and settings will remain on the jukebox.</p>
            </div>
          </article>
          <article>
            <span className="feature-number">03</span>
            <div>
              <h2>Coming next</h2>
              <p>Library scanning and album browsing follow this foundation.</p>
            </div>
          </article>
        </section>
      </main>

      <MiniPlayer />
      <Navigation
        active={activeDestination}
        onNavigate={setActiveDestination}
      />
    </div>
  )
}

export default App
