import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SleepScreen } from './SleepScreen'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('shows a 24-hour clock only and updates at the next minute boundary', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:34:30'))
  render(<SleepScreen onWake={vi.fn()} />)

  const clock = screen.getByText('12:34')
  expect(screen.queryByText('Bluetooth audio')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(29_999))
  expect(clock).toHaveTextContent('12:34')
  act(() => vi.advanceTimersByTime(1))
  expect(clock).toHaveTextContent('12:35')
})

it('shows only supplied playback information', () => {
  const { rerender } = render(
    <SleepScreen
      trackTitle="Northern Lights"
      trackArtist="Guest Vocalist"
      onWake={vi.fn()}
    />,
  )
  expect(screen.getByText('Northern Lights')).toBeInTheDocument()
  expect(screen.getByText('Guest Vocalist')).toBeInTheDocument()

  rerender(<SleepScreen bluetoothAudio onWake={vi.fn()} />)
  expect(screen.getByText('Bluetooth audio')).toBeInTheDocument()
  expect(screen.queryByText('Northern Lights')).not.toBeInTheDocument()
})
