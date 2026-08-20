/* eslint-disable react-refresh/only-export-components -- geometry is exported for deterministic tests */
import { useCallback } from 'react'
import type { SpectrumFrame } from '../api/types'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
  type CanvasRendererFrame,
} from './AudioReactiveCanvas'
import { GOLDEN_RATIO_BAND_EDGES } from './bandMapping'

const PHI = (1 + Math.sqrt(5)) / 2
const SQUARE_COUNT = 8
const BLACK_THRESHOLD = 0.12

interface GoldenSquare {
  x: number
  y: number
  side: number
}

export function GoldenRatioCanvas({
  frame,
  onFailure,
}: {
  frame: SpectrumFrame | null
  onFailure?: () => void
}) {
  const createRenderer = useCallback(() => createGoldenRatioRenderer(), [])
  return (
    <AudioReactiveCanvas
      frame={frame}
      bandEdges={GOLDEN_RATIO_BAND_EDGES}
      createRenderer={createRenderer}
      label="Golden Ratio audio visualiser"
      onFailure={onFailure}
    />
  )
}

export function createGoldenSquares(
  width: number,
  height: number,
  count = SQUARE_COUNT,
): GoldenSquare[] {
  const goldenHeight = Math.min(height, width / PHI)
  let remainingWidth = goldenHeight * PHI
  let remainingHeight = goldenHeight
  let x = (width - remainingWidth) / 2
  let y = (height - remainingHeight) / 2
  const squares: GoldenSquare[] = []

  for (let index = 0; index < count; index += 1) {
    const direction = index % 4
    if (direction === 0) {
      const side = remainingHeight
      squares.push({ x, y, side })
      x += side
      remainingWidth -= side
    } else if (direction === 1) {
      const side = remainingWidth
      squares.push({ x, y: y + remainingHeight - side, side })
      remainingHeight -= side
    } else if (direction === 2) {
      const side = remainingHeight
      squares.push({ x: x + remainingWidth - side, y, side })
      remainingWidth -= side
    } else {
      const side = remainingWidth
      squares.push({ x, y, side })
      y += side
      remainingHeight -= side
    }
  }
  return squares
}

function createGoldenRatioRenderer(): AudioReactiveRenderer {
  const levels = new Array<number>(SQUARE_COUNT).fill(0)
  const colours = Array.from({ length: SQUARE_COUNT }, () => {
    const hue = Math.floor(Math.random() * 360)
    const saturation = 72 + Math.floor(Math.random() * 22)
    return { hue, saturation }
  })
  let squares: GoldenSquare[] = []
  let geometryWidth = 0
  let geometryHeight = 0

  return {
    targetFps: 60,
    draw(frame) {
      if (frame.width !== geometryWidth || frame.height !== geometryHeight) {
        geometryWidth = frame.width
        geometryHeight = frame.height
        squares = createGoldenSquares(frame.width, frame.height)
      }
      drawGoldenRatio(frame, levels, colours, squares)
    },
  }
}

function drawGoldenRatio(
  {
    context,
    width,
    height,
    levels: targets,
    deltaSeconds,
  }: CanvasRendererFrame,
  levels: number[],
  colours: readonly { hue: number; saturation: number }[],
  squares: readonly GoldenSquare[],
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  for (let index = 0; index < SQUARE_COUNT; index += 1) {
    const target = targets[index] ?? 0
    const rate = target > levels[index] ? 28 : 7
    const blend = 1 - Math.exp(-rate * deltaSeconds)
    levels[index] += (target - levels[index]) * blend
    const raw = Math.min(1, Math.max(0, levels[index]))
    const brightness =
      raw <= BLACK_THRESHOLD
        ? 0
        : Math.pow((raw - BLACK_THRESHOLD) / (1 - BLACK_THRESHOLD), 3)
    if (brightness <= 0) continue

    const square = squares[index]
    const colour = colours[index]
    const lightness = Math.max(1, brightness * 54)
    context.save()
    if (brightness > 0.2) {
      context.shadowColor = `hsla(${colour.hue} ${colour.saturation}% 55% / ${Math.min(0.7, brightness * 0.6)})`
      context.shadowBlur = Math.min(30, square.side * 0.09) * brightness
    }
    context.fillStyle = `hsl(${colour.hue} ${colour.saturation}% ${lightness}%)`
    context.fillRect(square.x, square.y, square.side, square.side)
    context.restore()
  }
}
