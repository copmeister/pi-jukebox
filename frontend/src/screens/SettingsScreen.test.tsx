import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DISPLAY_SIZE_STORAGE_KEY,
  DisplaySizeProvider,
} from '../display/DisplaySizeContext'
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
  message: 'Version 0.5.1 is available.',
  last_error: null,
  source: 'Authenticated GitHub Releases via the local GitHub CLI',
}

describe('Settings software updates', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
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
})
