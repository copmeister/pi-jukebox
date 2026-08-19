import { useState } from 'react'
import type { BluetoothDevice } from '../api/types'
import { useBluetooth } from '../bluetooth/BluetoothContext'
import { ScreenState } from '../components/ScreenState'

function stateLabel(state: string): string {
  return state.replaceAll('_', ' ')
}

export function BluetoothScreen() {
  const bluetooth = useBluetooth()
  const { status } = bluetooth
  const [forgetDevice, setForgetDevice] = useState<BluetoothDevice | null>(null)

  if (bluetooth.loading && !status.available) {
    return (
      <div className="screen bluetooth-screen">
        <ScreenState
          title="Checking Bluetooth"
          message="Looking for the Raspberry Pi Bluetooth receiver service…"
        />
      </div>
    )
  }

  if (!status.available) {
    return (
      <div className="screen bluetooth-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Phone audio</p>
            <h1>Bluetooth</h1>
          </div>
        </div>
        <ScreenState
          title="Bluetooth is not available here"
          message="This feature is enabled on the Raspberry Pi after its one-time v0.6.0 setup. Local jukebox playback is unaffected."
          actionLabel="Check again"
          onAction={() => void bluetooth.refresh()}
        />
        {bluetooth.error ? (
          <p className="bluetooth-error" role="alert">
            {bluetooth.error}
          </p>
        ) : null}
      </div>
    )
  }

  const trustedDevices = status.devices.filter(
    (device) => device.paired && device.trusted,
  )
  const pending = status.pending_pairing

  return (
    <div className="screen bluetooth-screen">
      <div className="screen-header bluetooth-header">
        <div>
          <p className="eyebrow">Phone audio</p>
          <h1>Bluetooth</h1>
          <p>Play audio from one paired phone through the jukebox speakers.</p>
        </div>
        <button
          type="button"
          className={status.mode_active ? 'secondary-button' : 'primary-button'}
          disabled={bluetooth.mutating}
          onClick={() =>
            void (status.mode_active
              ? bluetooth.deactivate()
              : bluetooth.activate())
          }
        >
          {status.mode_active ? 'Return to Jukebox' : 'Use Bluetooth'}
        </button>
      </div>

      <section className="bluetooth-status-card" aria-live="polite">
        <span
          className={`bluetooth-state-dot is-${status.state}`}
          aria-hidden="true"
        />
        <div>
          <strong>{stateLabel(status.state)}</strong>
          <p>{status.message}</p>
        </div>
      </section>

      {bluetooth.error ? (
        <p className="bluetooth-error" role="alert">
          {bluetooth.error}
        </p>
      ) : null}

      {pending ? (
        <section className="bluetooth-pairing-confirmation" role="alertdialog">
          <div>
            <p className="eyebrow">Confirm on this screen</p>
            <h2>{pending.device_name}</h2>
            {pending.passkey ? (
              <p>
                Does this code match the phone?{' '}
                <strong className="bluetooth-passkey">{pending.passkey}</strong>
              </p>
            ) : (
              <p>Allow this phone to use the jukebox speakers?</p>
            )}
          </div>
          <div className="bluetooth-card-actions">
            <button
              type="button"
              className="primary-button"
              disabled={bluetooth.mutating}
              onClick={() => void bluetooth.respondToPairing(pending.id, true)}
            >
              Accept
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={bluetooth.mutating}
              onClick={() => void bluetooth.respondToPairing(pending.id, false)}
            >
              Reject
            </button>
          </div>
        </section>
      ) : null}

      <div className="bluetooth-grid">
        <section className="bluetooth-card">
          <div>
            <p className="eyebrow">Pair a phone</p>
            <h2>{status.adapter_alias ?? 'Pi Jukebox'}</h2>
            <p>
              {status.pairable
                ? `Visible for ${status.pairing_seconds_remaining} seconds. Open Bluetooth settings on the phone.`
                : 'Pairing is off until you deliberately open a short pairing window.'}
            </p>
          </div>
          <div className="bluetooth-card-actions">
            {status.pairable ? (
              <button
                type="button"
                className="secondary-button"
                disabled={bluetooth.mutating}
                onClick={() => void bluetooth.cancelPairing()}
              >
                Cancel Pairing
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={bluetooth.mutating}
                onClick={() => void bluetooth.startPairing()}
              >
                Pair New Device
              </button>
            )}
          </div>
        </section>

        <section className="bluetooth-card">
          <div>
            <p className="eyebrow">Trusted phones</p>
            <h2>{trustedDevices.length || 'None yet'}</h2>
            <p>
              Only phones accepted on this touchscreen are remembered and may
              reconnect.
            </p>
          </div>
        </section>
      </div>

      {trustedDevices.length ? (
        <section className="bluetooth-devices" aria-labelledby="devices-title">
          <h2 id="devices-title">Paired devices</h2>
          {trustedDevices.map((device) => (
            <article className="bluetooth-device" key={device.id}>
              <div>
                <strong>{device.name}</strong>
                <small>
                  {device.audio_playing
                    ? 'Playing audio'
                    : device.connected
                      ? 'Connected'
                      : 'Not connected'}
                </small>
              </div>
              <div className="bluetooth-card-actions">
                <button
                  type="button"
                  className={
                    device.connected ? 'secondary-button' : 'primary-button'
                  }
                  disabled={bluetooth.mutating}
                  onClick={() =>
                    void (device.connected
                      ? bluetooth.disconnect(device.id)
                      : bluetooth.connect(device.id))
                  }
                >
                  {device.connected ? 'Disconnect' : 'Connect'}
                </button>
                <button
                  type="button"
                  className="secondary-button danger-button"
                  disabled={bluetooth.mutating}
                  onClick={() => setForgetDevice(device)}
                >
                  Forget
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {forgetDevice ? (
        <section className="confirmation-panel" role="alertdialog">
          <p>
            Forget <strong>{forgetDevice.name}</strong>? It must be paired again
            before it can reconnect.
          </p>
          <button
            type="button"
            className="danger-button"
            disabled={bluetooth.mutating}
            onClick={() => {
              void bluetooth.forget(forgetDevice.id).then((forgotten) => {
                if (forgotten) setForgetDevice(null)
              })
            }}
          >
            Forget Device
          </button>
          <button
            type="button"
            disabled={bluetooth.mutating}
            onClick={() => setForgetDevice(null)}
          >
            Keep Device
          </button>
        </section>
      ) : null}

      <p className="settings-note">
        Bluetooth changes the audio source only. Jukebox music volume, queues
        and playback position are not controlled by the phone.
      </p>
    </div>
  )
}
