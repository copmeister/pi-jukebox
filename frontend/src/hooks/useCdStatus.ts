import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  cancelCdRip,
  ejectCd,
  getCdStatus,
  retryCdMetadata,
  selectCdRelease,
  startCdRip,
} from '../api/client'
import type { CdStatus } from '../api/types'

export interface CdState {
  status: CdStatus | null
  loading: boolean
  mutating: boolean
  error: string | null
  notice: string | null
  refresh: () => Promise<void>
  retryMetadata: () => Promise<void>
  selectRelease: (releaseId: string) => Promise<void>
  startRip: (releaseId: string) => Promise<void>
  cancelRip: (jobId: number) => Promise<void>
  eject: () => Promise<void>
}

function message(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The CD action could not be completed safely.'
}

export function useCdStatus(
  onCatalogueChange: () => void,
  sleeping = false,
): CdState {
  const [status, setStatus] = useState<CdStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const lastReady = useRef(0)
  const callbackRef = useRef(onCatalogueChange)

  useEffect(() => {
    callbackRef.current = onCatalogueChange
  }, [onCatalogueChange])

  const applyStatus = useCallback((next: CdStatus) => {
    setStatus(next)
    setError(null)
    const ready = next.latest_job?.completed_tracks ?? 0
    if (ready > lastReady.current) callbackRef.current()
    lastReady.current = ready
  }, [])

  const refresh = useCallback(async () => {
    try {
      applyStatus(await getCdStatus())
    } catch (requestError) {
      setError(message(requestError))
    } finally {
      setLoading(false)
    }
  }, [applyStatus])

  useEffect(() => {
    if (sleeping) return
    const controller = new AbortController()
    void getCdStatus(controller.signal)
      .then(applyStatus)
      .catch((requestError) => {
        if (!(requestError instanceof DOMException))
          setError(message(requestError))
      })
      .finally(() => setLoading(false))
    const interval = window.setInterval(() => void refresh(), 2000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [applyStatus, refresh, sleeping])

  const action = useCallback(
    async (request: () => Promise<{ message: string }>) => {
      if (mutating) return
      setMutating(true)
      setError(null)
      setNotice(null)
      try {
        const result = await request()
        setNotice(result.message)
        await refresh()
      } catch (requestError) {
        setError(message(requestError))
      } finally {
        setMutating(false)
      }
    },
    [mutating, refresh],
  )

  return {
    status,
    loading,
    mutating,
    error,
    notice,
    refresh,
    retryMetadata: () => action(retryCdMetadata),
    selectRelease: (releaseId) => action(() => selectCdRelease(releaseId)),
    startRip: (releaseId) => action(() => startCdRip(releaseId)),
    cancelRip: (jobId) => action(() => cancelCdRip(jobId)),
    eject: () => action(ejectCd),
  }
}
