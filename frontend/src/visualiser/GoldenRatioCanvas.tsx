/* eslint-disable react-refresh/only-export-components -- geometry is exported for deterministic tests */
import { useCallback } from 'react'
import type { SpectrumFrame } from '../api/types'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
  type CanvasRendererFrame,
} from './AudioReactiveCanvas'
import { GOLDEN_RATIO_BAND_EDGES, SHARED_SIX_BAND_COLOURS } from './bandMapping'

const PHI = (1 + Math.sqrt(5)) / 2
const REGION_COUNT = 6
const BLACK_THRESHOLD = 0.12

export const GOLDEN_RATIO_COLOURS = SHARED_SIX_BAND_COLOURS

interface GoldenRegion {
  x: number
  y: number
  width: number
  height: number
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

export function createGoldenRegions(
  width: number,
  height: number,
  count = REGION_COUNT,
): GoldenRegion[] {
  const goldenHeight = Math.max(height, width / PHI)
  let remainingWidth = goldenHeight * PHI
  let remainingHeight = goldenHeight
  let x = (width - remainingWidth) / 2
  let y = (height - remainingHeight) / 2
  const regions: GoldenRegion[] = []

  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      regions.push({
        x,
        y,
        width: remainingWidth,
        height: remainingHeight,
      })
      break
    }
    const direction = index % 4
    if (direction === 0) {
      const side = remainingHeight
      regions.push({ x, y, width: side, height: side })
      x += side
      remainingWidth -= side
    } else if (direction === 1) {
      const side = remainingWidth
      regions.push({
        x,
        y: y + remainingHeight - side,
        width: side,
        height: side,
      })
      remainingHeight -= side
    } else if (direction === 2) {
      const side = remainingHeight
      regions.push({
        x: x + remainingWidth - side,
        y,
        width: side,
        height: side,
      })
      remainingWidth -= side
    } else {
      const side = remainingWidth
      regions.push({ x, y, width: side, height: side })
      y += side
      remainingHeight -= side
    }
  }
  return regions
}

function createGoldenRatioRenderer(): AudioReactiveRenderer {
  const levels = new Array<number>(REGION_COUNT).fill(0)
  let regions: GoldenRegion[] = []
  let geometryWidth = 0
  let geometryHeight = 0

  return {
    targetFps: 60,
    draw(frame) {
      if (frame.width !== geometryWidth || frame.height !== geometryHeight) {
        geometryWidth = frame.width
        geometryHeight = frame.height
        regions = createGoldenRegions(frame.width, frame.height)
      }
      drawGoldenRatio(frame, levels, regions)
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
  regions: readonly GoldenRegion[],
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  for (let index = 0; index < REGION_COUNT; index += 1) {
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

    const region = regions[index]
    const colour = GOLDEN_RATIO_COLOURS[index]
    context.save()
    context.globalAlpha = brightness
    if (brightness > 0.2) {
      context.shadowColor = colour
      context.shadowBlur =
        Math.min(30, Math.min(region.width, region.height) * 0.09) * brightness
    }
    context.fillStyle = colour
    context.fillRect(region.x, region.y, region.width, region.height)
    context.restore()
  }
}
