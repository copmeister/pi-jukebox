import { describe, expect, it } from 'vitest'
import type { SpectrumFrame } from '../api/types'
import {
  FREQUENCY_WAVE_COLOURS,
  FREQUENCY_WAVE_COMPONENT_OFFSETS,
  FREQUENCY_WAVE_DATA_INTERVAL_SECONDS,
  FREQUENCY_WAVE_EDGE_ENVELOPE,
  FREQUENCY_WAVE_MAX_HEIGHT_FRACTION,
  FREQUENCY_WAVE_MODES,
  FREQUENCY_WAVE_SAMPLE_RATIOS,
  createFrequencyWaveSampleMap,
  createFrequencyWavesRenderer,
  frequencyWaveAmplitude,
  frequencyWaveBasisValue,
  frequencyWaveDirection,
  frequencyWaveShapeValue,
  frequencyWaveSpatialEnvelope,
  frequencyWaveY,
  sampleFrequencyWaveComponents,
  updateFrequencyWaveComponents,
  updateFrequencyWaveLevels,
} from './FrequencyWavesCanvas'
import { createGoldenRegions, GOLDEN_RATIO_COLOURS } from './GoldenRatioCanvas'
import {
  GALAXY_MAX_PARTICLES,
  GALAXY_MAX_SHOCKWAVES,
} from './ParticleGalaxyCanvas'
import {
  GALAXY_BAND_EDGES,
  FREQUENCY_WAVES_BAND_EDGES,
  GOLDEN_RATIO_BAND_EDGES,
  mapFrameToLogicalBands,
  mergeHighestLogicalBands,
  SHARED_SIX_BAND_EDGES,
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
  it('registers all five modes with their intended logical band counts', () => {
    expect(
      VISUALISER_REGISTRY.map(({ id, name, logicalBandCount }) => ({
        id,
        name,
        logicalBandCount,
      })),
    ).toEqual([
      { id: 'spectrum', name: 'Spectrum', logicalBandCount: 24 },
      { id: 'golden-ratio', name: 'Golden Ratio', logicalBandCount: 6 },
      { id: 'particle-galaxy', name: 'Particle Galaxy', logicalBandCount: 6 },
      { id: 'water', name: 'Water', logicalBandCount: 6 },
      {
        id: 'frequency-waves',
        name: 'Frequency Waves',
        logicalBandCount: 6,
      },
    ])
    expect(DEFAULT_VISUALISER_PREFERENCES.enabled).toHaveLength(5)
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
    oneRemaining = setVisualiserEnabled(oneRemaining, 'frequency-waves', false)
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
    expect(
      cycleVisualiser('frequency-waves', disabledCurrent.enabled, 'next'),
    ).toBe('spectrum')
    expect(
      cycleVisualiser('spectrum', disabledCurrent.enabled, 'previous'),
    ).toBe('frequency-waves')

    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    saveVisualiserPreferences({ ...disabledCurrent, current: 'water' }, storage)
    expect(values.has(VISUALISER_PREFERENCES_STORAGE_KEY)).toBe(true)
    expect(loadVisualiserPreferences(storage).current).toBe('water')
  })

  it('migrates v1 preferences while enabling the new Frequency Waves mode', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          enabled: ['spectrum', 'water'],
          current: 'water',
        }),
    }
    expect(loadVisualiserPreferences(storage)).toEqual({
      enabled: ['spectrum', 'water', 'frequency-waves'],
      current: 'water',
    })
  })
})

describe('logical band mapping and renderer bounds', () => {
  it('shares six full-range bands and merges the legacy highest ranges', () => {
    expect(
      mapFrameToLogicalBands(frame, GOLDEN_RATIO_BAND_EDGES).levels,
    ).toHaveLength(6)
    expect(GOLDEN_RATIO_BAND_EDGES).toBe(FREQUENCY_WAVES_BAND_EDGES)
    expect(GOLDEN_RATIO_BAND_EDGES).toBe(SHARED_SIX_BAND_EDGES)
    expect(
      mergeHighestLogicalBands([45, 100, 200, 400, 800, 1_600, 3_200, 16_000]),
    ).toEqual([45, 100, 200, 400, 800, 1_600, 16_000])
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
    const mapped = mapFrameToLogicalBands(
      edgeFrame,
      GOLDEN_RATIO_BAND_EDGES,
    ).levels
    expect(mapped[0]).toBeGreaterThan(0)
    expect(mapped.at(-1)).toBeGreaterThan(0)
  })

  it('keeps six edge-filling golden regions without a black recursive hole', () => {
    const regions = createGoldenRegions(1280, 720)
    expect(regions).toHaveLength(6)
    expect(regions[0].width / regions[1].width).toBeCloseTo(
      (1 + Math.sqrt(5)) / 2,
      5,
    )
    for (let index = 1; index < regions.length; index += 1) {
      expect(
        Math.min(regions[index].width, regions[index].height),
      ).toBeLessThan(
        Math.min(regions[index - 1].width, regions[index - 1].height),
      )
    }
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
    const goldenHeight = Math.max(720, 1280 / ((1 + Math.sqrt(5)) / 2))
    expect(
      regions.reduce((area, region) => area + region.width * region.height, 0),
    ).toBeCloseTo(goldenHeight * goldenHeight * ((1 + Math.sqrt(5)) / 2), 5)
    expect(GALAXY_MAX_PARTICLES).toBeLessThanOrEqual(450)
    expect(GALAXY_MAX_SHOCKWAVES).toBe(8)
    expect(WATER_MAX_RIPPLES).toBe(28)
  })

  it('uses a deterministic bass-to-treble spectral colour progression', () => {
    expect(GOLDEN_RATIO_COLOURS).toEqual([
      '#ff3b30',
      '#ff8a1f',
      '#ffd83d',
      '#46d369',
      '#32b7e8',
      '#9b5cff',
    ])
    expect(FREQUENCY_WAVE_COLOURS).toBe(GOLDEN_RATIO_COLOURS)
  })
})

describe('Frequency Waves renderer', () => {
  it('settles all six silent bands to the exact centre line', () => {
    const levels = new Array<number>(6).fill(0)
    updateFrequencyWaveLevels(levels, new Array<number>(6).fill(0), 1 / 60)
    expect(levels).toEqual([0, 0, 0, 0, 0, 0])
    for (let band = 0; band < 6; band += 1) {
      const amplitude = frequencyWaveAmplitude(levels[band], 720)
      expect(amplitude).toBe(0)
      expect(frequencyWaveY(360, amplitude, 0.9)).toBe(360)
    }
  })

  it('interpolates continuously and consistently between sparse analyser updates', () => {
    const smoothFrames = new Array<number>(6).fill(0)
    const sparseFrames = new Array<number>(6).fill(0)
    const targets = new Array<number>(6).fill(1)
    let previous = 0
    for (let frameIndex = 0; frameIndex < 60; frameIndex += 1) {
      updateFrequencyWaveLevels(smoothFrames, targets, 1 / 60)
      expect(smoothFrames[0]).toBeGreaterThanOrEqual(previous)
      previous = smoothFrames[0]
    }
    expect(smoothFrames[0]).toBeGreaterThan(0.99)
    for (let update = 0; update < 10; update += 1)
      updateFrequencyWaveLevels(sparseFrames, targets, 0.1)
    expect(smoothFrames[0]).toBeCloseTo(sparseFrames[0], 5)

    for (let frameIndex = 0; frameIndex < 240; frameIndex += 1)
      updateFrequencyWaveLevels(
        smoothFrames,
        new Array<number>(6).fill(0),
        1 / 60,
      )
    expect(smoothFrames).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('responds within a short musical transition without a half-second tail', () => {
    const levels = new Float32Array(6)
    updateFrequencyWaveLevels(levels, new Float32Array(6).fill(1), 0.02)
    expect(levels[0]).toBeGreaterThan(0.79)
    const peak = levels[0]
    updateFrequencyWaveLevels(levels, new Float32Array(6), 0.05)
    expect(levels[0]).toBeLessThan(peak * 0.14)
  })

  it('uses two or more complete cycles with fixed standing-wave endpoints', () => {
    expect(FREQUENCY_WAVE_MODES).toEqual([4, 5, 6, 7, 8, 10])
    expect(FREQUENCY_WAVE_COMPONENT_OFFSETS).toEqual([0, 2, 4])
    expect(FREQUENCY_WAVE_SAMPLE_RATIOS).toEqual([0.25, 0.5, 0.75])
    for (let band = 0; band < 6; band += 1) {
      for (let component = 0; component < 3; component += 1) {
        expect(frequencyWaveBasisValue(band, component, 0)).toBe(0)
        expect(frequencyWaveBasisValue(band, component, 1)).toBeCloseTo(0, 10)
      }
      expect(frequencyWaveShapeValue(band, 0, [1, 1, 1])).toBeCloseTo(0, 10)
      expect(frequencyWaveShapeValue(band, 1, [1, 1, 1])).toBeCloseTo(0, 10)
    }
    expect(frequencyWaveBasisValue(0, 0, 0.125)).toBeCloseTo(1, 10)
    expect(frequencyWaveBasisValue(0, 0, 0.375)).toBeCloseTo(-1, 10)
  })

  it('samples three logarithmic quartiles per band using interpolation', () => {
    const map = createFrequencyWaveSampleMap(frame.band_centres_hz)
    expect(map.targetFrequencies).toHaveLength(18)
    expect(map.targetFrequencies[0]).toBeCloseTo(
      45 * Math.pow(100 / 45, 0.25),
      8,
    )
    expect(map.targetFrequencies[1]).toBeCloseTo(Math.sqrt(45 * 100), 8)
    expect(map.targetFrequencies[2]).toBeCloseTo(
      45 * Math.pow(100 / 45, 0.75),
      8,
    )
    for (let index = 0; index < map.targetFrequencies.length; index += 1) {
      const left = map.sourceCentres[map.leftIndices[index]]
      const right = map.sourceCentres[map.rightIndices[index]]
      expect(left).toBeLessThanOrEqual(map.targetFrequencies[index])
      expect(right).toBeGreaterThanOrEqual(map.targetFrequencies[index])
      expect(map.mixes[index]).toBeGreaterThanOrEqual(0)
      expect(map.mixes[index]).toBeLessThanOrEqual(1)
    }
  })

  it('derives eighteen bounded component energies without trace snapshots', () => {
    const map = createFrequencyWaveSampleMap(frame.band_centres_hz)
    const bassWeighted = {
      ...frame,
      levels: frame.levels.map((_, index) => Math.max(0, 16 - index)),
    }
    const trebleWeighted = {
      ...frame,
      levels: frame.levels.map((_, index) => Math.min(16, index)),
    }
    const bassComponents = new Float32Array(18)
    const trebleComponents = new Float32Array(18)
    sampleFrequencyWaveComponents(bassWeighted, map, bassComponents)
    sampleFrequencyWaveComponents(trebleWeighted, map, trebleComponents)

    expect(
      Array.from(bassComponents).every((value) => value >= 0 && value <= 1),
    ).toBe(true)
    expect(
      Array.from(trebleComponents).every((value) => value >= 0 && value <= 1),
    ).toBe(true)
    expect(Array.from(bassComponents)).not.toEqual(Array.from(trebleComponents))
    expect(FREQUENCY_WAVE_DATA_INTERVAL_SECONDS).toBeCloseTo(1 / 30)
  })

  it('smoothly reforms three equal-status positive components within one analyser update', () => {
    const components = new Float32Array(18)
    const targets = new Float32Array(18)
    targets[0] = 1
    targets[1] = 0.5
    targets[2] = 0.25
    updateFrequencyWaveComponents(components, targets, 1 / 30)
    expect(components[0]).toBeGreaterThan(0.85)
    expect(components[0]).toBeLessThan(1)
    expect(components[1]).toBeCloseTo(components[0] / 2, 5)
    expect(components[2]).toBeCloseTo(components[0] / 4, 5)

    const firstOnly = frequencyWaveShapeValue(0, 0.2, [1, 0, 0])
    const secondOnly = frequencyWaveShapeValue(0, 0.2, [0, 1, 0])
    const thirdOnly = frequencyWaveShapeValue(0, 0.2, [0, 0, 1])
    expect(new Set([firstOnly, secondOnly, thirdOnly]).size).toBe(3)
    expect(
      Math.abs(frequencyWaveShapeValue(0, 0.2, [1, 1, 1])),
    ).toBeLessThanOrEqual(1)
  })

  it('alternates initial direction while every wave rejoins at the right edge', () => {
    expect(frequencyWaveDirection(0)).toBe(-1)
    expect(frequencyWaveDirection(1)).toBe(1)
    expect(frequencyWaveDirection(2)).toBe(-1)
    expect(frequencyWaveShapeValue(0, 0.01, [1, 1, 1])).toBeLessThan(0)
    expect(frequencyWaveShapeValue(1, 0.01, [1, 1, 1])).toBeGreaterThan(0)
    for (let band = 0; band < 6; band += 1)
      expect(frequencyWaveShapeValue(band, 1, [1, 0.5, 0.25])).toBeCloseTo(
        0,
        10,
      )
  })

  it('gently favours the middle of the screen over the side lobes', () => {
    expect(FREQUENCY_WAVE_EDGE_ENVELOPE).toBe(0.3)
    expect(frequencyWaveSpatialEnvelope(0)).toBe(0.3)
    expect(frequencyWaveSpatialEnvelope(0.25)).toBeCloseTo(0.65, 10)
    expect(frequencyWaveSpatialEnvelope(0.5)).toBe(1)
    expect(frequencyWaveSpatialEnvelope(0.75)).toBeCloseTo(0.65, 10)
    expect(frequencyWaveSpatialEnvelope(1)).toBe(0.3)
  })

  it('uses a nonlinear near-full-height range without clipping the glow', () => {
    const quiet = frequencyWaveAmplitude(0.05, 720)
    const moderate = frequencyWaveAmplitude(0.5, 720)
    const loud = frequencyWaveAmplitude(1, 720)
    expect(quiet).toBeGreaterThan(0)
    expect(moderate).toBeGreaterThan(quiet)
    expect(loud).toBeGreaterThan(moderate)
    expect((loud * 2) / 720).toBeCloseTo(FREQUENCY_WAVE_MAX_HEIGHT_FRACTION)
    expect(loud).toBeLessThanOrEqual(360 - 14)
  })

  it('retains one disposable 60 fps renderer with cadence tolerance', () => {
    const renderer = createFrequencyWavesRenderer()
    expect(renderer.targetFps).toBe(60)
    expect(renderer.paintToleranceMs).toBe(1)
    expect(renderer.dispose).toBeTypeOf('function')
    renderer.dispose?.()
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
