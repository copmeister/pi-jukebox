import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ApiError, getTracks } from '../api/client'
import type { ScanStatus, Track } from '../api/types'
import { useAudioPlayer } from '../audio/AudioPlayerContext'
import { ConfirmationPanel } from '../components/ConfirmationPanel'
import { ScreenState } from '../components/ScreenState'
import {
  generatePanels,
  generateReplacementPanel,
  type RandomSource,
} from '../jukebox/randomPanels'
import { useQueue } from '../queue/QueueContext'

const PANEL_LETTERS = ['A', 'B', 'C', 'D'] as const
const SONG_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const SWIPE_THRESHOLD = 64

type PanelLetter = (typeof PANEL_LETTERS)[number]

interface DisplayPanel {
  id: number
  letter: PanelLetter
  tracks: Track[]
}

interface PointerStart {
  id: number
  x: number
  y: number
  triggered: boolean
}

interface JukeboxScreenProps {
  scanStatus: ScanStatus | null
  catalogueError?: string | null
  onOpenLibrary: () => void
  random?: RandomSource
  transitionDurationMs?: number
  selectionResetMs?: number
}

function catalogueRequestError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The jukebox could not load the local song catalogue.'
}

export function JukeboxScreen({
  scanStatus,
  catalogueError = null,
  onOpenLibrary,
  random = Math.random,
  transitionDurationMs = 320,
  selectionResetMs = 650,
}: JukeboxScreenProps) {
  const queue = useQueue()
  const player = useAudioPlayer()
  const [tracks, setTracks] = useState<Track[]>([])
  const [panels, setPanels] = useState<DisplayPanel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLetter, setSelectedLetter] = useState<PanelLetter | null>(null)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState(
    'Choose a letter, then a number.',
  )
  const [confirmStop, setConfirmStop] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [sliding, setSliding] = useState(false)
  const nextPanelId = useRef(1)
  const selectionLocked = useRef(false)
  const transitionLocked = useRef(false)
  const pointerStart = useRef<PointerStart | null>(null)
  const selectionTimer = useRef<number | null>(null)
  const transitionTimer = useRef<number | null>(null)
  const transitionStartTimer = useRef<number | null>(null)

  const createPanel = useCallback(
    (letter: PanelLetter, panelTracks: Track[]): DisplayPanel => ({
      id: nextPanelId.current++,
      letter,
      tracks: panelTracks,
    }),
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    void getTracks(controller.signal)
      .then((catalogueTracks) => {
        setTracks(catalogueTracks)
        const generatedPanels = generatePanels(
          catalogueTracks,
          PANEL_LETTERS.length,
          SONG_NUMBERS.length,
          random,
        )
        setPanels(
          generatedPanels.map((panelTracks, index) =>
            createPanel(PANEL_LETTERS[index], panelTracks),
          ),
        )
        setError(null)
      })
      .catch((requestError) => {
        if (!(
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        )) {
          setError(catalogueRequestError(requestError))
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [createPanel, random])

  useEffect(
    () => () => {
      if (selectionTimer.current !== null)
        window.clearTimeout(selectionTimer.current)
      if (transitionTimer.current !== null)
        window.clearTimeout(transitionTimer.current)
      if (transitionStartTimer.current !== null)
        window.clearTimeout(transitionStartTimer.current)
    },
    [],
  )

  const resetIncompleteSelection = useCallback(() => {
    setSelectedLetter(null)
    setSelectedNumber(null)
    setConfirmedCode(null)
  }, [])

  const finishTransition = useCallback(() => {
    setPanels((current) => current.slice(1))
    setSliding(false)
    setTransitioning(false)
    transitionLocked.current = false
    transitionTimer.current = null
    setStatusMessage('New selections ready.')
  }, [])

  const advancePanels = useCallback(() => {
    if (
      transitionLocked.current ||
      selectionLocked.current ||
      queue.mutating !== null ||
      tracks.length === 0
    )
      return

    transitionLocked.current = true
    resetIncompleteSelection()
    const outgoing = panels[0]
    if (!outgoing) {
      transitionLocked.current = false
      return
    }
    const previousTrackId = panels.at(-1)?.tracks.at(-1)?.id
    const incoming = createPanel(
      outgoing.letter,
      generateReplacementPanel(
        tracks,
        outgoing.tracks,
        SONG_NUMBERS.length,
        random,
        previousTrackId,
      ),
    )
    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    if (reduceMotion || transitionDurationMs === 0) {
      setPanels((current) => [...current.slice(1), incoming])
      transitionLocked.current = false
      setStatusMessage('New selections ready.')
      return
    }

    setPanels((current) => [...current, incoming])
    setTransitioning(true)
    transitionStartTimer.current = window.setTimeout(() => {
      setSliding(true)
      transitionStartTimer.current = null
      transitionTimer.current = window.setTimeout(
        finishTransition,
        transitionDurationMs,
      )
    }, 16)
  }, [
    createPanel,
    finishTransition,
    panels,
    queue.mutating,
    random,
    resetIncompleteSelection,
    tracks,
    transitionDurationMs,
  ])

  const selectNumber = async (number: number) => {
    if (!selectedLetter) {
      setStatusMessage('Choose a letter first.')
      return
    }
    if (selectionLocked.current || queue.mutating !== null) return

    const selectedPanel = panels.find(
      (panel) => panel.letter === selectedLetter,
    )
    const track = selectedPanel?.tracks[number - 1]
    if (!track) {
      setStatusMessage(
        'That selection is no longer available. Try another code.',
      )
      return
    }

    selectionLocked.current = true
    setSubmitting(true)
    setSelectedNumber(number)
    const code = `${selectedLetter}${number}`
    const success = queue.snapshot?.current
      ? Boolean(await queue.addTrack(track.id))
      : await player.playNow(track)

    if (!success) {
      selectionLocked.current = false
      setSubmitting(false)
      setSelectedNumber(null)
      setStatusMessage('That selection could not be added. Please try again.')
      return
    }

    setConfirmedCode(code)
    setStatusMessage(`${code} added`)
    selectionTimer.current = window.setTimeout(() => {
      resetIncompleteSelection()
      selectionLocked.current = false
      setSubmitting(false)
      selectionTimer.current = null
    }, selectionResetMs)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerStart.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      triggered: false,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    if (!start || start.id !== event.pointerId || start.triggered) return
    const horizontal = event.clientX - start.x
    const vertical = event.clientY - start.y
    if (
      horizontal <= -SWIPE_THRESHOLD &&
      Math.abs(horizontal) > Math.abs(vertical) * 1.2
    ) {
      start.triggered = true
      advancePanels()
    }
  }

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStart.current?.id === event.pointerId)
      pointerStart.current = null
  }

  const stopAndClear = async () => {
    const success = await player.stopAndClear()
    if (!success) {
      setStatusMessage(
        'Playback could not be stopped. The confirmed queue is unchanged.',
      )
      return
    }
    setConfirmStop(false)
    resetIncompleteSelection()
    setStatusMessage('Playback stopped and queue cleared.')
  }

  if (loading) {
    return (
      <div className="screen jukebox-screen">
        <ScreenState
          title="Loading jukebox selections"
          message="Mixing songs from your local catalogue."
          kind="loading"
        />
      </div>
    )
  }

  if (error || catalogueError) {
    return (
      <div className="screen jukebox-screen">
        <ScreenState
          title="Jukebox unavailable"
          message={
            error ?? catalogueError ?? 'The local catalogue is unavailable.'
          }
          kind="error"
          actionLabel="Open Library"
          onAction={onOpenLibrary}
        />
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="screen jukebox-screen">
        <ScreenState
          title={
            scanStatus?.configured
              ? 'No songs are catalogued'
              : 'Choose a music folder'
          }
          message="Open Library to configure or rescan your local music collection."
          actionLabel="Open Library"
          onAction={onOpenLibrary}
        />
      </div>
    )
  }

  const controlsDisabled =
    queue.loading || queue.mutating !== null || submitting || transitioning
  const currentSelection = `${selectedLetter ?? '\u2014'}${selectedNumber ?? '\u2014'}`

  return (
    <div className="screen jukebox-screen">
      <header className="jukebox-heading">
        <div>
          <p className="eyebrow">Classic selector</p>
          <h1 id="page-title">Jukebox</h1>
        </div>
        <div className="jukebox-count" aria-label="Upcoming selections">
          <strong>{queue.snapshot?.upcoming_count ?? 0}</strong>
          <span>upcoming</span>
        </div>
      </header>

      <div
        className="jukebox-panel-viewport"
        aria-label="Song selection panels"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <div
          className={`jukebox-panel-track${sliding ? ' is-sliding' : ''}`}
          style={
            {
              '--jukebox-transition': `${transitionDurationMs}ms`,
            } as CSSProperties
          }
        >
          {panels.map((panel, panelIndex) => {
            const accentClass = `jukebox-accent--${panel.letter.toLowerCase()}`
            return (
              <section
                className={`jukebox-panel ${accentClass}${panelIndex === panels.length - 1 && transitioning ? ' is-incoming' : ''}`}
                aria-label={`Panel ${panel.letter}`}
                data-panel-id={panel.id}
                data-panel-letter={panel.letter}
                key={panel.id}
              >
                <ol>
                  {panel.tracks.map((track, trackIndex) => {
                    const code = `${panel.letter}${trackIndex + 1}`
                    return (
                      <li
                        className={confirmedCode === code ? 'is-confirmed' : ''}
                        data-code={code}
                        key={`${panel.id}-${trackIndex}`}
                        title={`${track.title} \u2014 ${track.artist}`}
                      >
                        <span className="jukebox-song-code">{code}</span>
                        <span className="jukebox-song-copy">
                          <strong>{track.title}</strong>
                          <small>{track.artist}</small>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </section>
            )
          })}
        </div>
      </div>

      <div className="jukebox-controls" aria-label="Jukebox selection controls">
        <div
          className="jukebox-selection-display"
          aria-label="Current selection"
        >
          <span>Selection</span>
          <strong>{currentSelection}</strong>
        </div>
        <div className="jukebox-key-group" aria-label="Panel letters">
          {PANEL_LETTERS.map((letter) => (
            <button
              type="button"
              className={`jukebox-letter-button jukebox-accent--${letter.toLowerCase()}${selectedLetter === letter ? ' is-selected' : ''}`}
              aria-pressed={selectedLetter === letter}
              aria-label={`Select panel ${letter}`}
              disabled={controlsDisabled}
              onClick={() => {
                setSelectedLetter(letter)
                setSelectedNumber(null)
                setStatusMessage(`${letter} selected. Choose a number.`)
              }}
              key={letter}
            >
              {letter}
            </button>
          ))}
        </div>
        <div
          className="jukebox-key-group jukebox-number-keys"
          aria-label="Song numbers"
        >
          {SONG_NUMBERS.map((number) => (
            <button
              type="button"
              className={selectedNumber === number ? 'is-selected' : ''}
              aria-pressed={selectedNumber === number}
              aria-label={`Select song number ${number}`}
              disabled={controlsDisabled}
              onClick={() => void selectNumber(number)}
              key={number}
            >
              {number}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="jukebox-next"
          onClick={advancePanels}
          disabled={controlsDisabled}
        >
          NEXT {'\u203a'}
        </button>
        <button
          type="button"
          className="jukebox-stop"
          onClick={() => setConfirmStop(true)}
          disabled={queue.mutating !== null}
        >
          Stop &amp; Clear
        </button>
      </div>

      <p className="jukebox-status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      {confirmStop ? (
        <div className="jukebox-confirmation">
          <ConfirmationPanel
            title="Stop playback and clear everything?"
            message="This stops the current audio and removes the current and every upcoming queue item. Your catalogue and music files are untouched."
            confirmLabel="Stop & Clear"
            disabled={queue.mutating !== null}
            onCancel={() => setConfirmStop(false)}
            onConfirm={() => void stopAndClear()}
          />
        </div>
      ) : null}
    </div>
  )
}
