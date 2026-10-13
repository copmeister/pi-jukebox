import { useEffect, useState } from 'react'
import {
  applySpeakerCommand,
  loadSpeakerState,
  saveSpeakerState,
  speakerCommand,
  SPEAKER_MIN_VOLUME_STEPS,
  SPEAKER_MAX_VOLUME_STEPS,
  type SpeakerEndpoint,
} from './speakerState'

export const SPEAKER_FEEDBACK_MS = 1800
// Empirical full-range movement: 50 speaker steps in approximately 6.4 seconds.
export const SPEAKER_HOLD_STEP_MS = 128
export const SPEAKER_MIN_RESYNC_MS = 15000

// This observes the remote. It never controls playback, software volume or speakers.
export function useSpeakerStatus() {
  const [state, setState] = useState(loadSpeakerState)
  const [feedback, setFeedback] = useState<{
    syncedEndpoint: SpeakerEndpoint | null
  } | null>(null)

  useEffect(() => {
    let current = loadSpeakerState()
    const pressed = new Set<string>()
    const cancelledKeys = new Set<string>()
    let feedbackTimer: number | undefined
    let holdTimer: number | undefined
    let hold: {
      key: string
      command: 'up' | 'down'
      startedAt: number
      initialVolume: number | null
      synced: boolean
    } | null = null

    const showFeedback = (syncedEndpoint: SpeakerEndpoint | null = null) => {
      window.clearTimeout(feedbackTimer)
      setFeedback({ syncedEndpoint })
      // A held key owns the overlay, even at an endpoint or with unknown volume.
      if (!hold)
        feedbackTimer = window.setTimeout(
          () => setFeedback(null),
          SPEAKER_FEEDBACK_MS,
        )
    }
    const persist = (next: typeof current) => {
      current = next
      saveSpeakerState(next)
      setState(next)
    }
    const updateHold = (allowSync = true) => {
      if (!hold) return
      const elapsed = Math.max(0, performance.now() - hold.startedAt)
      const shouldSync =
        allowSync && hold.command === 'down' && elapsed >= SPEAKER_MIN_RESYNC_MS
      const volumeSteps =
        shouldSync || hold.synced
          ? SPEAKER_MIN_VOLUME_STEPS
          : hold.initialVolume === null
            ? null
            : Math.max(
                SPEAKER_MIN_VOLUME_STEPS,
                Math.min(
                  SPEAKER_MAX_VOLUME_STEPS,
                  hold.initialVolume +
                    (hold.command === 'up' ? 1 : -1) *
                      Math.floor(elapsed / SPEAKER_HOLD_STEP_MS),
                ),
              )
      if (volumeSteps !== current.volumeSteps) {
        persist({ ...current, volumeSteps })
        showFeedback(hold.synced ? 'min' : null)
      }
      if (shouldSync && !hold.synced) {
        hold.synced = true
        showFeedback('min')
      }
    }
    const tick = () => {
      if (!hold) return
      updateHold()
      const elapsed = Math.max(0, performance.now() - hold.startedAt)
      const nextStep =
        (Math.floor(elapsed / SPEAKER_HOLD_STEP_MS) + 1) * SPEAKER_HOLD_STEP_MS
      const nextWake =
        hold.command === 'down' && !hold.synced
          ? Math.min(nextStep, SPEAKER_MIN_RESYNC_MS)
          : nextStep
      // Each callback derives the position from the original monotonic timestamp.
      holdTimer = window.setTimeout(tick, Math.max(1, nextWake - elapsed))
    }
    const finishHold = (released = false) => {
      if (!hold) return
      updateHold(released)
      const syncedEndpoint = hold.synced ? 'min' : null
      const key = hold.key
      window.clearTimeout(holdTimer)
      holdTimer = undefined
      hold = null
      pressed.delete(key)
      if (!released) cancelledKeys.add(key)
      showFeedback(syncedEndpoint)
    }
    const releaseAll = () => {
      finishHold()
      pressed.clear()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const command = speakerCommand(event)
      if (!command) {
        if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey)
          finishHold()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (cancelledKeys.has(event.key)) {
        if (event.repeat) return
        cancelledKeys.delete(event.key)
      }
      if (pressed.has(event.key)) return
      if (command === 'up' || command === 'down') {
        finishHold()
        // Start on the first delivered qualifying keydown, even if the browser
        // missed its initial non-repeat event. Rendering feedback never owns it.
        const next = applySpeakerCommand(current, command)
        hold = {
          key: event.key,
          command,
          startedAt: performance.now(),
          initialVolume: next.volumeSteps,
          synced: false,
        }
        pressed.add(event.key)
        persist(next)
        showFeedback()
        tick()
      } else {
        if (event.repeat) return
        pressed.add(event.key)
        persist(applySpeakerCommand(current, command))
        showFeedback(hold?.synced ? 'min' : null)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Shift') finishHold()
      cancelledKeys.delete(event.key)
      const wasPressed = pressed.has(event.key)
      if (hold?.key === event.key) finishHold(true)
      pressed.delete(event.key)
      if (wasPressed) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const onVisibilityChange = () => {
      if (document.hidden) releaseAll()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      // Unmount discards gesture state; only ordinary speaker state is persisted.
      window.clearTimeout(holdTimer)
      window.clearTimeout(feedbackTimer)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return { state, feedback }
}
