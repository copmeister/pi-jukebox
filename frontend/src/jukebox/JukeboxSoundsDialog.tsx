import { useEffect, useRef } from 'react'
import type { JukeboxSoundController } from './sounds'

interface JukeboxSoundsDialogProps {
  sounds: JukeboxSoundController
  onClose: () => void
}

function percent(value: number): number {
  return Math.round(value * 100)
}

export function JukeboxSoundsDialog({
  sounds,
  onClose,
}: JukeboxSoundsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const slider = (
    label: string,
    value: number,
    setting:
      | 'masterVolume'
      | 'buttonVolume'
      | 'movementVolume'
      | 'confirmationVolume'
      | 'loadingVolume',
    preview?: 'button' | 'movement' | 'confirmation' | 'loading',
  ) => (
    <div className="jukebox-sound-row">
      <label>
        <span>
          {label} <output>{percent(value)}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={percent(value)}
          aria-label={label}
          onChange={(event) =>
            sounds.updateSettings({
              [setting]: Number(event.target.value) / 100,
            })
          }
        />
      </label>
      {preview ? (
        <button
          type="button"
          onClick={() => sounds.preview(preview)}
          disabled={!sounds.settings.enabled}
          aria-label={`Preview ${label.toLowerCase()}`}
        >
          Preview
        </button>
      ) : (
        <span className="jukebox-sound-preview-spacer" aria-hidden="true" />
      )}
    </div>
  )

  return (
    <div className="jukebox-sounds-backdrop">
      <div
        className="jukebox-sounds-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jukebox-sounds-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header>
          <div>
            <p className="eyebrow">Mechanical feedback</p>
            <h2 id="jukebox-sounds-title">Jukebox Sounds</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Jukebox Sounds"
          >
            Close
          </button>
        </header>

        <div className="jukebox-sound-toggles">
          <label className="jukebox-sound-toggle">
            <input
              type="checkbox"
              checked={sounds.settings.enabled}
              onChange={(event) =>
                sounds.updateSettings({ enabled: event.target.checked })
              }
            />
            <span>Sound effects enabled</span>
          </label>

          <label className="jukebox-sound-toggle">
            <input
              type="checkbox"
              checked={sounds.settings.loadingPause}
              onChange={(event) =>
                sounds.updateSettings({ loadingPause: event.target.checked })
              }
            />
            <span>Mechanical loading pause</span>
          </label>
        </div>

        <div className="jukebox-sound-sliders">
          {slider(
            'Master effects volume',
            sounds.settings.masterVolume,
            'masterVolume',
          )}
          {slider(
            'Button click volume',
            sounds.settings.buttonVolume,
            'buttonVolume',
            'button',
          )}
          {slider(
            'Panel movement volume',
            sounds.settings.movementVolume,
            'movementVolume',
            'movement',
          )}
          {slider(
            'Selection confirmation volume',
            sounds.settings.confirmationVolume,
            'confirmationVolume',
            'confirmation',
          )}
          {slider(
            'Loading mechanism volume',
            sounds.settings.loadingVolume,
            'loadingVolume',
            'loading',
          )}
        </div>

        <p className="jukebox-sound-note">
          These controls affect only the Jukebox presentation. They do not
          change music playback volume or Raspberry Pi system volume. Turning
          effects off also skips the theatrical loading pause.
        </p>

        <footer>
          <button type="button" onClick={sounds.resetSettings}>
            Reset to defaults
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
