export function MiniPlayer() {
  return (
    <section className="mini-player" aria-label="Mini player">
      <div className="album-placeholder" aria-hidden="true">
        ♪
      </div>
      <div className="mini-player__details">
        <p className="eyebrow">Nothing playing</p>
        <p className="mini-player__title">Choose music from your library</p>
      </div>
      <div className="mini-player__progress" aria-hidden="true">
        <span />
      </div>
      <div
        className="mini-player__controls"
        aria-label="Playback controls unavailable"
      >
        <button type="button" disabled aria-label="Previous track">
          |&lt;
        </button>
        <button
          className="play-button"
          type="button"
          disabled
          aria-label="Play"
        >
          ▶
        </button>
        <button type="button" disabled aria-label="Next track">
          &gt;|
        </button>
      </div>
    </section>
  )
}
