import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getAlbums, getScanStatus, startScan } from '../api/client'
import type { AlbumSummary, ScanStatus } from '../api/types'

interface CatalogueState {
  albums: AlbumSummary[]
  scanStatus: ScanStatus | null
  loading: boolean
  error: string | null
  scanMessage: string | null
  refresh: () => Promise<void>
  rescan: () => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something unexpected happened while loading the library.'
}

export function useCatalogue(sleeping = false): CatalogueState {
  const [albums, setAlbums] = useState<AlbumSummary[]>([])
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const previousRunning = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [nextAlbums, nextStatus] = await Promise.all([
        getAlbums(),
        getScanStatus(),
      ])
      setAlbums(nextAlbums)
      setScanStatus(nextStatus)
      setError(null)
      previousRunning.current = nextStatus.running
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([getAlbums(), getScanStatus()])
      .then(([nextAlbums, nextStatus]) => {
        if (!active) return
        setAlbums(nextAlbums)
        setScanStatus(nextStatus)
        setError(null)
        previousRunning.current = nextStatus.running
      })
      .catch((refreshError) => {
        if (active) setError(errorMessage(refreshError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (sleeping || !scanStatus?.running) return
    const initial = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => {
      void getScanStatus()
        .then(async (nextStatus) => {
          setScanStatus(nextStatus)
          if (previousRunning.current && !nextStatus.running) {
            const nextAlbums = await getAlbums()
            setAlbums(nextAlbums)
            setScanMessage(
              nextStatus.latest_scan?.status === 'completed'
                ? 'Library scan complete.'
                : 'Library scan finished with a problem.',
            )
          }
          previousRunning.current = nextStatus.running
        })
        .catch((pollError) => setError(errorMessage(pollError)))
    }, 800)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refresh, scanStatus?.running, sleeping])

  const rescan = useCallback(async () => {
    if (scanStatus?.running) return
    setScanMessage(null)
    setError(null)
    try {
      await startScan()
      previousRunning.current = true
      setScanStatus((current) =>
        current ? { ...current, running: true } : current,
      )
      if (!scanStatus) await refresh()
    } catch (scanError) {
      setError(errorMessage(scanError))
    }
  }, [refresh, scanStatus])

  return {
    albums,
    scanStatus,
    loading,
    error,
    scanMessage,
    refresh,
    rescan,
  }
}
