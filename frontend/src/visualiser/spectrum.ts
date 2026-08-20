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

interface ColourStop {
  position: number
  red: number
  green: number
  blue: number
}

export type SpectrumColourScheme = 'classic' | 'smooth'
export type SwipeDirection = 'left' | 'right'

export const DEFAULT_SPECTRUM_COLOUR_SCHEME: SpectrumColourScheme = 'smooth'
export const SPECTRUM_COLOUR_SCHEME_STORAGE_KEY =
  'pi-jukebox:spectrum-colour-scheme'

const SPECTRUM_COLOUR_SCHEMES: readonly SpectrumColourScheme[] = [
  'classic',
  'smooth',
]

const TOP_DOWN_COLOUR_STOPS: readonly ColourStop[] = [
  { position: 0, red: 255, green: 59, blue: 48 },
  { position: 0.2, red: 255, green: 122, blue: 26 },
  { position: 0.4, red: 255, green: 212, blue: 59 },
  { position: 0.6, red: 85, green: 214, blue: 107 },
  { position: 0.8, red: 37, green: 203, blue: 224 },
  { position: 1, red: 49, green: 135, blue: 255 },
]

const CLASSIC_TOP_DOWN_COLOURS = TOP_DOWN_COLOUR_STOPS.map((stop) =>
  colourHex(stop),
)
const colourPaletteCache = new Map<string, readonly string[]>()

export function blockColourPalette(
  maximumLevels: number,
  scheme: SpectrumColourScheme = DEFAULT_SPECTRUM_COLOUR_SCHEME,
): readonly string[] {
  const safeLevels = Math.max(1, Math.floor(maximumLevels))
  const cacheKey = `${scheme}:${safeLevels}`
  const cached = colourPaletteCache.get(cacheKey)
  if (cached) return cached

  const palette = Array.from({ length: safeLevels }, (_, depthFromTop) => {
    const position = depthFromTop / Math.max(1, safeLevels - 1)
    if (scheme === 'classic') {
      const colourIndex = Math.min(
        CLASSIC_TOP_DOWN_COLOURS.length - 1,
        Math.ceil(position * (CLASSIC_TOP_DOWN_COLOURS.length - 1)),
      )
      return CLASSIC_TOP_DOWN_COLOURS[colourIndex]
    }
    return interpolatedColour(position)
  })
  colourPaletteCache.set(cacheKey, palette)
  return palette
}

export function cycleSpectrumColourScheme(
  current: SpectrumColourScheme,
  direction: SwipeDirection,
): SpectrumColourScheme {
  const currentIndex = SPECTRUM_COLOUR_SCHEMES.indexOf(current)
  const offset = direction === 'left' ? 1 : -1
  return SPECTRUM_COLOUR_SCHEMES[
    (currentIndex + offset + SPECTRUM_COLOUR_SCHEMES.length) %
      SPECTRUM_COLOUR_SCHEMES.length
  ]
}

export function horizontalSwipeDirection(
  horizontal: number,
  vertical: number,
  threshold: number,
): SwipeDirection | null {
  if (
    Math.abs(horizontal) < threshold ||
    Math.abs(horizontal) <= Math.abs(vertical) * 1.2
  ) {
    return null
  }
  return horizontal < 0 ? 'left' : 'right'
}

export function loadSpectrumColourScheme(
  storage?: Pick<Storage, 'getItem'> | null,
): SpectrumColourScheme {
  try {
    const availableStorage =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage
    const stored = availableStorage?.getItem(SPECTRUM_COLOUR_SCHEME_STORAGE_KEY)
    return stored === 'classic' || stored === 'smooth'
      ? stored
      : DEFAULT_SPECTRUM_COLOUR_SCHEME
  } catch {
    return DEFAULT_SPECTRUM_COLOUR_SCHEME
  }
}

export function saveSpectrumColourScheme(
  scheme: SpectrumColourScheme,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const availableStorage =
      storage === undefined
        ? typeof window === 'undefined'
          ? null
          : window.localStorage
        : storage
    availableStorage?.setItem(SPECTRUM_COLOUR_SCHEME_STORAGE_KEY, scheme)
  } catch {
    // The visual preference is optional; storage failure must stay harmless.
  }
}

function interpolatedColour(position: number): string {
  const safePosition = Math.min(1, Math.max(0, position))
  const upperIndex = TOP_DOWN_COLOUR_STOPS.findIndex(
    (stop) => stop.position >= safePosition,
  )
  if (upperIndex <= 0) return colourHex(TOP_DOWN_COLOUR_STOPS[0])
  const upper = TOP_DOWN_COLOUR_STOPS[upperIndex]
  const lower = TOP_DOWN_COLOUR_STOPS[upperIndex - 1]
  const fraction =
    (safePosition - lower.position) / (upper.position - lower.position)
  return colourHex({
    position: safePosition,
    red: lower.red + (upper.red - lower.red) * fraction,
    green: lower.green + (upper.green - lower.green) * fraction,
    blue: lower.blue + (upper.blue - lower.blue) * fraction,
  })
}

function colourHex(colour: ColourStop): string {
  return `#${[colour.red, colour.green, colour.blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}
