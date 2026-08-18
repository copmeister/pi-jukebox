import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'

/* Preference helpers and provider intentionally share one small browser-local module. */
/* eslint-disable react-refresh/only-export-components */

export const DISPLAY_SIZE_STORAGE_KEY = 'pi-jukebox:display-size:v1'

export type DisplaySize = 'standard' | 'large' | 'extra-large'

export const DISPLAY_SIZE_OPTIONS: ReadonlyArray<{
  value: DisplaySize
  label: string
  description: string
}> = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Original information density',
  },
  {
    value: 'large',
    label: 'Large',
    description: 'Larger text and touch controls',
  },
  {
    value: 'extra-large',
    label: 'Extra Large',
    description: 'Maximum practical readability',
  },
]

function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function isDisplaySize(value: unknown): value is DisplaySize {
  return ['standard', 'large', 'extra-large'].includes(String(value))
}

export function loadDisplaySize(
  storage: Storage | null = browserStorage(),
): DisplaySize {
  if (!storage) return 'standard'
  try {
    const stored = storage.getItem(DISPLAY_SIZE_STORAGE_KEY)
    return isDisplaySize(stored) ? stored : 'standard'
  } catch {
    return 'standard'
  }
}

export function saveDisplaySize(
  displaySize: DisplaySize,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(DISPLAY_SIZE_STORAGE_KEY, displaySize)
  } catch {
    // A locked-down kiosk can still use the in-memory preference for this run.
  }
}

interface DisplaySizeContextValue {
  displaySize: DisplaySize
  setDisplaySize: (displaySize: DisplaySize) => void
}

const DisplaySizeContext = createContext<DisplaySizeContextValue>({
  displaySize: 'standard',
  setDisplaySize: () => undefined,
})

export function DisplaySizeProvider({
  children,
  initialSize,
}: {
  children: ReactNode
  initialSize?: DisplaySize
}) {
  const [displaySize, setDisplaySizeState] = useState<DisplaySize>(
    () => initialSize ?? loadDisplaySize(),
  )

  const setDisplaySize = useCallback((next: DisplaySize) => {
    setDisplaySizeState(next)
    saveDisplaySize(next)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.displaySize
    root.dataset.displaySize = displaySize
    return () => {
      if (previous) root.dataset.displaySize = previous
      else delete root.dataset.displaySize
    }
  }, [displaySize])

  const value = useMemo(
    () => ({ displaySize, setDisplaySize }),
    [displaySize, setDisplaySize],
  )

  return (
    <DisplaySizeContext.Provider value={value}>
      {children}
    </DisplaySizeContext.Provider>
  )
}

export function useDisplaySize(): DisplaySizeContextValue {
  return useContext(DisplaySizeContext)
}
