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
  activateBluetooth,
  cancelBluetoothPairing,
  connectBluetoothDevice,
  deactivateBluetooth,
  disconnectBluetoothDevice,
  forgetBluetoothDevice,
  getBluetoothStatus,
  respondToBluetoothPairing,
  startBluetoothPairing,
} from '../api/client'
import type { BluetoothStatus } from '../api/types'

/* Provider and hook intentionally share this module as the Bluetooth state boundary. */
/* eslint-disable react-refresh/only-export-components */

const UNAVAILABLE_STATUS: BluetoothStatus = {
  available: false,
  mode_active: false,
  state: 'unavailable',
  adapter_alias: null,
  discoverable: false,
  pairable: false,
  pairing_seconds_remaining: 0,
  connected_device_id: null,
  devices: [],
  pending_pairing: null,
  message: 'Bluetooth receiver mode is unavailable.',
}

type LocalPauseHandler = () => void

interface BluetoothValue {
  status: BluetoothStatus
  loading: boolean
  mutating: boolean
  error: string | null
  refresh: () => Promise<void>
  activate: () => Promise<boolean>
  deactivate: () => Promise<boolean>
  startPairing: () => Promise<boolean>
  cancelPairing: () => Promise<boolean>
  respondToPairing: (requestId: string, accept: boolean) => Promise<boolean>
  connect: (deviceId: string) => Promise<boolean>
  disconnect: (deviceId: string) => Promise<boolean>
  forget: (deviceId: string) => Promise<boolean>
  prepareLocalPlayback: () => Promise<boolean>
  registerLocalPause: (handler: LocalPauseHandler | null) => void
}

const BluetoothContext = createContext<BluetoothValue | null>(null)

function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Bluetooth receiver control could not complete that request.'
}

export function BluetoothProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState(UNAVAILABLE_STATUS)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const statusRef = useRef(status)
  const mutatingRef = useRef(false)
  const localPauseRef = useRef<LocalPauseHandler | null>(null)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const applyStatus = useCallback((next: BluetoothStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const loadStatus = useCallback(
    async (clearError: boolean) => {
      try {
        const next = await getBluetoothStatus()
        applyStatus(next)
        if (clearError) setError(null)
      } catch (requestError) {
        applyStatus(UNAVAILABLE_STATUS)
        setError(readableError(requestError))
      } finally {
        setLoading(false)
      }
    },
    [applyStatus],
  )

  const refresh = useCallback(() => loadStatus(true), [loadStatus])

  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    const poll = async () => {
      await loadStatus(false)
      if (stopped) return
      const current = statusRef.current
      const delay =
        current.mode_active || current.pending_pairing || current.pairable
          ? 1500
          : 5000
      timer = window.setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [loadStatus])

  const mutate = useCallback(
    async (
      action: () => Promise<BluetoothStatus>,
      pauseLocal = false,
    ): Promise<boolean> => {
      if (mutatingRef.current) return false
      mutatingRef.current = true
      if (pauseLocal) localPauseRef.current?.()
      setMutating(true)
      setError(null)
      try {
        const next = await action()
        applyStatus(next)
        return true
      } catch (requestError) {
        setError(readableError(requestError))
        try {
          applyStatus(await getBluetoothStatus())
        } catch {
          applyStatus(UNAVAILABLE_STATUS)
        }
        return false
      } finally {
        mutatingRef.current = false
        setMutating(false)
      }
    },
    [applyStatus],
  )

  const prepareLocalPlayback = useCallback(async () => {
    if (!statusRef.current.mode_active) return true
    return mutate(deactivateBluetooth)
  }, [mutate])

  const value = useMemo<BluetoothValue>(
    () => ({
      status,
      loading,
      mutating,
      error,
      refresh,
      activate: () => mutate(activateBluetooth, true),
      deactivate: () => mutate(deactivateBluetooth),
      startPairing: () => mutate(startBluetoothPairing, true),
      cancelPairing: () => mutate(cancelBluetoothPairing),
      respondToPairing: (requestId, accept) =>
        mutate(() => respondToBluetoothPairing(requestId, accept)),
      connect: (deviceId) =>
        mutate(() => connectBluetoothDevice(deviceId), true),
      disconnect: (deviceId) =>
        mutate(() => disconnectBluetoothDevice(deviceId)),
      forget: (deviceId) => mutate(() => forgetBluetoothDevice(deviceId)),
      prepareLocalPlayback,
      registerLocalPause: (handler) => {
        localPauseRef.current = handler
      },
    }),
    [error, loading, mutate, mutating, prepareLocalPlayback, refresh, status],
  )

  return (
    <BluetoothContext.Provider value={value}>
      {children}
    </BluetoothContext.Provider>
  )
}

export function useBluetooth(): BluetoothValue {
  const value = useContext(BluetoothContext)
  if (!value)
    throw new Error('useBluetooth must be used inside BluetoothProvider')
  return value
}

export function useOptionalBluetooth(): BluetoothValue | null {
  return useContext(BluetoothContext)
}
