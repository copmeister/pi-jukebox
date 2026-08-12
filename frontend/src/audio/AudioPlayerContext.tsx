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
import { useQueue } from '../queue/QueueContext'

/* Context and provider intentionally share this module so consumers have one audio API. */
/* eslint-disable react-refresh/only-export-components */

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

interface AudioPlayerValue {
  currentTrack: PlayerTrack | null
  status: PlaybackStatus
  error: string | null
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  canGoPrevious: boolean
  canGoNext: boolean
  playNow: (track: Track) => Promise<boolean>
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

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const queue = useQueue()
  const audioRef = useRef<HTMLAudioElement>(null)
  const currentItemRef = useRef<QueueItem | null>(null)
  const historyRef = useRef<number[]>([])
  const advancingRef = useRef(false)
  const pendingAdvanceRef = useRef<boolean | null>(null)
  const restoringRef = useRef(false)
  const [currentTrack, setCurrentTrack] = useState<PlayerTrack | null>(null)
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)

  const stopAudio = useCallback(() => {
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
  }, [])

  const startItem = useCallback((item: QueueItem, rememberCurrent = true) => {
    const audio = audioRef.current
    if (!audio) return
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
    setStatus('loading')
    setError(null)
    audio.src = mediaUrl(item.track_id)
    audio.currentTime = 0
    audio.load()
    void audio.play().catch((playError: unknown) => {
      setStatus('error')
      setError(playbackError(playError))
    })
  }, [])

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
        startItem(snapshot.current)
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
    [queue, startItem, stopAudio],
  )

  const advanceCurrent = useCallback(
    async (failed = false) => {
      const current = currentItemRef.current
      if (!current || advancingRef.current) return
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
    if (!restored.available) {
      currentItemRef.current = restored
      void advanceCurrent(true)
      return
    }
    restoreItem(restored)
  }, [advanceCurrent, queue.loading, queue.snapshot, restoreItem, stopAudio])

  useEffect(() => {
    if (queue.mutating || pendingAdvanceRef.current === null) return
    const failed = pendingAdvanceRef.current
    pendingAdvanceRef.current = null
    void advanceCurrent(failed)
  }, [advanceCurrent, queue.mutating])

  const playNow = useCallback(
    async (track: Track) => {
      const snapshot = await queue.playNow(track.id)
      if (!snapshot?.current) return false
      startItem(snapshot.current)
      return true
    },
    [queue, startItem],
  )

  const playAlbum = useCallback(
    async (albumId: number) => {
      const snapshot = await queue.playAlbum(albumId)
      historyRef.current = []
      setHistoryCount(0)
      if (!snapshot?.current) return false
      startItem(snapshot.current, false)
      return true
    },
    [queue, startItem],
  )

  const stopAndClear = useCallback(async () => {
    const snapshot = await queue.stopAndClear()
    if (!snapshot || snapshot.current || snapshot.upcoming.length) return false
    historyRef.current = []
    setHistoryCount(0)
    stopAudio()
    return true
  }, [queue, stopAudio])

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !currentItemRef.current) return
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
  }, [])

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
    void queue.playNow(previousTrackId).then((snapshot) => {
      if (snapshot?.current) startItem(snapshot.current, false)
    })
  }, [queue, startItem])

  const next = useCallback(() => {
    void advanceCurrent(false)
  }, [advanceCurrent])

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
      canGoPrevious: historyCount > 0 || currentTime > 3,
      canGoNext: Boolean(queue.snapshot?.upcoming.length),
      playNow,
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
      muted,
      next,
      playAlbum,
      playNow,
      previous,
      queue.snapshot?.upcoming.length,
      seek,
      setVolume,
      status,
      stopAndClear,
      toggleMute,
      togglePlayback,
      volume,
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
          if (currentItemRef.current && !restoringRef.current) {
            setStatus((currentStatus) =>
              currentStatus === 'error' ? currentStatus : 'paused',
            )
          }
        }}
        onWaiting={() => {
          if (!restoringRef.current) setStatus('loading')
        }}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
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
