import type { SpectrumFrame } from '../api/types'

export const DEFAULT_RISE_RATE = 48
export const DEFAULT_FALL_RATE = 36
export const MIN_COMFORTABLE_CELL_SIZE = 12

export interface MatrixLayout {
  bandCount: number
  levels: number
  cellSize: number
  gap: number
  matrixX: number
  matrixY: number
  matrixWidth: number
  matrixHeight: number
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseSpectrumFrame(value: unknown): SpectrumFrame | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const frame = value as Record<string, unknown>
  if (
    !Number.isInteger(frame.sequence) ||
    !['starting', 'ready', 'unavailable'].includes(String(frame.status)) ||
    typeof frame.message !== 'string' ||
    !Number.isInteger(frame.max_levels) ||
    Number(frame.max_levels) < 2 ||
    !finiteNumber(frame.rise_rate) ||
    Number(frame.rise_rate) <= 0 ||
    !finiteNumber(frame.fall_rate) ||
    Number(frame.fall_rate) <= 0 ||
    !Array.isArray(frame.band_centres_hz) ||
    !Array.isArray(frame.levels) ||
    frame.band_centres_hz.length !== frame.levels.length ||
    frame.band_centres_hz.length < 4 ||
    !frame.band_centres_hz.every(
      (frequency) => finiteNumber(frequency) && frequency > 0,
    ) ||
    !frame.levels.every(
      (level) =>
        Number.isInteger(level) &&
        Number(level) >= 0 &&
        Number(level) <= Number(frame.max_levels),
    )
  )
    return null
  return frame as unknown as SpectrumFrame
}

export function calculateMatrixLayout(
  width: number,
  height: number,
  requestedBands: number,
  levels: number,
): MatrixLayout {
  const safeWidth = Math.max(1, Math.floor(width))
  const safeHeight = Math.max(1, Math.floor(height))
  const safeLevels = Math.max(2, Math.floor(levels))
  const sourceBands = Math.max(4, Math.floor(requestedBands))
  const desiredBands = Math.min(
    sourceBands * 2,
    Math.max(4, Math.round((safeWidth / safeHeight) * safeLevels)),
  )
  let chosen = matrixDimensions(safeWidth, safeHeight, desiredBands, safeLevels)

  for (
    let bands = desiredBands - 1;
    bands >= Math.min(12, sourceBands);
    bands -= 1
  ) {
    if (chosen.cellSize >= MIN_COMFORTABLE_CELL_SIZE) break
    chosen = matrixDimensions(safeWidth, safeHeight, bands, safeLevels)
  }

  return {
    bandCount: chosen.bandCount,
    levels: safeLevels,
    cellSize: chosen.cellSize,
    gap: chosen.gap,
    matrixX: Math.floor((safeWidth - chosen.matrixWidth) / 2),
    matrixY: Math.max(0, Math.floor((safeHeight - chosen.matrixHeight) / 2)),
    matrixWidth: chosen.matrixWidth,
    matrixHeight: chosen.matrixHeight,
  }
}

function matrixDimensions(
  width: number,
  height: number,
  bandCount: number,
  levels: number,
) {
  let gap = 2
  let cellSize: number
  for (let pass = 0; pass < 3; pass += 1) {
    cellSize = Math.max(
      1,
      Math.floor(
        Math.min(
          (width - gap * (bandCount - 1)) / bandCount,
          (height - gap * (levels - 1)) / levels,
        ),
      ),
    )
    gap = Math.max(2, Math.floor(cellSize * 0.28))
  }
  cellSize = Math.max(
    1,
    Math.floor(
      Math.min(
        (width - gap * (bandCount - 1)) / bandCount,
        (height - gap * (levels - 1)) / levels,
      ),
    ),
  )
  return {
    bandCount,
    cellSize,
    gap,
    matrixWidth: bandCount * cellSize + (bandCount - 1) * gap,
    matrixHeight: levels * cellSize + (levels - 1) * gap,
  }
}

export function aggregateBands(
  levels: readonly number[],
  frequencies: readonly number[],
  outputCount: number,
): { levels: number[]; frequencies: number[] } {
  if (outputCount === levels.length)
    return { levels: [...levels], frequencies: [...frequencies] }
  if (outputCount > levels.length) {
    const outputLevels: number[] = []
    const outputFrequencies: number[] = []
    for (let output = 0; output < outputCount; output += 1) {
      const position = (output * (levels.length - 1)) / (outputCount - 1)
      const left = Math.floor(position)
      const right = Math.min(levels.length - 1, Math.ceil(position))
      const fraction = position - left
      outputLevels.push(
        Math.round(levels[left] + (levels[right] - levels[left]) * fraction),
      )
      outputFrequencies.push(
        Math.exp(
          Math.log(frequencies[left]) +
            (Math.log(frequencies[right]) - Math.log(frequencies[left])) *
              fraction,
        ),
      )
    }
    return { levels: outputLevels, frequencies: outputFrequencies }
  }
  const outputLevels: number[] = []
  const outputFrequencies: number[] = []
  for (let output = 0; output < outputCount; output += 1) {
    const start = Math.floor((output * levels.length) / outputCount)
    const end = Math.max(
      start + 1,
      Math.floor(((output + 1) * levels.length) / outputCount),
    )
    outputLevels.push(Math.max(...levels.slice(start, end)))
    const frequencySlice = frequencies.slice(start, end)
    const logMean =
      frequencySlice.reduce((sum, value) => sum + Math.log(value), 0) /
      frequencySlice.length
    outputFrequencies.push(Math.exp(logMean))
  }
  return { levels: outputLevels, frequencies: outputFrequencies }
}

export function stepDisplayedLevels(
  displayed: number[],
  targets: readonly number[],
  elapsedSeconds: number,
  riseRate = DEFAULT_RISE_RATE,
  fallRate = DEFAULT_FALL_RATE,
  credit: number[] = [],
): number[] {
  for (let index = 0; index < targets.length; index += 1) {
    displayed[index] ??= 0
    credit[index] ??= 0
    const direction = Math.sign(targets[index] - displayed[index])
    if (direction === 0) {
      credit[index] = 0
      continue
    }
    credit[index] += elapsedSeconds * (direction > 0 ? riseRate : fallRate)
    if (credit[index] >= 1) {
      displayed[index] += direction
      credit[index] -= 1
    }
  }
  displayed.length = targets.length
  credit.length = targets.length
  return displayed
}

const TOP_DOWN_COLOURS = [
  '#ff3b30',
  '#ff7a1a',
  '#ffd43b',
  '#55d66b',
  '#25cbe0',
  '#3187ff',
]

export function blockColour(
  depthFromTop: number,
  maximumLevels: number,
): string {
  const ratio = Math.min(
    1,
    Math.max(0, depthFromTop / Math.max(1, maximumLevels - 1)),
  )
  const index = Math.min(
    TOP_DOWN_COLOURS.length - 1,
    Math.ceil(ratio * (TOP_DOWN_COLOURS.length - 1)),
  )
  return TOP_DOWN_COLOURS[index]
}
