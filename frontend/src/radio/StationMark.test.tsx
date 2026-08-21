import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StationMark } from './StationMark'
import { RADIO_STATIONS, type RadioStation } from './stations'

const fallbackStation: RadioStation = {
  id: 'fallback',
  name: 'Fallback Radio',
  streamUrl: 'https://example.test/radio.mp3',
  mark: 'FR',
  accent: '#ff0000',
}

describe('StationMark', () => {
  it('renders locally supplied station artwork', () => {
    const { container } = render(
      <StationMark
        station={{ ...fallbackStation, artwork: '/radio/station.svg' }}
      />,
    )

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/radio/station.svg',
    )
    expect(screen.queryByText('FR')).not.toBeInTheDocument()
  })

  it('renders the intentional fallback when artwork is absent or fails', () => {
    const { container, rerender } = render(
      <StationMark station={fallbackStation} />,
    )
    expect(screen.getByText('FR')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()

    rerender(
      <StationMark
        station={{ ...fallbackStation, artwork: '/radio/missing.png' }}
      />,
    )
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.error(image as HTMLImageElement)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('FR')).toBeInTheDocument()
  })

  it('renders every built-in station with the same fallback policy', () => {
    const { container } = render(
      <>
        {RADIO_STATIONS.map((station) => (
          <StationMark station={station} key={station.id} />
        ))}
      </>,
    )

    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.querySelectorAll('.radio-station__mark')).toHaveLength(6)
  })
})
