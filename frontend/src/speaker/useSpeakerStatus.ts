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
// Allow margin above the slowest manually timed full-range hold (~6.9 seconds).
export const SPEAKER_MIN_RESYNC_MS = 8000
export const SPEAKER_MAX_RESYNC_MS = 8000

// This observes the remote. It never controls playback, software volume or speakers.
export function useSpeakerStatus() {
  const [state, setState] = useState(loadSpeakerState)
  const [feedback, setFeedback] = useState<{
    syncedEndpoint: SpeakerEndpoint | null
  } | null>(null)

  useEffect(() => {
    let current = loadSpeakerState()
    const pressed = new Set<string>()
    let feedbackTimer: number | undefined
    let resyncTimer: number | undefined
    let holdCommand: 'up' | 'down' | null = null
    let holdSynced: SpeakerEndpoint | null = null

    const showFeedback = (syncedEndpoint: SpeakerEndpoint | null = null) => {
      window.clearTimeout(feedbackTimer)
      setFeedback({ syncedEndpoint })
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
    const cancelResync = () => {
      window.clearTimeout(resyncTimer)
      resyncTimer = undefined
      holdCommand = null
      holdSynced = null
    }
    const releaseAll = () => {
      pressed.clear()
      cancelResync()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const command = speakerCommand(event)
      if (!command) {
        if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey)
          cancelResync()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const alreadyPressed = pressed.has(event.key)
      // Orphan repeats can invalidate tracking, but cannot start a resync hold.
      if (event.repeat && !alreadyPressed) {
        if (command === 'up' || command === 'down') {
          cancelResync()
          persist({ ...current, volumeSteps: null })
          showFeedback()
        }
        return
      }
      if (
        alreadyPressed &&
        (!event.repeat || (command !== 'up' && command !== 'down'))
      )
        return
      pressed.add(event.key)
      if ((command === 'up' || command === 'down') && command !== holdCommand) {
        cancelResync()
        if (!alreadyPressed) {
          holdCommand = command
          const endpoint = command === 'down' ? 'min' : 'max'
          const volumeSteps =
            command === 'down'
              ? SPEAKER_MIN_VOLUME_STEPS
              : SPEAKER_MAX_VOLUME_STEPS
          const duration =
            command === 'down' ? SPEAKER_MIN_RESYNC_MS : SPEAKER_MAX_RESYNC_MS
          resyncTimer = window.setTimeout(() => {
            resyncTimer = undefined
            holdSynced = endpoint
            persist({ ...current, volumeSteps })
            showFeedback(endpoint)
          }, duration)
        }
      }
      // Host repeat frequency does not tell us how many amplifier steps occurred.
      // Further repeats in the same calibrated hold retain its endpoint.
      persist(
        event.repeat
          ? {
              ...current,
              volumeSteps:
                holdSynced === 'min'
                  ? SPEAKER_MIN_VOLUME_STEPS
                  : holdSynced === 'max'
                    ? SPEAKER_MAX_VOLUME_STEPS
                    : null,
            }
          : applySpeakerCommand(current, command),
      )
      showFeedback(command === 'up' || command === 'down' ? holdSynced : null)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Shift') cancelResync()
      if (!pressed.delete(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (
        (event.key === 'F4' && holdCommand === 'down') ||
        (event.key === 'F3' && holdCommand === 'up')
      )
        cancelResync()
    }
    const onVisibilityChange = () => {
      if (document.hidden) releaseAll()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      releaseAll()
      window.clearTimeout(feedbackTimer)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return { state, feedback }
}
