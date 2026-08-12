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
import {
  addAlbumToQueue,
  addTrackToQueue,
  advanceQueue,
  ApiError,
  clearUpcomingQueue,
  getQueue,
  moveQueueItem,
  playTrackNext,
  playTrackNow,
  removeQueueItem,
  replaceQueueWithAlbum,
  stopAndClearQueue,
} from '../api/client'
import type { QueueSnapshot } from '../api/types'

/* Context and provider intentionally share one module for the authoritative queue API. */
/* eslint-disable react-refresh/only-export-components */

export type QueueMutation =
  | 'add-track'
  | 'play-next'
  | 'play-now'
  | 'add-album'
  | 'play-album'
  | 'remove'
  | 'clear'
  | 'stop-clear'
  | 'move'
  | 'advance'

interface QueueValue {
  snapshot: QueueSnapshot | null
  loading: boolean
  error: string | null
  notice: string | null
  mutating: QueueMutation | null
  refresh: () => Promise<QueueSnapshot | null>
  addTrack: (trackId: number) => Promise<QueueSnapshot | null>
  playNext: (trackId: number) => Promise<QueueSnapshot | null>
  playNow: (trackId: number) => Promise<QueueSnapshot | null>
  addAlbum: (albumId: number) => Promise<QueueSnapshot | null>
  playAlbum: (albumId: number) => Promise<QueueSnapshot | null>
  remove: (itemId: number) => Promise<QueueSnapshot | null>
  clear: () => Promise<QueueSnapshot | null>
  stopAndClear: () => Promise<QueueSnapshot | null>
  move: (
    itemId: number,
    direction: 'up' | 'down',
  ) => Promise<QueueSnapshot | null>
  advance: (currentItemId: number) => Promise<QueueSnapshot | null>
  notify: (message: string) => void
}

const QueueContext = createContext<QueueValue | null>(null)

function queueMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The queue could not be updated. Its last confirmed state is still shown.'
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mutating, setMutating] = useState<QueueMutation | null>(null)
  const mutationLock = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const confirmed = await getQueue()
      setSnapshot(confirmed)
      setError(null)
      if (confirmed.warning) setNotice(confirmed.warning)
      return confirmed
    } catch (requestError) {
      setError(queueMessage(requestError))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  const mutate = useCallback(
    async (
      action: QueueMutation,
      request: () => Promise<QueueSnapshot>,
      successMessage?: string,
    ) => {
      if (mutationLock.current) return null
      mutationLock.current = true
      setMutating(action)
      setError(null)
      try {
        const confirmed = await request()
        setSnapshot(confirmed)
        setNotice(confirmed.warning ?? successMessage ?? null)
        return confirmed
      } catch (requestError) {
        const message = queueMessage(requestError)
        await refresh()
        setError(message)
        return null
      } finally {
        mutationLock.current = false
        setMutating(null)
      }
    },
    [refresh],
  )

  const value = useMemo<QueueValue>(
    () => ({
      snapshot,
      loading,
      error,
      notice,
      mutating,
      refresh,
      addTrack: (trackId) =>
        mutate('add-track', () => addTrackToQueue(trackId), 'Added to queue.'),
      playNext: (trackId) =>
        mutate(
          'play-next',
          () => playTrackNext(trackId),
          'Added to play next.',
        ),
      playNow: (trackId) => mutate('play-now', () => playTrackNow(trackId)),
      addAlbum: (albumId) =>
        mutate(
          'add-album',
          () => addAlbumToQueue(albumId),
          'Album added to queue.',
        ),
      playAlbum: (albumId) =>
        mutate('play-album', () => replaceQueueWithAlbum(albumId)),
      remove: (itemId) =>
        mutate('remove', () => removeQueueItem(itemId), 'Removed from queue.'),
      clear: () =>
        mutate('clear', clearUpcomingQueue, 'Upcoming queue cleared.'),
      stopAndClear: () =>
        mutate(
          'stop-clear',
          stopAndClearQueue,
          'Playback stopped and queue cleared.',
        ),
      move: (itemId, direction) =>
        mutate('move', () => moveQueueItem(itemId, direction)),
      advance: (currentItemId) =>
        mutate('advance', () => advanceQueue(currentItemId)),
      notify: setNotice,
    }),
    [error, loading, mutate, mutating, notice, refresh, snapshot],
  )

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>
}

export function useQueue(): QueueValue {
  const value = useContext(QueueContext)
  if (!value) throw new Error('useQueue must be used inside QueueProvider')
  return value
}
