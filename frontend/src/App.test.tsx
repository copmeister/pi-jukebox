import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('keeps the mini-player visible while navigating between placeholder screens', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Your music, ready when you are.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Queue' }))

    expect(screen.getByRole('heading', { name: 'Queue' })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Mini player' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
