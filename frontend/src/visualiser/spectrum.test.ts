import { describe, expect, it } from 'vitest'
import {
  aggregateBands,
  blockColourPalette,
  calculateMatrixLayout,
  cycleSpectrumColourScheme,
  DEFAULT_SPECTRUM_COLOUR_SCHEME,
  horizontalSwipeDirection,
  loadSpectrumColourScheme,
  parseSpectrumFrame,
  saveSpectrumColourScheme,
  SPECTRUM_COLOUR_SCHEME_STORAGE_KEY,
  stepDisplayedLevels,
} from './spectrum'

describe('spectrum geometry and motion', () => {
  it('always computes true square cells and centres the matrix', () => {
    for (const [width, height] of [
      [1100, 390],
      [720, 300],
      [320, 250],
      [1280, 720],
    ]) {
      const layout = calculateMatrixLayout(width, height, 24, 16)
      expect(layout.cellSize).toBeGreaterThan(0)
      expect(layout.matrixWidth).toBe(
        layout.bandCount * layout.cellSize +
          (layout.bandCount - 1) * layout.gap,
      )
      expect(layout.matrixHeight).toBe(
        layout.levels * layout.cellSize + (layout.levels - 1) * layout.gap,
      )
      expect(layout.matrixX).toBe(Math.floor((width - layout.matrixWidth) / 2))
      expect(layout.matrixWidth).toBeLessThanOrEqual(width)
      expect(layout.matrixHeight).toBeLessThanOrEqual(height)
    }
  })

  it('uses extra fullscreen width for additional square display columns', () => {
    const layout = calculateMatrixLayout(1268, 708, 24, 16)
    expect(layout.bandCount).toBeGreaterThan(24)
    expect(layout.matrixX).toBeLessThanOrEqual(layout.cellSize + layout.gap)
    expect(layout.matrixY).toBeLessThanOrEqual(layout.cellSize + layout.gap)

    const expanded = aggregateBands(
      Array.from({ length: 24 }, (_, index) => index % 17),
      Array.from({ length: 24 }, (_, index) => 45 * 1.25 ** index),
      layout.bandCount,
    )
    expect(expanded.levels).toHaveLength(layout.bandCount)
    expect(expanded.frequencies).toHaveLength(layout.bandCount)
    expect(expanded.levels[0]).toBe(0)
    expect(expanded.levels.at(-1)).toBe(6)
  })

  it('reduces and aggregates bands on constrained viewports', () => {
    const narrow = calculateMatrixLayout(260, 250, 24, 16)
    expect(narrow.bandCount).toBeLessThan(24)
    const reduced = aggregateBands(
      Array.from({ length: 24 }, (_, index) => index),
      Array.from({ length: 24 }, (_, index) => 45 * 1.25 ** index),
      narrow.bandCount,
    )
    expect(reduced.levels).toHaveLength(narrow.bandCount)
    expect(reduced.frequencies).toHaveLength(narrow.bandCount)
    expect(Math.max(...reduced.levels)).toBe(23)
  })

  it('moves by at most one visible block per rendered frame', () => {
    const displayed = [3, 12]
    const credit: number[] = []
    stepDisplayedLevels(displayed, [12, 5], 0.1, 60, 60, credit)
    expect(displayed).toEqual([4, 11])
    stepDisplayedLevels(displayed, [12, 5], 0.1, 60, 60, credit)
    expect(displayed).toEqual([5, 10])
  })

  it('precomputes one cached, distinct colour for every level', () => {
    const colours = blockColourPalette(16)
    expect(colours).toBe(blockColourPalette(16))
    expect(colours).toHaveLength(16)
    expect(colours[0]).toBe('#ff3b30')
    expect(new Set(colours).size).toBe(16)
  })

  it('uses the same fixed top-down sequence for every column height', () => {
    const colours = blockColourPalette(16)
    const unlit = colours.slice(0, 0)
    const oneBlock = colours.slice(0, 1)
    const shortColumn = colours.slice(0, 4)
    const mediumColumn = colours.slice(0, 8)
    const fullColumn = colours.slice(0, 16)

    expect(unlit).toEqual([])
    expect(oneBlock).toEqual(['#ff3b30'])
    expect(shortColumn).toEqual(['#ff3b30', '#ff5029', '#ff6521', '#ff7a1a'])
    expect(mediumColumn.slice(0, shortColumn.length)).toEqual(shortColumn)
    expect(fullColumn.slice(0, mediumColumn.length)).toEqual(mediumColumn)
  })

  it('spans the full smooth spectrum only when all levels are visible', () => {
    const colours = blockColourPalette(16)
    expect(colours[0]).toBe('#ff3b30')
    expect(colours[3]).toBe('#ff7a1a')
    expect(colours[6]).toBe('#ffd43b')
    expect(colours[9]).toBe('#55d66b')
    expect(colours[12]).toBe('#25cbe0')
    expect(colours[15]).toBe('#3187ff')
  })

  it('recreates the original grouped classic palette', () => {
    const colours = blockColourPalette(16, 'classic')
    expect(colours).toHaveLength(16)
    expect(new Set(colours)).toEqual(
      new Set([
        '#ff3b30',
        '#ff7a1a',
        '#ffd43b',
        '#55d66b',
        '#25cbe0',
        '#3187ff',
      ]),
    )
    expect(colours[0]).toBe('#ff3b30')
  })

  it('cycles either swipe direction and rejects short or vertical gestures', () => {
    expect(cycleSpectrumColourScheme('classic', 'left')).toBe('smooth')
    expect(cycleSpectrumColourScheme('smooth', 'left')).toBe('classic')
    expect(cycleSpectrumColourScheme('classic', 'right')).toBe('smooth')
    expect(cycleSpectrumColourScheme('smooth', 'right')).toBe('classic')
    expect(horizontalSwipeDirection(-80, 5, 72)).toBe('left')
    expect(horizontalSwipeDirection(80, 5, 72)).toBe('right')
    expect(horizontalSwipeDirection(60, 2, 72)).toBeNull()
    expect(horizontalSwipeDirection(80, 75, 72)).toBeNull()
  })

  it('persists a valid scheme and safely falls back for invalid storage', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    expect(loadSpectrumColourScheme(storage)).toBe(
      DEFAULT_SPECTRUM_COLOUR_SCHEME,
    )
    saveSpectrumColourScheme('classic', storage)
    expect(values.get(SPECTRUM_COLOUR_SCHEME_STORAGE_KEY)).toBe('classic')
    expect(loadSpectrumColourScheme(storage)).toBe('classic')
    values.set(SPECTRUM_COLOUR_SCHEME_STORAGE_KEY, 'unknown')
    expect(loadSpectrumColourScheme(storage)).toBe(
      DEFAULT_SPECTRUM_COLOUR_SCHEME,
    )
  })

  it('rejects malformed or out-of-range stream frames', () => {
    const valid = {
      sequence: 1,
      status: 'ready',
      message: 'Live',
      band_centres_hz: [60, 120, 240, 480],
      levels: [0, 4, 8, 16],
      max_levels: 16,
      rise_rate: 48,
      fall_rate: 36,
    }
    expect(parseSpectrumFrame(valid)).toEqual(valid)
    expect(parseSpectrumFrame({ ...valid, levels: [17, 0, 0, 0] })).toBeNull()
  })
})
