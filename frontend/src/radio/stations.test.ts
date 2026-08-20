import { describe, expect, it } from 'vitest'
import { RADIO_STATIONS, radioStationById } from './stations'

describe('curated radio catalogue', () => {
  it('keeps stable unique station metadata and HTTPS stream URLs', () => {
    expect(RADIO_STATIONS).toHaveLength(6)
    expect(new Set(RADIO_STATIONS.map((station) => station.id)).size).toBe(
      RADIO_STATIONS.length,
    )
    for (const station of RADIO_STATIONS) {
      expect(station.name).not.toBe('')
      expect(station.mark).not.toBe('')
      expect(new URL(station.streamUrl).protocol).toBe('https:')
      expect(radioStationById(station.id)).toBe(station)
    }
  })

  it('contains only the streams verified for this first release', () => {
    expect(RADIO_STATIONS.map((station) => station.name)).toEqual([
      'Classic FM',
      'Classic FM Movies',
      'Smooth Radio',
      'Heart',
      'Capital',
      'LBC',
    ])
  })
})
