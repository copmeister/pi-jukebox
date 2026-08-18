import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    render(<SettingsScreen />)

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
})
