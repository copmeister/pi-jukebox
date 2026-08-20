import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { mediaUrl } from '../api/client'
import type { PlayerTrack, QueueItem, Track } from '../api/types'
import { useOptionalBluetooth } from '../bluetooth/BluetoothContext'
import {
  type JukeboxSoundController,
  useJukeboxSounds,
} from '../jukebox/sounds'
import { useQueue } from '../queue/QueueContext'

/* Context and provider intentionally share this module so consumers have one audio API. */
/* eslint-disable react-refresh/only-export-components */

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type PlaybackPresentation = 'modern' | 'jukebox'

export const JUKEBOX_LOADING_DELAY_MS = 900

interface AudioPlayerValue {
  currentTrack: PlayerTrack | null
  status: PlaybackStatus
  error: string | null
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  presentation: PlaybackPresentation
  presentationMessage: string | null
  jukeboxSounds: JukeboxSoundController
  canGoPrevious: boolean
  canGoNext: boolean
  playNow: (track: Track) => Promise<boolean>
  playJukebox: (track: Track, code: string) => Promise<boolean>
  acceptQueuedJukeboxSelection: () => void
  playAlbum: (albumId: number) => Promise<boolean>
  stopAndClear: () => Promise<boolean>
  togglePlayback: () => void
  previous: () => void
  next: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
}

const AudioPlayerContext = createContext<AudioPlayerValue | null>(null)

function safeDuration(audio: HTMLAudioElement): number {
  return Number.isFinite(audio.duration) ? audio.duration : 0
}

function playbackError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Playback needs a tap. Choose Play to let the browser start audio.'
  }
  return 'This track could not be played. It will be skipped if another item is queued.'
}

function queueItemTrack(item: QueueItem): PlayerTrack {
  return {
    id: item.track_id,
    album_id: item.album_id,
    title: item.title,
    artist: item.artist,
    album: item.album,
    duration_seconds: item.duration_seconds,
    artwork_id: item.artwork_id,
  }
}

interface PendingJukeboxStart {
  itemId: number
  timer: number
  cancelSound: () => void
}

interface AudioPlayerProviderProps {
  children: ReactNode
  soundController?: JukeboxSoundController
  jukeboxLoadingDelayMs?: number
  sleeping?: boolean
}

export function AudioPlayerProvider({
  children,
  soundController,
  jukeboxLoadingDelayMs = JUKEBOX_LOADING_DELAY_MS,
  sleeping = false,
}: AudioPlayerProviderProps) {
  const queue = useQueue()
  const bluetooth = useOptionalBluetooth()
  const builtInSounds = useJukeboxSounds()
  const jukeboxSounds = soundController ?? builtInSounds
  const soundsRef = useRef(jukeboxSounds)
  const audioRef = useRef<HTMLAudioElement>(null)
  const currentItemRef = useRef<QueueItem | null>(null)
  const historyRef = useRef<number[]>([])
  const advancingRef = useRef(false)
  const pendingAdvanceRef = useRef<boolean | null>(null)
  const restoringRef = useRef(false)
  const presentationRef = useRef<PlaybackPresentation>('modern')
  const pendingJukeboxStartRef = useRef<PendingJukeboxStart | null>(null)
  const [currentTrack, setCurrentTrack] = useState<PlayerTrack | null>(null)
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const [presentation, setPresentation] =
    useState<PlaybackPresentation>('modern')
  const [presentationMessage, setPresentationMessage] = useState<string | null>(
    null,
  )

  useEffect(() => {
    soundsRef.current = jukeboxSounds
  }, [jukeboxSounds])

  useEffect(() => {
    if (!sleeping && audioRef.current)
      setCurrentTime(audioRef.current.currentTime)
  }, [sleeping])

  const cancelPendingJukeboxStart = useCallback(() => {
    const pending = pendingJukeboxStartRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pending.cancelSound()
      pendingJukeboxStartRef.current = null
    }
    setPresentationMessage(null)
  }, [])

  useEffect(() => {
    if (!bluetooth) return
    bluetooth.registerLocalPause(() => {
      cancelPendingJukeboxStart()
      audioRef.current?.pause()
      if (currentItemRef.current) setStatus('paused')
    })
    return () => bluetooth.registerLocalPause(null)
  }, [bluetooth, cancelPendingJukeboxStart])

  const setPresentationMode = useCallback((mode: PlaybackPresentation) => {
    presentationRef.current = mode
    setPresentation(mode)
  }, [])

  const stopAudio = useCallback(() => {
    cancelPendingJukeboxStart()
    const audio = audioRef.current
    currentItemRef.current = null
    restoringRef.current = false
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setCurrentTrack(null)
    setCurrentTime(0)
    setDuration(0)
    setStatus('idle')
    setPresentationMode('modern')
  }, [cancelPendingJukeboxStart, setPresentationMode])

  const setCurrentItem = useCallback(
    (item: QueueItem, rememberCurrent = true) => {
      const previous = currentItemRef.current
      if (rememberCurrent && previous && previous.id !== item.id) {
        historyRef.current.push(previous.track_id)
        setHistoryCount(historyRef.current.length)
      }
      currentItemRef.current = item
      restoringRef.current = false
      setCurrentTrack(queueItemTrack(item))
      setCurrentTime(0)
      setDuration(item.duration_seconds ?? 0)
      setError(null)
    },
    [],
  )

  const startItem = useCallback(
    (item: QueueItem, rememberCurrent = true) => {
      const audio = audioRef.current
      if (!audio) return
      cancelPendingJukeboxStart()
      setCurrentItem(item, rememberCurrent)
      setStatus('loading')
      audio.src = mediaUrl(item.track_id)
      audio.currentTime = 0
      audio.load()
      void audio.play().catch((playError: unknown) => {
        setStatus('error')
        setError(playbackError(playError))
      })
    },
    [cancelPendingJukeboxStart, setCurrentItem],
  )

  const shouldUseJukeboxPause = useCallback(() => {
    const settings = soundsRef.current.settings
    return settings.enabled && settings.loadingPause
  }, [])

  const prepareJukeboxItem = useCallback(
    (item: QueueItem, message: string, rememberCurrent = true) => {
      const audio = audioRef.current
      if (!audio) return
      audio.pause()
      cancelPendingJukeboxStart()
      setCurrentItem(item, rememberCurrent)
      setStatus('loading')
      setPresentationMessage(message)

      const cancelSound = soundsRef.current.playLoading(jukeboxLoadingDelayMs)
      const timer = window.setTimeout(() => {
        const pending = pendingJukeboxStartRef.current
        if (
          !pending ||
          pending.itemId !== item.id ||
          currentItemRef.current?.id !== item.id
        )
          return
        pending.cancelSound()
        pendingJukeboxStartRef.current = null
        setPresentationMessage(null)
        setStatus('loading')
        audio.src = mediaUrl(item.track_id)
        audio.currentTime = 0
        setCurrentTime(0)
        audio.load()
        void audio.play().catch((playError: unknown) => {
          setStatus('error')
          setError(playbackError(playError))
        })
      }, jukeboxLoadingDelayMs)
      pendingJukeboxStartRef.current = { itemId: item.id, timer, cancelSound }
    },
    [cancelPendingJukeboxStart, jukeboxLoadingDelayMs, setCurrentItem],
  )

  const restoreItem = useCallback((item: QueueItem) => {
    const audio = audioRef.current
    if (!audio) return
    currentItemRef.current = item
    restoringRef.current = true
    audio.pause()
    audio.src = mediaUrl(item.track_id)
    audio.currentTime = 0
    audio.load()
    setCurrentTrack(queueItemTrack(item))
    setCurrentTime(0)
    setDuration(item.duration_seconds ?? 0)
    setStatus('paused')
    setError(null)
  }, [])

  const finishAdvance = useCallback(
    (snapshot: Awaited<ReturnType<typeof queue.advance>>, failed: boolean) => {
      if (snapshot?.current) {
        if (presentationRef.current === 'jukebox' && shouldUseJukeboxPause()) {
          prepareJukeboxItem(snapshot.current, 'Changing record…')
        } else {
          startItem(snapshot.current)
        }
        if (failed)
          queue.notify(
            'Skipped an unavailable track and continued with the queue.',
          )
      } else if (snapshot) {
        stopAudio()
        queue.notify(
          failed
            ? 'The unavailable track was skipped. Nothing else is queued.'
            : 'Queue finished.',
        )
      }
    },
    [prepareJukeboxItem, queue, shouldUseJukeboxPause, startItem, stopAudio],
  )

  const advanceCurrent = useCallback(
    async (failed = false) => {
      const current = currentItemRef.current
      if (!current || advancingRef.current || pendingJukeboxStartRef.current)
        return
      advancingRef.current = true
      if (failed) queue.notify('Skipping a track that could not be played.')
      const snapshot = await queue.advance(current.id)
      advancingRef.current = false
      if (!snapshot && queue.mutating) pendingAdvanceRef.current = failed
      finishAdvance(snapshot, failed)
    },
    [finishAdvance, queue],
  )

  useEffect(() => {
    if (queue.loading) return
    const restored = queue.snapshot?.current ?? null
    if (!restored) {
      if (currentItemRef.current) stopAudio()
      return
    }
    if (currentItemRef.current?.id === restored.id) return
    cancelPendingJukeboxStart()
    setPresentationMode('modern')
    if (!restored.available) {
      currentItemRef.current = restored
      void advanceCurrent(true)
      return
    }
    restoreItem(restored)
  }, [
    advanceCurrent,
    cancelPendingJukeboxStart,
    queue.loading,
    queue.snapshot,
    restoreItem,
    setPresentationMode,
    stopAudio,
  ])

  useEffect(() => {
    if (queue.mutating || pendingAdvanceRef.current === null) return
    const failed = pendingAdvanceRef.current
    pendingAdvanceRef.current = null
    void advanceCurrent(failed)
  }, [advanceCurrent, queue.mutating])

  useEffect(() => {
    if (
      !pendingJukeboxStartRef.current ||
      (jukeboxSounds.settings.enabled && jukeboxSounds.settings.loadingPause)
    )
      return
    const item = currentItemRef.current
    cancelPendingJukeboxStart()
    if (item) startItem(item, false)
  }, [
    cancelPendingJukeboxStart,
    jukeboxSounds.settings.enabled,
    jukeboxSounds.settings.loadingPause,
    startItem,
  ])

  useEffect(
    () => () => {
      const pending = pendingJukeboxStartRef.current
      if (!pending) return
      window.clearTimeout(pending.timer)
      pending.cancelSound()
      pendingJukeboxStartRef.current = null
    },
    [],
  )

  const playNow = useCallback(
    async (track: Track) => {
      if (bluetooth && !(await bluetooth.prepareLocalPlayback())) return false
      cancelPendingJukeboxStart()
      setPresentationMode('modern')
      const snapshot = await queue.playNow(track.id)
      if (!snapshot?.current) return false
      startItem(snapshot.current)
      return true
    },
    [
      bluetooth,
      cancelPendingJukeboxStart,
      queue,
      setPresentationMode,
      startItem,
    ],
  )

  const playJukebox = useCallback(
    async (track: Track, code: string) => {
      if (bluetooth && !(await bluetooth.prepareLocalPlayback())) return false
      cancelPendingJukeboxStart()
      const snapshot = await queue.playNow(track.id)
      if (!snapshot?.current) return false
      setPresentationMode('jukebox')
      if (soundsRef.current.settings.enabled)
        soundsRef.current.playConfirmation()
      if (shouldUseJukeboxPause()) {
        prepareJukeboxItem(snapshot.current, `Loading ${code}…`)
      } else {
        startItem(snapshot.current)
      }
      return true
    },
    [
      cancelPendingJukeboxStart,
      bluetooth,
      prepareJukeboxItem,
      queue,
      setPresentationMode,
      startItem,
      shouldUseJukeboxPause,
    ],
  )

  const acceptQueuedJukeboxSelection = useCallback(() => {
    setPresentationMode('jukebox')
    if (soundsRef.current.settings.enabled) soundsRef.current.playConfirmation()
  }, [setPresentationMode])

  const playAlbum = useCallback(
    async (albumId: number) => {
      if (bluetooth && !(await bluetooth.prepareLocalPlayback())) return false
      cancelPendingJukeboxStart()
      setPresentationMode('modern')
      const snapshot = await queue.playAlbum(albumId)
      historyRef.current = []
      setHistoryCount(0)
      if (!snapshot?.current) return false
      startItem(snapshot.current, false)
      return true
    },
    [
      bluetooth,
      cancelPendingJukeboxStart,
      queue,
      setPresentationMode,
      startItem,
    ],
  )

  const stopAndClear = useCallback(async () => {
    cancelPendingJukeboxStart()
    const snapshot = await queue.stopAndClear()
    if (!snapshot || snapshot.current || snapshot.upcoming.length) return false
    historyRef.current = []
    setHistoryCount(0)
    stopAudio()
    return true
  }, [cancelPendingJukeboxStart, queue, stopAudio])

  const toggleLocalPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !currentItemRef.current) return
    const pendingItem = pendingJukeboxStartRef.current
    if (pendingItem) {
      const item = currentItemRef.current
      cancelPendingJukeboxStart()
      startItem(item, false)
      return
    }
    setError(null)
    const restartingRestoredTrack = restoringRef.current
    restoringRef.current = false
    if (audio.paused) {
      if (restartingRestoredTrack) audio.currentTime = 0
      setCurrentTime(audio.currentTime)
      setStatus('loading')
      void audio.play().catch((playError: unknown) => {
        setStatus('error')
        setError(playbackError(playError))
      })
    } else {
      audio.pause()
    }
  }, [cancelPendingJukeboxStart, startItem])

  const togglePlayback = useCallback(() => {
    if (bluetooth?.status.mode_active) {
      void bluetooth.prepareLocalPlayback().then((ready) => {
        if (ready) toggleLocalPlayback()
      })
      return
    }
    toggleLocalPlayback()
  }, [bluetooth, toggleLocalPlayback])

  const previous = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }
    const previousTrackId = historyRef.current.pop()
    setHistoryCount(historyRef.current.length)
    if (!previousTrackId) return
    cancelPendingJukeboxStart()
    void queue.playNow(previousTrackId).then((snapshot) => {
      if (!snapshot?.current) return
      if (presentationRef.current === 'jukebox' && shouldUseJukeboxPause()) {
        prepareJukeboxItem(snapshot.current, 'Changing record…', false)
      } else {
        startItem(snapshot.current, false)
      }
    })
  }, [
    cancelPendingJukeboxStart,
    prepareJukeboxItem,
    queue,
    startItem,
    shouldUseJukeboxPause,
  ])

  const next = useCallback(() => {
    cancelPendingJukeboxStart()
    void advanceCurrent(false)
  }, [advanceCurrent, cancelPendingJukeboxStart])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(time)) return
    const nextTime = Math.max(0, Math.min(time, safeDuration(audio) || time))
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const setVolume = useCallback((nextVolume: number) => {
    const audio = audioRef.current
    if (!audio) return
    const safeVolume = Math.max(0, Math.min(1, nextVolume))
    audio.volume = safeVolume
    audio.muted = false
    setVolumeState(safeVolume)
    setMuted(false)
  }, [])

  const toggleMute = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = !audio.muted
    setMuted(audio.muted)
  }, [])

  const value = useMemo<AudioPlayerValue>(
    () => ({
      currentTrack,
      status,
      error,
      currentTime,
      duration,
      volume,
      muted,
      presentation,
      presentationMessage,
      jukeboxSounds,
      canGoPrevious: historyCount > 0 || currentTime > 3,
      canGoNext: Boolean(queue.snapshot?.upcoming.length),
      playNow,
      playJukebox,
      acceptQueuedJukeboxSelection,
      playAlbum,
      stopAndClear,
      togglePlayback,
      previous,
      next,
      seek,
      setVolume,
      toggleMute,
    }),
    [
      currentTime,
      currentTrack,
      duration,
      error,
      historyCount,
      jukeboxSounds,
      muted,
      next,
      playAlbum,
      playJukebox,
      playNow,
      presentation,
      presentationMessage,
      previous,
      queue.snapshot?.upcoming.length,
      seek,
      setVolume,
      status,
      stopAndClear,
      toggleMute,
      togglePlayback,
      volume,
      acceptQueuedJukeboxSelection,
    ],
  )

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="anonymous"
        onLoadStart={() =>
          setStatus(restoringRef.current ? 'paused' : 'loading')
        }
        onPlaying={() => {
          restoringRef.current = false
          setStatus('playing')
          setError(null)
        }}
        onPause={() => {
          if (pendingJukeboxStartRef.current) {
            setStatus('loading')
            return
          }
          if (currentItemRef.current && !restoringRef.current) {
            setStatus((currentStatus) =>
              currentStatus === 'error' ? currentStatus : 'paused',
            )
          }
        }}
        onWaiting={() => {
          if (!restoringRef.current) setStatus('loading')
        }}
        onTimeUpdate={(event) => {
          if (!sleeping) setCurrentTime(event.currentTarget.currentTime)
        }}
        onDurationChange={(event) =>
          setDuration(safeDuration(event.currentTarget))
        }
        onLoadedMetadata={(event) =>
          setDuration(safeDuration(event.currentTarget))
        }
        onVolumeChange={(event) => {
          setVolumeState(event.currentTarget.volume)
          setMuted(event.currentTarget.muted)
        }}
        onEnded={() => void advanceCurrent(false)}
        onError={() => {
          if (!currentItemRef.current) return
          setStatus('error')
          setError(
            'This track could not be played. It will be skipped if another item is queued.',
          )
          void advanceCurrent(true)
        }}
      />
    </AudioPlayerContext.Provider>
  )
}

export function useAudioPlayer(): AudioPlayerValue {
  const value = useContext(AudioPlayerContext)
  if (!value)
    throw new Error('useAudioPlayer must be used inside AudioPlayerProvider')
  return value
}
