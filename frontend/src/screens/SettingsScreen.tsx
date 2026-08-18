import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  checkForUpdates,
  getUpdateStatus,
  installUpdate,
} from '../api/client'
import type { UpdateStatus } from '../api/types'
import { ScreenState } from '../components/ScreenState'
import {
  DISPLAY_SIZE_OPTIONS,
  useDisplaySize,
} from '../display/DisplaySizeContext'

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Update information is unavailable right now.'
}

export function SettingsScreen() {
  const { displaySize, setDisplaySize } = useDisplaySize()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getUpdateStatus())
      setError(null)
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), 2000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refresh])

  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await operation()
      await refresh()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Settings</h1>
          <p>Software information and safe, release-based updates.</p>
        </div>
      </header>

      <section
        className="display-size-card"
        aria-labelledby="display-size-title"
      >
        <header>
          <div>
            <p className="eyebrow">Touchscreen</p>
            <h2 id="display-size-title">Display Size</h2>
          </div>
          <span className="display-size-current" role="status">
            {DISPLAY_SIZE_OPTIONS.find((option) => option.value === displaySize)
              ?.label ?? 'Standard'}
          </span>
        </header>
        <p>
          Adjust text, controls, cards and the classic selector. This affects
          only the jukebox interface, not browser zoom or the display
          resolution.
        </p>
        <div
          className="display-size-options"
          role="radiogroup"
          aria-label="Display Size"
        >
          {DISPLAY_SIZE_OPTIONS.map((option) => (
            <button
              type="button"
              role="radio"
              aria-checked={displaySize === option.value}
              className={displaySize === option.value ? 'is-selected' : ''}
              onClick={() => setDisplaySize(option.value)}
              key={option.value}
            >
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
        <p className="settings-note">
          Large and Extra Large show three selector panels with six songs per
          panel for easier touch selection.
        </p>
      </section>

      {!status && !error ? (
        <ScreenState
          title="Loading software information"
          message="The jukebox remains available while this loads."
          kind="loading"
        />
      ) : null}
      {error ? (
        <ScreenState
          title="Update service unavailable"
          message={error}
          kind="error"
          actionLabel="Try again"
          onAction={() => void refresh()}
        />
      ) : null}
      {status ? (
        <section className="software-card" aria-labelledby="software-title">
          <header>
            <div>
              <p className="eyebrow">Software</p>
              <h2 id="software-title">Pi Jukebox {status.installed_version}</h2>
            </div>
            <span
              className={
                status.update_available
                  ? 'update-badge is-available'
                  : 'update-badge'
              }
            >
              {status.checking
                ? 'Checking…'
                : status.update_available
                  ? `Version ${status.latest_version} available`
                  : 'Up to date'}
            </span>
          </header>
          <dl>
            <div>
              <dt>Installed</dt>
              <dd>{status.installed_version}</dd>
            </div>
            <div>
              <dt>Latest stable</dt>
              <dd>{status.latest_version ?? 'Not checked'}</dd>
            </div>
            <div>
              <dt>Release source</dt>
              <dd>{status.source}</dd>
            </div>
          </dl>
          {status.message ? <p role="status">{status.message}</p> : null}
          {status.last_error ? (
            <p className="settings-error" role="status">
              {status.last_error}
            </p>
          ) : null}
          <div className="software-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || status.checking || status.installing}
              onClick={() => void action(checkForUpdates)}
            >
              Check for updates
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !status.install_available || status.installing}
              onClick={() => void action(installUpdate)}
            >
              {status.installing ? 'Preparing update…' : 'Update Software'}
            </button>
          </div>
          {!status.install_available && status.update_available ? (
            <p className="settings-note">
              An administrator must configure the isolated update helper before
              this private release can be installed safely.
            </p>
          ) : null}
          <p className="settings-note">
            Updates use stable GitHub Releases through the Pi service account.
            Credentials are never sent to this browser.
          </p>
        </section>
      ) : null}
    </div>
  )
}
