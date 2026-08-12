import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getAlbum, mediaUrl } from '../api/client'
import type { Track } from '../api/types'

/* Context and provider intentionally share this module so consumers have one audio API. */
/* eslint-disable react-refresh/only-export-components */

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

interface AudioPlayerValue {
  currentTrack: Track | null
  status: PlaybackStatus
  error: string | null
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  canGoPrevious: boolean
  canGoNext: boolean
  playTrack: (track: Track, albumTracks?: Track[]) => void
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
  return 'This track could not be played. The file may be missing or unsupported.'
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const contextTracksRef = useRef<Track[]>([])
  const currentTrackRef = useRef<Track | null>(null)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [contextTracks, setContextTracks] = useState<Track[]>([])
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)

  const startAudio = useCallback((track: Track) => {
    const audio = audioRef.current
    if (!audio) return
    currentTrackRef.current = track
    setCurrentTrack(track)
    setCurrentTime(0)
    setDuration(track.duration_seconds ?? 0)
    setStatus('loading')
    setError(null)
    audio.src = mediaUrl(track.id)
    audio.currentTime = 0
    audio.load()
    void audio.play().catch((playError: unknown) => {
      setStatus('error')
      setError(playbackError(playError))
    })
  }, [])

  const playTrack = useCallback(
    (track: Track, albumTracks?: Track[]) => {
      const nextContext = albumTracks?.length ? albumTracks : [track]
      contextTracksRef.current = nextContext
      setContextTracks(nextContext)
      startAudio(track)
      if (!albumTracks) {
        void getAlbum(track.album_id)
          .then((album) => {
            if (currentTrackRef.current?.id === track.id) {
              contextTracksRef.current = album.tracks
              setContextTracks(album.tracks)
            }
          })
          .catch(() => undefined)
      }
    },
    [startAudio],
  )

  const currentIndex = currentTrack
    ? contextTracks.findIndex((track) => track.id === currentTrack.id)
    : -1

  const next = useCallback(() => {
    const active = currentTrackRef.current
    const index = active
      ? contextTracksRef.current.findIndex((track) => track.id === active.id)
      : -1
    const nextTrack = contextTracksRef.current[index + 1]
    if (nextTrack) startAudio(nextTrack)
  }, [startAudio])

  const previous = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }
    const active = currentTrackRef.current
    const index = active
      ? contextTracksRef.current.findIndex((track) => track.id === active.id)
      : -1
    const previousTrack = contextTracksRef.current[index - 1]
    if (previousTrack) startAudio(previousTrack)
  }, [startAudio])

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !currentTrackRef.current) return
    setError(null)
    if (audio.paused) {
      setStatus('loading')
      void audio.play().catch((playError: unknown) => {
        setStatus('error')
        setError(playbackError(playError))
      })
    } else {
      audio.pause()
    }
  }, [])

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
      canGoPrevious: currentIndex > 0 || currentTime > 3,
      canGoNext: currentIndex >= 0 && currentIndex < contextTracks.length - 1,
      playTrack,
      togglePlayback,
      previous,
      next,
      seek,
      setVolume,
      toggleMute,
    }),
    [
      currentIndex,
      contextTracks.length,
      currentTime,
      currentTrack,
      duration,
      error,
      muted,
      next,
      playTrack,
      previous,
      seek,
      setVolume,
      status,
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
        onLoadStart={() => setStatus('loading')}
        onPlaying={() => {
          setStatus('playing')
          setError(null)
        }}
        onPause={() => {
          if (currentTrackRef.current) {
            setStatus((currentStatus) =>
              currentStatus === 'error' ? currentStatus : 'paused',
            )
          }
        }}
        onWaiting={() => setStatus('loading')}
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
        onEnded={next}
        onError={() => {
          setStatus('error')
          setError(
            'This track could not be played. The file may be missing or unsupported.',
          )
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
