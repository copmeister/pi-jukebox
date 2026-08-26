/* eslint-disable react-refresh/only-export-components -- renderer factory is exported for lifecycle tests */
import { useCallback } from 'react'
import type { SpectrumFrame } from '../api/types'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
  type CanvasRendererFrame,
} from './AudioReactiveCanvas'
import {
  calculateConcentricSquareLayout,
  concentricSquareBandForLayer,
  concentricSquareBrightness,
  concentricSquareColourValue,
  concentricSquareLayer,
  CONCENTRIC_SQUARE_BAND_EDGES,
  CONCENTRIC_SQUARE_LAYER_COUNT,
  type ConcentricSquareColour,
  updateConcentricSquareLevels,
} from './concentricSquares'

export function ConcentricSquaresCanvas({
  frame,
  solidColour,
  sensitivityDb,
  onFailure,
}: {
  frame: SpectrumFrame | null
  solidColour: ConcentricSquareColour
  sensitivityDb: number
  onFailure?: () => void
}) {
  const createRenderer = useCallback(
    () => createConcentricSquaresRenderer(solidColour),
    [solidColour],
  )
  return (
    <AudioReactiveCanvas
      frame={frame}
      bandEdges={CONCENTRIC_SQUARE_BAND_EDGES}
      createRenderer={createRenderer}
      label={`Concentric Squares audio visualiser, ${solidColour}`}
      sensitivityDb={sensitivityDb}
      maximumPixelRatio={1.25}
      onFailure={onFailure}
    />
  )
}

export function createConcentricSquaresRenderer(
  solidColour: ConcentricSquareColour,
): AudioReactiveRenderer {
  const levels = new Float32Array(CONCENTRIC_SQUARE_LAYER_COUNT)
  return {
    targetFps: 60,
    paintToleranceMs: 1,
    draw(frame) {
      updateConcentricSquareLevels(levels, frame.levels, frame.deltaSeconds)
      drawConcentricSquares(frame, levels, solidColour)
    },
    dispose() {
      levels.fill(0)
    },
  }
}

function drawConcentricSquares(
  { context, width, height }: CanvasRendererFrame,
  levels: Float32Array,
  solidColour: ConcentricSquareColour,
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  const layout = calculateConcentricSquareLayout(width, height)
  const colour = concentricSquareColourValue(solidColour)

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const layer = concentricSquareLayer(column, row)
      const band = concentricSquareBandForLayer(layer)
      const brightness = concentricSquareBrightness(levels[band])
      if (brightness <= 0) continue
      context.globalAlpha = brightness
      context.fillStyle = colour
      context.fillRect(
        layout.matrixX + column * (layout.cellSize + layout.gap),
        layout.matrixY + row * (layout.cellSize + layout.gap),
        layout.cellSize,
        layout.cellSize,
      )
    }
  }
  context.globalAlpha = 1
}
