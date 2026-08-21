import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DISPLAY_SIZE_STORAGE_KEY,
  DisplaySizeProvider,
} from '../display/DisplaySizeContext'
import {
  UPDATE_RELOAD_STORAGE_KEY,
  updateOutcomeNeedsReload,
} from '../update/updateReload'
import { VISUALISER_PREFERENCES_STORAGE_KEY } from '../visualiser/visualiserPreferences'
import { SettingsScreen } from './SettingsScreen'

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  })
}

const status = {
  installed_version: '0.5.0',
  latest_version: '0.5.1',
  checking: false,
  installing: false,
  update_available: true,
  install_available: false,
  stage: 'idle',
  outcome: null,
  requested_version: null,
  previous_version: null,
  message: 'Version 0.5.1 is available.',
  last_error: null,
  source: 'Authenticated GitHub Releases via the local GitHub CLI',
}

describe('Settings software updates', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('shows versions, checks asynchronously, and keeps unsafe install disabled', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/system/updates')) return response(status)
      if (String(input).endsWith('/api/system/updates/check'))
        return response({ accepted: true, message: 'Checking.' })
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )

    expect(await screen.findByText('Pi Jukebox 0.5.0')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Update Software' }),
    ).toBeDisabled()
    expect(screen.getByText(/credentials are never sent/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/system/updates/check'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('applies and restores the persistent Display Size immediately', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(status)),
    )
    const user = userEvent.setup()
    const first = render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )

    const extraLarge = await screen.findByRole('radio', {
      name: /Extra Large/i,
    })
    await user.click(extraLarge)
    expect(extraLarge).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).toHaveAttribute(
      'data-display-size',
      'extra-large',
    )
    expect(window.localStorage.getItem(DISPLAY_SIZE_STORAGE_KEY)).toBe(
      'extra-large',
    )

    first.unmount()
    render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )
    expect(
      await screen.findByRole('radio', { name: /Extra Large/i }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('manages persistent visualisers while keeping at least one enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(status)),
    )
    const user = userEvent.setup()
    const first = render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )

    const switches = await screen.findAllByRole('switch')
    const softwareHeading = await screen.findByRole('heading', {
      name: 'Pi Jukebox 0.5.0',
    })
    const visualiserHeading = screen.getByRole('heading', {
      name: 'Visualisers',
    })
    expect(
      softwareHeading.compareDocumentPosition(visualiserHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByText('Choose which visualisers appear when swiping.'),
    ).toBeInTheDocument()
    expect(switches).toHaveLength(5)
    expect(
      switches.every(
        (control) => control.getAttribute('aria-checked') === 'true',
      ),
    ).toBe(true)
    await user.click(screen.getByRole('switch', { name: /Golden Ratio/i }))
    expect(
      screen.getByRole('switch', { name: /Golden Ratio/i }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      JSON.parse(
        window.localStorage.getItem(VISUALISER_PREFERENCES_STORAGE_KEY) ?? '{}',
      ).enabled,
    ).not.toContain('golden-ratio')

    first.unmount()
    render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )
    expect(
      await screen.findByRole('switch', { name: /Golden Ratio/i }),
    ).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('switch', { name: /^Spectrum/i }))
    await user.click(screen.getByRole('switch', { name: /Particle Galaxy/i }))
    await user.click(screen.getByRole('switch', { name: /Frequency Waves/i }))
    const water = screen.getByRole('switch', { name: /^Water/i })
    expect(water).toBeDisabled()
    expect(water).toHaveAttribute('aria-checked', 'true')
  })

  it('starts an installable stable update and reports real installation stages', async () => {
    const installingStatus = {
      ...status,
      install_available: true,
      installing: true,
      stage: 'verifying',
      requested_version: '0.5.1',
      previous_version: '0.5.0',
      message: 'Verifying the release integrity manifest.',
    }
    let installing = false
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/system/updates/install')) {
        installing = true
        return response({ accepted: true, message: 'Update accepted.' })
      }
      if (url.endsWith('/api/system/updates')) {
        return response(
          installing
            ? installingStatus
            : { ...status, install_available: true },
        )
      }
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )

    const install = await screen.findByRole('button', {
      name: 'Update Software',
    })
    expect(install).toBeEnabled()
    await user.click(install)
    expect(await screen.findAllByText('Verifying')).toHaveLength(2)
    expect(
      screen.getByText(/screen may reconnect during restart/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/system/updates/install'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Pi-Jukebox-Action': 'install-stable-release' },
      }),
    )
    expect(window.sessionStorage.getItem(UPDATE_RELOAD_STORAGE_KEY)).toBe(
      '0.5.1',
    )
  })

  it('reloads presentation only for the release requested by this browser session', () => {
    const completed = {
      ...status,
      installed_version: '0.5.1',
      requested_version: '0.5.1',
      outcome: 'succeeded' as const,
      stage: 'complete',
    }
    expect(updateOutcomeNeedsReload(completed, '0.5.1')).toBe(true)
    expect(updateOutcomeNeedsReload(completed, null)).toBe(false)
    expect(updateOutcomeNeedsReload(completed, '0.5.2')).toBe(false)
  })

  it('shows a clear restored-version outcome after automatic rollback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          ...status,
          update_available: true,
          install_available: true,
          outcome: 'rolled_back',
          stage: 'complete',
          requested_version: '0.5.1',
          previous_version: '0.5.0',
          message: 'Update failed. Pi Jukebox was restored to 0.5.0.',
          last_error: 'The new release failed its health check.',
        }),
      ),
    )
    render(
      <DisplaySizeProvider>
        <SettingsScreen />
      </DisplaySizeProvider>,
    )

    expect(await screen.findByText('Restored 0.5.0')).toBeInTheDocument()
    expect(screen.getByText(/restored to 0.5.0/i)).toBeInTheDocument()
    expect(screen.getByText(/failed its health check/i)).toBeInTheDocument()
  })
})
