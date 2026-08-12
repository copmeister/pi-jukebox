import { useEffect, useState } from 'react'
import { ApiError, searchCatalogue } from '../api/client'
import type { SearchResults } from '../api/types'
import { AlbumCard } from '../components/AlbumCard'
import { ScreenState } from '../components/ScreenState'
import { formatTrackDuration } from '../utils/format'

interface SearchScreenProps {
  onOpenAlbum: (albumId: number) => void
}

export function SearchScreen({ onOpenAlbum }: SearchScreenProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const normalizedQuery = query.trim()

  useEffect(() => {
    if (!normalizedQuery) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void searchCatalogue(normalizedQuery, controller.signal)
        .then(setResults)
        .catch((searchError) => {
          if (
            searchError instanceof DOMException &&
            searchError.name === 'AbortError'
          )
            return
          setError(
            searchError instanceof ApiError
              ? searchError.message
              : 'Search could not be completed.',
          )
        })
        .finally(() => setLoading(false))
    }, 350)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [normalizedQuery])

  const hasResults = Boolean(
    results && (results.albums.length || results.tracks.length),
  )

  return (
    <div className="screen search-screen">
      <header className="screen-header search-heading">
        <div>
          <p className="eyebrow">Find a favourite</p>
          <h1 id="page-title">Search</h1>
          <p>Albums, Album Artists, track artists and track titles</p>
        </div>
      </header>
      <label className="search-box">
        <span className="visually-hidden">Search your music library</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setResults(null)
            setError(null)
          }}
          placeholder="Search your library"
          autoComplete="off"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setResults(null)
              setError(null)
              setLoading(false)
            }}
            aria-label="Clear search"
          >
            ×
          </button>
        ) : null}
      </label>

      <div className="search-status" role="status" aria-live="polite">
        {loading
          ? 'Searching…'
          : results
            ? `${results.albums.length + results.tracks.length} results`
            : ''}
      </div>

      {error ? (
        <ScreenState
          title="Search is unavailable"
          message={error}
          kind="error"
        />
      ) : !normalizedQuery ? (
        <ScreenState
          title="What would you like to hear?"
          message="Start typing an album, artist, or track name."
        />
      ) : loading && !results ? (
        <ScreenState
          title="Searching your library"
          message="Looking through the local catalogue."
          kind="loading"
        />
      ) : results && !hasResults ? (
        <ScreenState
          title="No matches found"
          message={`Nothing in this library matches “${results.query}”.`}
        />
      ) : results ? (
        <div className="search-results">
          {results.albums.length ? (
            <section aria-labelledby="album-results-heading">
              <h2 id="album-results-heading">Albums</h2>
              <div className="search-albums">
                {results.albums.map((album) => (
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
          {results.tracks.length ? (
            <section aria-labelledby="track-results-heading">
              <h2 id="track-results-heading">Tracks</h2>
              <div className="search-tracks">
                {results.tracks.map((track) => (
                  <button
                    type="button"
                    key={track.id}
                    className="search-track"
                    onClick={() => onOpenAlbum(track.album_id)}
                    aria-label={`Open album ${track.album} for track ${track.title}`}
                  >
                    <span className="search-track__mark" aria-hidden="true">
                      ♪
                    </span>
                    <span>
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist} · {track.album}
                      </small>
                    </span>
                    <time>{formatTrackDuration(track.duration_seconds)}</time>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
