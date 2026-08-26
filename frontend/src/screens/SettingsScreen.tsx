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
import {
  rememberRequestedUpdate,
  UPDATE_RELOAD_STORAGE_KEY,
  updateOutcomeNeedsReload,
} from '../update/updateReload'
import { VISUALISER_REGISTRY } from '../visualiser/visualiserRegistry'
import {
  loadVisualiserPreferences,
  saveVisualiserPreferences,
  setVisualiserEnabled,
  setVisualiserSensitivity,
} from '../visualiser/visualiserPreferences'
import {
  VISUALISER_SENSITIVITY_MAX_DB,
  VISUALISER_SENSITIVITY_MIN_DB,
} from '../visualiser/sensitivity'

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Update information is unavailable right now.'
}

const UPDATE_STAGE_LABELS: Record<string, string> = {
  idle: 'Ready',
  queued: 'Queued',
  downloading: 'Downloading',
  verifying: 'Verifying',
  preparing: 'Preparing',
  installing: 'Installing',
  restarting: 'Restarting',
  rolling_back: 'Restoring previous version',
  complete: 'Complete',
  recovery_required: 'Recovery required',
}
export function SettingsScreen({ sleeping = false }: { sleeping?: boolean }) {
  const { displaySize, setDisplaySize } = useDisplaySize()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [visualiserPreferences, setVisualiserPreferences] = useState(
    loadVisualiserPreferences,
  )
  const updateStage = status
    ? (UPDATE_STAGE_LABELS[status.stage] ?? 'Working')
    : 'Ready'

  const refresh = useCallback(async () => {
    try {
      setStatus(await getUpdateStatus())
      setError(null)
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }, [])

  useEffect(() => {
    if (sleeping) return
    const initial = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), 2000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refresh, sleeping])

  useEffect(() => {
    if (!status) return
    try {
      const requestedVersion = window.sessionStorage.getItem(
        UPDATE_RELOAD_STORAGE_KEY,
      )
      if (updateOutcomeNeedsReload(status, requestedVersion)) {
        window.sessionStorage.removeItem(UPDATE_RELOAD_STORAGE_KEY)
        window.location.reload()
      }
    } catch {
      // Reload is a presentation refresh; update integrity does not depend on it.
    }
  }, [status])

  const action = async (
    operation: () => Promise<unknown>,
    onAccepted?: () => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      await operation()
      onAccepted?.()
      await refresh()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const toggleVisualiser = (id: (typeof VISUALISER_REGISTRY)[number]['id']) => {
    const next = setVisualiserEnabled(
      visualiserPreferences,
      id,
      !visualiserPreferences.enabled.includes(id),
    )
    setVisualiserPreferences(next)
    saveVisualiserPreferences(next)
  }

  const changeVisualiserSensitivity = (
    id: (typeof VISUALISER_REGISTRY)[number]['id'],
    sensitivityDb: number,
  ) => {
    const next = setVisualiserSensitivity(
      visualiserPreferences,
      id,
      sensitivityDb,
    )
    setVisualiserPreferences(next)
    saveVisualiserPreferences(next)
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
      {error && !status ? (
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
                status.outcome === 'rolled_back' || status.outcome === 'failed'
                  ? 'update-badge is-error'
                  : status.update_available
                    ? 'update-badge is-available'
                    : 'update-badge'
              }
            >
              {status.checking
                ? 'Checking…'
                : status.installing
                  ? updateStage
                  : status.outcome === 'succeeded'
                    ? `Updated to ${status.installed_version}`
                    : status.outcome === 'rolled_back'
                      ? `Restored ${status.installed_version}`
                      : status.outcome === 'failed'
                        ? 'Update failed'
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
          {status.installing ? (
            <div className="update-progress" role="status" aria-live="polite">
              <span aria-hidden="true" />
              <div>
                <strong>{updateStage}</strong>
                <small>
                  Keep Pi Jukebox powered on. The screen may reconnect during
                  restart.
                </small>
              </div>
            </div>
          ) : null}
          {status.last_error || error ? (
            <p className="settings-error" role="status">
              {status.last_error ??
                'The jukebox is temporarily reconnecting after the update.'}
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
              onClick={() =>
                void action(installUpdate, () =>
                  rememberRequestedUpdate(status.latest_version),
                )
              }
            >
              {status.installing ? `${updateStage}…` : 'Update Software'}
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

      <section
        className="visualiser-settings-card"
        aria-labelledby="visualisers-title"
      >
        <h2 id="visualisers-title">Visualisers</h2>
        <p>Choose which visualisers appear when swiping.</p>
        <div className="visualiser-settings-list">
          {VISUALISER_REGISTRY.map((definition) => {
            const enabled = visualiserPreferences.enabled.includes(
              definition.id,
            )
            const lastEnabled =
              enabled && visualiserPreferences.enabled.length === 1
            return (
              <div className="visualiser-setting" key={definition.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={lastEnabled}
                  onClick={() => toggleVisualiser(definition.id)}
                >
                  <strong>{definition.name}</strong>
                  <span aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
                </button>
                <label>
                  <span>Sensitivity</span>
                  <input
                    type="range"
                    min={VISUALISER_SENSITIVITY_MIN_DB}
                    max={VISUALISER_SENSITIVITY_MAX_DB}
                    step="1"
                    value={visualiserPreferences.sensitivity[definition.id]}
                    aria-label={`${definition.name} sensitivity`}
                    onChange={(event) =>
                      changeVisualiserSensitivity(
                        definition.id,
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <output>
                    {visualiserPreferences.sensitivity[definition.id] > 0
                      ? `+${visualiserPreferences.sensitivity[definition.id]} dB`
                      : `${visualiserPreferences.sensitivity[definition.id]} dB`}
                  </output>
                </label>
                <div
                  className="visualiser-sensitivity-scale"
                  aria-hidden="true"
                >
                  <span>Low</span>
                  <span>Normal</span>
                  <span>High</span>
                </div>
              </div>
            )
          })}
        </div>
        <p className="settings-note">
          At least one visualiser must remain enabled. Choices are stored on
          this touchscreen.
        </p>
      </section>
    </div>
  )
}
