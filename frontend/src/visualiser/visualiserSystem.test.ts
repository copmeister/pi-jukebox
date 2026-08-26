import { describe, expect, it } from 'vitest'
import type { SpectrumFrame } from '../api/types'
import {
  calculateConcentricSquareLayout,
  concentricSquareBandForLayer,
  concentricSquareBrightness,
  concentricSquareColourValue,
  concentricSquareLayer,
  concentricSquareTarget,
  CONCENTRIC_SQUARE_BAND_EDGES,
  CONCENTRIC_SQUARE_BLACK_THRESHOLD,
  CONCENTRIC_SQUARE_COLOURS,
  CONCENTRIC_SQUARE_COLUMNS,
  CONCENTRIC_SQUARE_LAYER_COUNT,
  CONCENTRIC_SQUARE_ROWS,
  cycleConcentricSquareColour,
  DEFAULT_CONCENTRIC_SQUARE_COLOUR,
  updateConcentricSquareLevels,
} from './concentricSquares'
import { createGoldenRegions, GOLDEN_RATIO_COLOURS } from './GoldenRatioCanvas'
import {
  GOLDEN_RATIO_BAND_EDGES,
  mapFrameToLogicalBands,
  mergeHighestLogicalBands,
  SHARED_SIX_BAND_EDGES,
} from './bandMapping'
import {
  applyVisualiserSensitivity,
  clampVisualiserSensitivity,
  VISUALISER_SENSITIVITY_MAX_DB,
  VISUALISER_SENSITIVITY_MIN_DB,
} from './sensitivity'
import {
  cycleSpectrumColourScheme,
  horizontalSwipeDirection,
  verticalSwipeDirection,
} from './spectrum'
import { VISUALISER_REGISTRY } from './visualiserRegistry'
import {
  cycleVisualiser,
  DEFAULT_VISUALISER_PREFERENCES,
  DEFAULT_VISUALISER_SENSITIVITY,
  loadVisualiserPreferences,
  saveVisualiserPreferences,
  setConcentricSquareColour,
  setVisualiserEnabled,
  setVisualiserSensitivity,
  VISUALISER_PREFERENCES_STORAGE_KEY,
} from './visualiserPreferences'

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
  it('contains only the three final visualisers in swipe order', () => {
    expect(
      VISUALISER_REGISTRY.map(({ id, name, logicalBandCount }) => ({
        id,
        name,
        logicalBandCount,
      })),
    ).toEqual([
      { id: 'spectrum', name: 'Spectrum', logicalBandCount: 24 },
      { id: 'golden-ratio', name: 'Golden Ratio', logicalBandCount: 6 },
      {
        id: 'concentric-squares',
        name: 'Concentric Squares',
        logicalBandCount: 9,
      },
    ])
    expect(DEFAULT_VISUALISER_PREFERENCES.enabled).toEqual([
      'spectrum',
      'golden-ratio',
      'concentric-squares',
    ])
  })

  it('skips disabled modes, wraps, and prevents disabling every mode', () => {
    const withoutGolden = setVisualiserEnabled(
      DEFAULT_VISUALISER_PREFERENCES,
      'golden-ratio',
      false,
    )
    expect(cycleVisualiser('spectrum', withoutGolden.enabled, 'next')).toBe(
      'concentric-squares',
    )
    expect(cycleVisualiser('spectrum', withoutGolden.enabled, 'previous')).toBe(
      'concentric-squares',
    )
    const onlySpectrum = setVisualiserEnabled(
      withoutGolden,
      'concentric-squares',
      false,
    )
    expect(onlySpectrum.enabled).toEqual(['spectrum'])
    expect(setVisualiserEnabled(onlySpectrum, 'spectrum', false)).toEqual(
      onlySpectrum,
    )
  })

  it('migrates earlier preferences into the final set and enables the new mode', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 2,
          enabled: ['spectrum', 'golden-ratio', 'retired-mode'],
          current: 'retired-mode',
        }),
    }
    expect(loadVisualiserPreferences(storage)).toEqual({
      enabled: ['spectrum', 'golden-ratio', 'concentric-squares'],
      current: 'spectrum',
      sensitivity: DEFAULT_VISUALISER_SENSITIVITY,
      concentricColour: DEFAULT_CONCENTRIC_SQUARE_COLOUR,
    })
  })

  it('persists current mode, colour, enabled modes, and independent sensitivity', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    let preferences = setVisualiserSensitivity(
      DEFAULT_VISUALISER_PREFERENCES,
      'spectrum',
      -3,
    )
    preferences = setVisualiserSensitivity(preferences, 'golden-ratio', 4)
    preferences = setConcentricSquareColour(preferences, 'magenta')
    preferences = { ...preferences, current: 'concentric-squares' }
    saveVisualiserPreferences(preferences, storage)

    expect(values.has(VISUALISER_PREFERENCES_STORAGE_KEY)).toBe(true)
    expect(loadVisualiserPreferences(storage)).toEqual(preferences)
    expect(preferences.sensitivity).toEqual({
      spectrum: -3,
      'golden-ratio': 4,
      'concentric-squares': 0,
    })
  })
})

describe('per-visualiser sensitivity', () => {
  it('uses safe defaults and a restrained user range', () => {
    expect(DEFAULT_VISUALISER_SENSITIVITY).toEqual({
      spectrum: 0,
      'golden-ratio': 2,
      'concentric-squares': 0,
    })
    expect(VISUALISER_SENSITIVITY_MIN_DB).toBe(-6)
    expect(VISUALISER_SENSITIVITY_MAX_DB).toBe(6)
    expect(clampVisualiserSensitivity(-99)).toBe(-6)
    expect(clampVisualiserSensitivity(99)).toBe(6)
  })

  it('raises or calms presentation without mutating source values', () => {
    const source = [0, 0.2, 0.5, 1]
    const original = [...source]
    expect(applyVisualiserSensitivity(source[1], 6)).toBeGreaterThan(source[1])
    expect(applyVisualiserSensitivity(source[2], -6)).toBeLessThan(source[2])
    expect(applyVisualiserSensitivity(source[2], 0)).toBe(source[2])
    expect(applyVisualiserSensitivity(0, 6)).toBe(0)
    expect(source).toEqual(original)
  })
})

describe('Golden Ratio mapping and geometry', () => {
  it('keeps six full-range deterministic spectral regions', () => {
    expect(
      mapFrameToLogicalBands(frame, GOLDEN_RATIO_BAND_EDGES).levels,
    ).toHaveLength(6)
    expect(GOLDEN_RATIO_BAND_EDGES).toBe(SHARED_SIX_BAND_EDGES)
    expect(
      mergeHighestLogicalBands([45, 100, 200, 400, 800, 1_600, 3_200, 16_000]),
    ).toEqual([45, 100, 200, 400, 800, 1_600, 16_000])
    expect(GOLDEN_RATIO_COLOURS).toEqual([
      '#ff3b30',
      '#ff8a1f',
      '#ffd83d',
      '#46d369',
      '#32b7e8',
      '#9b5cff',
    ])
  })

  it('keeps the existing six edge-filling golden regions', () => {
    const regions = createGoldenRegions(1280, 720)
    expect(regions).toHaveLength(6)
    expect(regions[0].width / regions[1].width).toBeCloseTo(
      (1 + Math.sqrt(5)) / 2,
      5,
    )
    expect(Math.min(...regions.map((region) => region.x))).toBeLessThanOrEqual(
      0,
    )
    expect(Math.min(...regions.map((region) => region.y))).toBeLessThanOrEqual(
      0,
    )
    expect(
      Math.max(...regions.map((region) => region.x + region.width)),
    ).toBeGreaterThanOrEqual(1280)
    expect(
      Math.max(...regions.map((region) => region.y + region.height)),
    ).toBeGreaterThanOrEqual(720)
  })
})

describe('Concentric Squares renderer model', () => {
  it('uses a centred 32 by 18 square-cell grid at 1280 by 720', () => {
    const layout = calculateConcentricSquareLayout(1280, 720)
    expect(layout.columns).toBe(CONCENTRIC_SQUARE_COLUMNS)
    expect(layout.rows).toBe(CONCENTRIC_SQUARE_ROWS)
    expect(layout.cellSize).toBe(37)
    expect(layout.gap).toBe(3)
    expect(layout.matrixWidth).toBe(1277)
    expect(layout.matrixHeight).toBe(717)
    expect(layout.matrixX).toBe(1)
    expect(layout.matrixY).toBe(1)
  })

  it('produces nine layers with bass in the centre and treble outside', () => {
    const layers = new Set<number>()
    for (let row = 0; row < CONCENTRIC_SQUARE_ROWS; row += 1) {
      for (let column = 0; column < CONCENTRIC_SQUARE_COLUMNS; column += 1)
        layers.add(concentricSquareLayer(column, row))
    }
    expect([...layers].sort((left, right) => left - right)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ])
    expect(CONCENTRIC_SQUARE_LAYER_COUNT).toBe(9)
    expect(CONCENTRIC_SQUARE_BAND_EDGES).toEqual([
      35, 70, 120, 220, 400, 750, 1_400, 2_800, 6_000, 14_000,
    ])
    expect(concentricSquareBandForLayer(8)).toBe(0)
    expect(concentricSquareBandForLayer(0)).toBe(8)
    expect(
      mapFrameToLogicalBands(frame, CONCENTRIC_SQUARE_BAND_EDGES).levels,
    ).toHaveLength(9)
  })

  it('is black when silent and brightens nonlinearly with activity', () => {
    expect(concentricSquareBrightness(0)).toBe(0)
    expect(concentricSquareBrightness(CONCENTRIC_SQUARE_BLACK_THRESHOLD)).toBe(
      0,
    )
    const quiet = concentricSquareBrightness(0.12)
    const active = concentricSquareBrightness(0.6)
    expect(quiet).toBeGreaterThan(0)
    expect(active).toBeGreaterThan(quiet)
    expect(concentricSquareBrightness(1)).toBe(1)
    expect(concentricSquareTarget(0.5, 8)).toBeGreaterThan(
      concentricSquareTarget(0.5, 0),
    )
  })

  it('uses fast attack, slower release, and settles silence to zero', () => {
    const levels = new Float32Array(9)
    updateConcentricSquareLevels(levels, new Float32Array(9).fill(0.8), 0.05)
    const peak = levels[0]
    expect(peak).toBeGreaterThan(0.6)
    updateConcentricSquareLevels(levels, new Float32Array(9), 0.05)
    expect(levels[0]).toBeGreaterThan(0)
    expect(levels[0]).toBeLessThan(peak)
    for (let frameIndex = 0; frameIndex < 240; frameIndex += 1)
      updateConcentricSquareLevels(levels, new Float32Array(9), 1 / 60)
    expect(Array.from(levels)).toEqual(new Array(9).fill(0))
  })

  it('uses one persistent solid colour and cycles it vertically', () => {
    expect(CONCENTRIC_SQUARE_COLOURS.map((colour) => colour.id)).toEqual([
      'cyan',
      'blue',
      'green',
      'magenta',
      'orange',
      'red',
      'white',
    ])
    expect(concentricSquareColourValue('cyan')).toBe('#20e8ef')
    expect(cycleConcentricSquareColour('cyan', 'next')).toBe('blue')
    expect(cycleConcentricSquareColour('cyan', 'previous')).toBe('white')
  })
})

describe('visualiser gestures', () => {
  it('keeps horizontal navigation and vertical presentation gestures distinct', () => {
    expect(horizontalSwipeDirection(-90, 5, 72)).toBe('left')
    expect(horizontalSwipeDirection(90, 5, 72)).toBe('right')
    expect(horizontalSwipeDirection(20, 100, 72)).toBeNull()
    expect(verticalSwipeDirection(5, -90, 72)).toBe('up')
    expect(verticalSwipeDirection(5, 90, 72)).toBe('down')
    expect(cycleSpectrumColourScheme('smooth', 'left')).toBe('classic')
    expect(cycleConcentricSquareColour('cyan', 'next')).toBe('blue')
  })
})
