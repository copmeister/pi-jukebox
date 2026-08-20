import { describe, expect, it } from 'vitest'
import type { SpectrumFrame } from '../api/types'
import { createGoldenSquares } from './GoldenRatioCanvas'
import {
  GALAXY_MAX_PARTICLES,
  GALAXY_MAX_SHOCKWAVES,
} from './ParticleGalaxyCanvas'
import {
  GALAXY_BAND_EDGES,
  GOLDEN_RATIO_BAND_EDGES,
  mapFrameToLogicalBands,
  WATER_BAND_EDGES,
} from './bandMapping'
import {
  cycleSpectrumColourScheme,
  horizontalSwipeDirection,
  verticalSwipeDirection,
} from './spectrum'
import { VISUALISER_REGISTRY } from './visualiserRegistry'
import {
  cycleVisualiser,
  DEFAULT_VISUALISER_PREFERENCES,
  loadVisualiserPreferences,
  saveVisualiserPreferences,
  setVisualiserEnabled,
  VISUALISER_PREFERENCES_STORAGE_KEY,
} from './visualiserPreferences'
import { WATER_MAX_RIPPLES } from './WaterCanvas'

const frame: SpectrumFrame = {
  sequence: 1,
  status: 'ready',
  message: 'Live',
  band_centres_hz: Array.from(
    { length: 24 },
    (_, index) => 45 * Math.pow(16_000 / 45, (index + 0.5) / 24),
  ),
  levels: Array.from({ length: 24 }, (_, index) => (index * 7) % 17),
  max_levels: 16,
  rise_rate: 48,
  fall_rate: 36,
}

describe('visualiser registry and preferences', () => {
  it('registers all four modes with their intended logical band counts', () => {
    expect(
      VISUALISER_REGISTRY.map(({ id, name, logicalBandCount }) => ({
        id,
        name,
        logicalBandCount,
      })),
    ).toEqual([
      { id: 'spectrum', name: 'Spectrum', logicalBandCount: 24 },
      { id: 'golden-ratio', name: 'Golden Ratio', logicalBandCount: 8 },
      { id: 'particle-galaxy', name: 'Particle Galaxy', logicalBandCount: 6 },
      { id: 'water', name: 'Water', logicalBandCount: 6 },
    ])
    expect(DEFAULT_VISUALISER_PREFERENCES.enabled).toHaveLength(4)
  })

  it('removes disabled modes from rotation and prevents disabling all modes', () => {
    const withoutGolden = setVisualiserEnabled(
      DEFAULT_VISUALISER_PREFERENCES,
      'golden-ratio',
      false,
    )
    expect(withoutGolden.enabled).not.toContain('golden-ratio')
    expect(cycleVisualiser('spectrum', withoutGolden.enabled, 'next')).toBe(
      'particle-galaxy',
    )

    let oneRemaining = withoutGolden
    oneRemaining = setVisualiserEnabled(oneRemaining, 'particle-galaxy', false)
    oneRemaining = setVisualiserEnabled(oneRemaining, 'water', false)
    expect(oneRemaining.enabled).toEqual(['spectrum'])
    expect(setVisualiserEnabled(oneRemaining, 'spectrum', false)).toEqual(
      oneRemaining,
    )
  })

  it('falls forward safely, wraps in both directions and persists current mode', () => {
    const starting = {
      enabled: [...DEFAULT_VISUALISER_PREFERENCES.enabled],
      current: 'golden-ratio' as const,
    }
    const disabledCurrent = setVisualiserEnabled(
      starting,
      'golden-ratio',
      false,
    )
    expect(disabledCurrent.current).toBe('particle-galaxy')
    expect(cycleVisualiser('water', disabledCurrent.enabled, 'next')).toBe(
      'spectrum',
    )
    expect(
      cycleVisualiser('spectrum', disabledCurrent.enabled, 'previous'),
    ).toBe('water')

    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    saveVisualiserPreferences({ ...disabledCurrent, current: 'water' }, storage)
    expect(values.has(VISUALISER_PREFERENCES_STORAGE_KEY)).toBe(true)
    expect(loadVisualiserPreferences(storage).current).toBe('water')
  })
})

describe('logical band mapping and renderer bounds', () => {
  it('maps the existing logarithmic analyser data to 8/6/6 full-range bands', () => {
    expect(
      mapFrameToLogicalBands(frame, GOLDEN_RATIO_BAND_EDGES).levels,
    ).toHaveLength(8)
    expect(
      mapFrameToLogicalBands(frame, GALAXY_BAND_EDGES).levels,
    ).toHaveLength(6)
    expect(mapFrameToLogicalBands(frame, WATER_BAND_EDGES).levels).toHaveLength(
      6,
    )

    const edgeFrame = {
      ...frame,
      levels: frame.levels.map((_, index) =>
        index === 0 || index === frame.levels.length - 1 ? 16 : 0,
      ),
    }
    const mapped = mapFrameToLogicalBands(edgeFrame, GALAXY_BAND_EDGES).levels
    expect(mapped[0]).toBeGreaterThan(0)
    expect(mapped.at(-1)).toBeGreaterThan(0)
  })

  it('keeps genuine decreasing golden squares and bounded complex renderers', () => {
    const squares = createGoldenSquares(1280, 720)
    expect(squares).toHaveLength(8)
    expect(squares[0].side / squares[1].side).toBeCloseTo(
      (1 + Math.sqrt(5)) / 2,
      5,
    )
    for (let index = 1; index < squares.length; index += 1) {
      expect(squares[index].side).toBeLessThan(squares[index - 1].side)
    }
    expect(GALAXY_MAX_PARTICLES).toBeLessThanOrEqual(450)
    expect(GALAXY_MAX_SHOCKWAVES).toBe(8)
    expect(WATER_MAX_RIPPLES).toBe(28)
  })
})

describe('visualiser gestures', () => {
  it('uses horizontal swipes for modes and vertical swipes for Spectrum colours', () => {
    expect(horizontalSwipeDirection(-90, 5, 72)).toBe('left')
    expect(horizontalSwipeDirection(90, 5, 72)).toBe('right')
    expect(horizontalSwipeDirection(40, 2, 72)).toBeNull()
    expect(horizontalSwipeDirection(20, 100, 72)).toBeNull()
    expect(verticalSwipeDirection(5, -90, 72)).toBe('up')
    expect(verticalSwipeDirection(5, 90, 72)).toBe('down')
    expect(cycleSpectrumColourScheme('smooth', 'left')).toBe('classic')
  })
})
