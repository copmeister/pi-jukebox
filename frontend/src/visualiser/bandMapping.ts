import type { SpectrumFrame } from '../api/types'

const LEGACY_SEVEN_BAND_EDGES = logarithmicEdges(45, 100, 16_000, 7)

export function mergeHighestLogicalBands(edges: readonly number[]): number[] {
  if (edges.length < 4) return [...edges]
  return [...edges.slice(0, -2), edges.at(-1) as number]
}

export const SHARED_SIX_BAND_EDGES = mergeHighestLogicalBands(
  LEGACY_SEVEN_BAND_EDGES,
)
export const SHARED_SIX_BAND_COLOURS = [
  '#ff3b30',
  '#ff8a1f',
  '#ffd83d',
  '#46d369',
  '#32b7e8',
  '#9b5cff',
] as const
export const GOLDEN_RATIO_BAND_EDGES = SHARED_SIX_BAND_EDGES

export interface LogicalBandFrame {
  levels: number[]
  centresHz: number[]
}

export function mapFrameToLogicalBands(
  frame: SpectrumFrame,
  targetEdges: readonly number[],
): LogicalBandFrame {
  if (targetEdges.length < 2) return { levels: [], centresHz: [] }
  const sourceEdges = inferredSourceEdges(frame.band_centres_hz)
  const normaliser = Math.max(1, frame.max_levels)
  const levels: number[] = []
  const centresHz: number[] = []

  for (let target = 0; target < targetEdges.length - 1; target += 1) {
    const low = targetEdges[target]
    const high = targetEdges[target + 1]
    let weightedSquares = 0
    let totalWeight = 0

    for (let source = 0; source < frame.levels.length; source += 1) {
      const overlapLow = Math.max(low, sourceEdges[source])
      const overlapHigh = Math.min(high, sourceEdges[source + 1])
      if (overlapHigh <= overlapLow) continue
      const weight = Math.log(overlapHigh / overlapLow)
      const level = frame.levels[source] / normaliser
      weightedSquares += level * level * weight
      totalWeight += weight
    }

    if (totalWeight > 0) {
      levels.push(Math.min(1, Math.sqrt(weightedSquares / totalWeight)))
    } else {
      const centre = Math.sqrt(low * high)
      const nearest = nearestFrequencyIndex(frame.band_centres_hz, centre)
      levels.push(Math.min(1, frame.levels[nearest] / normaliser))
    }
    centresHz.push(Math.sqrt(low * high))
  }
  return { levels, centresHz }
}

function logarithmicEdges(
  minimum: number,
  bassBoundary: number,
  maximum: number,
  bandCount: number,
): number[] {
  const edges = [minimum]
  const remainingEdges = bandCount
  for (let index = 0; index < remainingEdges; index += 1) {
    const ratio = index / Math.max(1, remainingEdges - 1)
    edges.push(bassBoundary * Math.pow(maximum / bassBoundary, ratio))
  }
  return edges
}

function inferredSourceEdges(centres: readonly number[]): number[] {
  if (centres.length === 1) return [centres[0] / 1.5, centres[0] * 1.5]
  const edges = [centres[0] / Math.sqrt(centres[1] / centres[0])]
  for (let index = 1; index < centres.length; index += 1) {
    edges.push(Math.sqrt(centres[index - 1] * centres[index]))
  }
  const last = centres.length - 1
  edges.push(centres[last] * Math.sqrt(centres[last] / centres[last - 1]))
  return edges
}

function nearestFrequencyIndex(
  frequencies: readonly number[],
  target: number,
): number {
  let nearest = 0
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < frequencies.length; index += 1) {
    const candidate = Math.abs(Math.log(frequencies[index] / target))
    if (candidate < distance) {
      nearest = index
      distance = candidate
    }
  }
  return nearest
}
