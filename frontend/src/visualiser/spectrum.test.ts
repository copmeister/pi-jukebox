import { describe, expect, it } from 'vitest'
import {
  aggregateBands,
  blockColour,
  calculateMatrixLayout,
  parseSpectrumFrame,
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

  it('keeps every column top red while revealing cooler colours below', () => {
    expect(blockColour(0, 16)).toBe('#ff3b30')
    expect(blockColour(15, 16)).toBe('#3187ff')
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
