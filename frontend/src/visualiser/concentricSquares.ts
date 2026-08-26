export const CONCENTRIC_SQUARE_COLUMNS = 32
export const CONCENTRIC_SQUARE_ROWS = 18
export const CONCENTRIC_SQUARE_LAYER_COUNT = 9
export const CONCENTRIC_SQUARE_BAND_EDGES = [
  35, 70, 120, 220, 400, 750, 1_400, 2_800, 6_000, 14_000,
] as const

export const CONCENTRIC_SQUARE_COLOURS = [
  { id: 'cyan', name: 'Cyan', value: '#20e8ef' },
  { id: 'blue', name: 'Blue', value: '#3685ff' },
  { id: 'green', name: 'Green', value: '#43df78' },
  { id: 'magenta', name: 'Magenta', value: '#f04dcd' },
  { id: 'orange', name: 'Orange', value: '#ff982f' },
  { id: 'red', name: 'Red', value: '#ff4a42' },
  { id: 'white', name: 'White', value: '#f5f8ff' },
] as const

export type ConcentricSquareColour =
  (typeof CONCENTRIC_SQUARE_COLOURS)[number]['id']

export const DEFAULT_CONCENTRIC_SQUARE_COLOUR: ConcentricSquareColour = 'cyan'
export const CONCENTRIC_SQUARE_BLACK_THRESHOLD = 0.055
export const CONCENTRIC_SQUARE_ATTACK_RATE = 34
export const CONCENTRIC_SQUARE_RELEASE_RATE = 8

const HIGH_FREQUENCY_COMPENSATION = [
  1, 1, 1.02, 1.05, 1.08, 1.12, 1.16, 1.2, 1.24,
] as const

export interface ConcentricSquareLayout {
  columns: number
  rows: number
  cellSize: number
  gap: number
  matrixX: number
  matrixY: number
  matrixWidth: number
  matrixHeight: number
}

export function calculateConcentricSquareLayout(
  width: number,
  height: number,
): ConcentricSquareLayout {
  const safeWidth = Math.max(1, Math.floor(width))
  const safeHeight = Math.max(1, Math.floor(height))
  const pitch = Math.min(
    safeWidth / CONCENTRIC_SQUARE_COLUMNS,
    safeHeight / CONCENTRIC_SQUARE_ROWS,
  )
  const gap = Math.max(2, Math.floor(pitch * 0.08))
  const cellSize = Math.max(
    1,
    Math.floor(
      Math.min(
        (safeWidth - gap * (CONCENTRIC_SQUARE_COLUMNS - 1)) /
          CONCENTRIC_SQUARE_COLUMNS,
        (safeHeight - gap * (CONCENTRIC_SQUARE_ROWS - 1)) /
          CONCENTRIC_SQUARE_ROWS,
      ),
    ),
  )
  const matrixWidth =
    CONCENTRIC_SQUARE_COLUMNS * cellSize + (CONCENTRIC_SQUARE_COLUMNS - 1) * gap
  const matrixHeight =
    CONCENTRIC_SQUARE_ROWS * cellSize + (CONCENTRIC_SQUARE_ROWS - 1) * gap
  return {
    columns: CONCENTRIC_SQUARE_COLUMNS,
    rows: CONCENTRIC_SQUARE_ROWS,
    cellSize,
    gap,
    matrixX: Math.floor((safeWidth - matrixWidth) / 2),
    matrixY: Math.floor((safeHeight - matrixHeight) / 2),
    matrixWidth,
    matrixHeight,
  }
}

export function concentricSquareLayer(column: number, row: number): number {
  return Math.min(
    column,
    row,
    CONCENTRIC_SQUARE_COLUMNS - 1 - column,
    CONCENTRIC_SQUARE_ROWS - 1 - row,
  )
}

export function concentricSquareBandForLayer(layer: number): number {
  return CONCENTRIC_SQUARE_LAYER_COUNT - 1 - layer
}

export function concentricSquareTarget(level: number, band: number): number {
  const safeBand = Math.min(
    CONCENTRIC_SQUARE_LAYER_COUNT - 1,
    Math.max(0, Math.floor(band)),
  )
  return Math.min(1, Math.max(0, level) * HIGH_FREQUENCY_COMPENSATION[safeBand])
}

export function concentricSquareBrightness(level: number): number {
  if (level <= CONCENTRIC_SQUARE_BLACK_THRESHOLD) return 0
  const active =
    (Math.min(1, level) - CONCENTRIC_SQUARE_BLACK_THRESHOLD) /
    (1 - CONCENTRIC_SQUARE_BLACK_THRESHOLD)
  return Math.pow(active, 1.75)
}

export function updateConcentricSquareLevels(
  levels: Float32Array,
  targets: ArrayLike<number>,
  deltaSeconds: number,
): void {
  const elapsed = Math.max(0, deltaSeconds)
  for (let band = 0; band < levels.length; band += 1) {
    const target = concentricSquareTarget(targets[band] ?? 0, band)
    const rate =
      target > levels[band]
        ? CONCENTRIC_SQUARE_ATTACK_RATE
        : CONCENTRIC_SQUARE_RELEASE_RATE
    levels[band] += (target - levels[band]) * (1 - Math.exp(-rate * elapsed))
    if (target === 0 && levels[band] < CONCENTRIC_SQUARE_BLACK_THRESHOLD / 4)
      levels[band] = 0
  }
}

export function concentricSquareColourValue(
  colour: ConcentricSquareColour,
): string {
  return (
    CONCENTRIC_SQUARE_COLOURS.find((option) => option.id === colour)?.value ??
    CONCENTRIC_SQUARE_COLOURS[0].value
  )
}

export function isConcentricSquareColour(
  value: unknown,
): value is ConcentricSquareColour {
  return CONCENTRIC_SQUARE_COLOURS.some((option) => option.id === value)
}

export function cycleConcentricSquareColour(
  current: ConcentricSquareColour,
  direction: 'next' | 'previous',
): ConcentricSquareColour {
  const index = Math.max(
    0,
    CONCENTRIC_SQUARE_COLOURS.findIndex((option) => option.id === current),
  )
  const offset = direction === 'next' ? 1 : -1
  return CONCENTRIC_SQUARE_COLOURS[
    (index + offset + CONCENTRIC_SQUARE_COLOURS.length) %
      CONCENTRIC_SQUARE_COLOURS.length
  ].id
}
