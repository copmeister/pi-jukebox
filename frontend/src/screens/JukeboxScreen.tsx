import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
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
import { useDisplaySize } from '../display/DisplaySizeContext'
import {
  generatePanels,
  generateReplacementPanel,
  type RandomSource,
} from '../jukebox/randomPanels'
import { JukeboxSoundsDialog } from '../jukebox/JukeboxSoundsDialog'
import { type JukeboxSoundController } from '../jukebox/sounds'
import { useQueue } from '../queue/QueueContext'

const STANDARD_PANEL_LETTERS = ['A', 'B', 'C', 'D'] as const
const LARGE_PANEL_LETTERS = ['A', 'B', 'C'] as const
const STANDARD_SONG_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const LARGE_SONG_NUMBERS = [1, 2, 3, 4, 5, 6] as const
const SWIPE_THRESHOLD = 64

type PanelLetter = (typeof STANDARD_PANEL_LETTERS)[number]
type TransitionPhase = 'idle' | 'preparing' | 'sliding' | 'resetting'

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
  soundController?: JukeboxSoundController
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
  soundController,
}: JukeboxScreenProps) {
  const { displaySize } = useDisplaySize()
  const usesLargeLayout = displaySize !== 'standard'
  const panelLetters = usesLargeLayout
    ? LARGE_PANEL_LETTERS
    : STANDARD_PANEL_LETTERS
  const songNumbers = usesLargeLayout
    ? LARGE_SONG_NUMBERS
    : STANDARD_SONG_NUMBERS
  const selectorLayout = usesLargeLayout ? '3x6' : '4x8'
  const queue = useQueue()
  const player = useAudioPlayer()
  const sounds = soundController ?? player.jukeboxSounds
  const soundsRef = useRef(sounds)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [transitionPhase, setTransitionPhase] =
    useState<TransitionPhase>('idle')
  const nextPanelId = useRef(1)
  const transitionPhaseRef = useRef<TransitionPhase>('idle')
  const selectionLocked = useRef(false)
  const transitionLocked = useRef(false)
  const pointerStart = useRef<PointerStart | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    soundsRef.current = sounds
  }, [sounds])
  const selectionTimer = useRef<number | null>(null)
  const transitionFallbackTimer = useRef<number | null>(null)
  const preparationFrame = useRef<number | null>(null)
  const slidingFrame = useRef<number | null>(null)
  const resetFrame = useRef<number | null>(null)

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
          panelLetters.length,
          songNumbers.length,
          random,
        )
        setPanels(
          generatedPanels.map((panelTracks, index) =>
            createPanel(panelLetters[index], panelTracks),
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
  }, [createPanel, panelLetters, random, songNumbers])

  useEffect(
    () => () => {
      if (selectionTimer.current !== null)
        window.clearTimeout(selectionTimer.current)
      if (transitionFallbackTimer.current !== null)
        window.clearTimeout(transitionFallbackTimer.current)
      if (preparationFrame.current !== null)
        window.cancelAnimationFrame(preparationFrame.current)
      if (slidingFrame.current !== null)
        window.cancelAnimationFrame(slidingFrame.current)
      if (resetFrame.current !== null)
        window.cancelAnimationFrame(resetFrame.current)
    },
    [],
  )

  const resetIncompleteSelection = useCallback(() => {
    setSelectedLetter(null)
    setSelectedNumber(null)
    setConfirmedCode(null)
  }, [])

  const finishTransition = useCallback(() => {
    if (transitionPhaseRef.current !== 'sliding') return
    if (transitionFallbackTimer.current !== null) {
      window.clearTimeout(transitionFallbackTimer.current)
      transitionFallbackTimer.current = null
    }

    transitionPhaseRef.current = 'resetting'
    setTransitionPhase('resetting')
    setPanels((current) => current.slice(1))
  }, [])

  useEffect(() => {
    if (transitionPhase !== 'resetting') return

    // Effects run after React has committed and painted the transition-free
    // coordinate reset. Re-enable motion on the following animation frame.
    resetFrame.current = window.requestAnimationFrame(() => {
      resetFrame.current = null
      transitionPhaseRef.current = 'idle'
      setTransitionPhase('idle')
      transitionLocked.current = false
      setStatusMessage('New selections ready.')
    })

    return () => {
      if (resetFrame.current !== null) {
        window.cancelAnimationFrame(resetFrame.current)
        resetFrame.current = null
      }
    }
  }, [transitionPhase])

  useEffect(() => {
    if (transitionPhase !== 'preparing') return

    preparationFrame.current = window.requestAnimationFrame(() => {
      preparationFrame.current = null
      slidingFrame.current = window.requestAnimationFrame(() => {
        slidingFrame.current = null
        if (transitionPhaseRef.current !== 'preparing') return
        soundsRef.current.playMovement(transitionDurationMs)
        transitionPhaseRef.current = 'sliding'
        setTransitionPhase('sliding')
        transitionFallbackTimer.current = window.setTimeout(
          finishTransition,
          transitionDurationMs + 120,
        )
      })
    })

    return () => {
      if (preparationFrame.current !== null) {
        window.cancelAnimationFrame(preparationFrame.current)
        preparationFrame.current = null
      }
      if (slidingFrame.current !== null) {
        window.cancelAnimationFrame(slidingFrame.current)
        slidingFrame.current = null
      }
    }
  }, [finishTransition, transitionDurationMs, transitionPhase])

  const advancePanels = useCallback(() => {
    if (
      transitionLocked.current ||
      selectionLocked.current ||
      queue.mutating !== null ||
      settingsOpen ||
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
        songNumbers.length,
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
    transitionPhaseRef.current = 'preparing'
    setTransitionPhase('preparing')
  }, [
    createPanel,
    panels,
    queue.mutating,
    random,
    resetIncompleteSelection,
    settingsOpen,
    songNumbers,
    tracks,
    transitionDurationMs,
  ])

  const onTrackTransitionEnd = (
    event: ReactTransitionEvent<HTMLDivElement>,
  ) => {
    if (
      event.target === event.currentTarget &&
      event.propertyName === 'transform' &&
      transitionPhaseRef.current === 'sliding'
    ) {
      finishTransition()
    }
  }

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
    const alreadyPlaying = Boolean(queue.snapshot?.current)
    const success = alreadyPlaying
      ? Boolean(await queue.addTrack(track.id))
      : await player.playJukebox(track, code)

    if (!success) {
      selectionLocked.current = false
      setSubmitting(false)
      setSelectedNumber(null)
      setStatusMessage('That selection could not be added. Please try again.')
      return
    }

    if (alreadyPlaying) player.acceptQueuedJukeboxSelection()
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

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus())
  }, [])

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
    queue.loading ||
    queue.mutating !== null ||
    submitting ||
    transitionPhase !== 'idle' ||
    settingsOpen
  const currentSelection = `${selectedLetter ?? '\u2014'}${selectedNumber ?? '\u2014'}`

  return (
    <div
      className="screen jukebox-screen"
      data-selector-layout={selectorLayout}
    >
      <header className="jukebox-heading">
        <div>
          <p className="eyebrow">Classic selector</p>
          <h1 id="page-title">Jukebox</h1>
        </div>
        <div className="jukebox-heading-actions">
          <div className="jukebox-count" aria-label="Upcoming selections">
            <strong>{queue.snapshot?.upcoming_count ?? 0}</strong>
            <span>upcoming</span>
          </div>
          <button
            type="button"
            className="jukebox-sounds-button"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
            ref={settingsButtonRef}
          >
            Sounds
          </button>
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
          className={`jukebox-panel-track is-${transitionPhase}`}
          data-transition-phase={transitionPhase}
          onTransitionEnd={onTrackTransitionEnd}
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
                className={`jukebox-panel ${accentClass}${panelIndex === panels.length - 1 && (transitionPhase === 'preparing' || transitionPhase === 'sliding') ? ' is-incoming' : ''}`}
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
          {panelLetters.map((letter) => (
            <button
              type="button"
              className={`jukebox-letter-button jukebox-accent--${letter.toLowerCase()}${selectedLetter === letter ? ' is-selected' : ''}`}
              aria-pressed={selectedLetter === letter}
              aria-label={`Select panel ${letter}`}
              disabled={controlsDisabled}
              onClick={() => {
                soundsRef.current.playButton()
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
          {songNumbers.map((number) => (
            <button
              type="button"
              className={selectedNumber === number ? 'is-selected' : ''}
              aria-pressed={selectedNumber === number}
              aria-label={`Select song number ${number}`}
              disabled={controlsDisabled}
              onClick={() => {
                soundsRef.current.playButton()
                void selectNumber(number)
              }}
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
          disabled={queue.mutating !== null || settingsOpen}
        >
          Stop &amp; Clear
        </button>
      </div>

      <p className="jukebox-status" role="status" aria-live="polite">
        {player.presentationMessage ?? statusMessage}
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

      {settingsOpen ? (
        <JukeboxSoundsDialog sounds={sounds} onClose={closeSettings} />
      ) : null}
    </div>
  )
}
