import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BluetoothStatus } from '../api/types'
import { BluetoothScreen } from '../screens/BluetoothScreen'
import { BluetoothProvider, useBluetooth } from './BluetoothContext'

const inactive: BluetoothStatus = {
  available: true,
  mode_active: false,
  state: 'inactive',
  adapter_alias: 'Pi Jukebox',
  discoverable: false,
  pairable: false,
  pairing_seconds_remaining: 0,
  connected_device_id: null,
  devices: [],
  pending_pairing: null,
  message: 'Bluetooth mode is off. Local jukebox playback remains available.',
}

const phone = {
  id: '0123456789abcdef',
  name: 'Test Phone',
  paired: true,
  trusted: true,
  connected: true,
  audio_playing: true,
}

function response(payload: BluetoothStatus): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function CoordinatorHarness({ paused }: { paused: () => void }) {
  const bluetooth = useBluetooth()
  return (
    <div>
      <button
        type="button"
        onClick={() => bluetooth.registerLocalPause(paused)}
      >
        Register local player
      </button>
      <button type="button" onClick={() => void bluetooth.activate()}>
        Activate
      </button>
      <button
        type="button"
        onClick={() => void bluetooth.prepareLocalPlayback()}
      >
        Play local
      </button>
      <p>{bluetooth.status.state}</p>
    </div>
  )
}

describe('Bluetooth receiver interface', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('opens a bounded pairing window and confirms the phone passkey', async () => {
    let current = inactive
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/bluetooth/status')) return response(current)
        expect(init?.headers).toEqual({
          'X-Pi-Jukebox-Action': 'bluetooth-control',
        })
        if (url.endsWith('/api/bluetooth/pairing/start')) {
          current = {
            ...inactive,
            mode_active: true,
            state: 'pairing',
            discoverable: true,
            pairable: true,
            pairing_seconds_remaining: 120,
            pending_pairing: {
              id: '0123456789abcdef01234567',
              device_id: phone.id,
              device_name: phone.name,
              kind: 'confirm',
              passkey: '123456',
            },
            message: 'Pi Jukebox is available for pairing for 120 seconds.',
          }
          return response(current)
        }
        if (url.endsWith('/accept')) {
          current = {
            ...current,
            state: 'connected',
            discoverable: false,
            pairable: false,
            pairing_seconds_remaining: 0,
            pending_pairing: null,
            connected_device_id: phone.id,
            devices: [{ ...phone, audio_playing: false }],
            message: 'Connected to Test Phone. Start audio on the phone.',
          }
          return response(current)
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <BluetoothProvider>
        <BluetoothScreen />
      </BluetoothProvider>,
    )

    expect(await screen.findByText(/Bluetooth mode is off/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pair New Device' }))
    expect(await screen.findByText('123456')).toBeInTheDocument()
    expect(screen.getByText('Test Phone')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(
      await screen.findByText(/Start audio on the phone/),
    ).toBeInTheDocument()
    expect(screen.queryByText('123456')).not.toBeInTheDocument()
  })

  it('pauses local audio before Bluetooth and deactivates Bluetooth before local playback', async () => {
    let current = inactive
    const paused = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/bluetooth/status')) return response(current)
        if (url.endsWith('/api/bluetooth/activate')) {
          current = {
            ...inactive,
            mode_active: true,
            state: 'audio_playing',
            connected_device_id: phone.id,
            devices: [phone],
            message: 'Playing audio from Test Phone.',
          }
          return response(current)
        }
        if (url.endsWith('/api/bluetooth/deactivate')) {
          current = inactive
          return response(current)
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    const user = userEvent.setup()
    render(
      <BluetoothProvider>
        <CoordinatorHarness paused={paused} />
      </BluetoothProvider>,
    )

    await screen.findByText('inactive')
    await user.click(
      screen.getByRole('button', { name: 'Register local player' }),
    )
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(paused).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('audio_playing')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Play local' }))
    await waitFor(() =>
      expect(screen.getByText('inactive')).toBeInTheDocument(),
    )
  })

  it('fails safely when the helper is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    render(
      <BluetoothProvider>
        <BluetoothScreen />
      </BluetoothProvider>,
    )

    expect(
      await screen.findByRole('heading', {
        name: 'Bluetooth is not available here',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/backend is running/i)).toBeInTheDocument()
  })
})
