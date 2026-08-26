import { useEffect, useRef } from 'react'
import type { SpectrumFrame } from '../api/types'
import {
  aggregateBands,
  blockColourPalette,
  calculateMatrixLayout,
  stepDisplayedLevels,
  type SpectrumColourScheme,
} from './spectrum'
import { applyVisualiserSensitivity } from './sensitivity'

interface SpectrumCanvasProps {
  frame: SpectrumFrame | null
  riseRate?: number
  fallRate?: number
  colourScheme: SpectrumColourScheme
  sensitivityDb?: number
}

export function SpectrumCanvas({
  frame,
  riseRate,
  fallRate,
  colourScheme,
  sensitivityDb = 0,
}: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(frame)
  const displayedRef = useRef<number[]>([])
  const creditRef = useRef<number[]>([])
  const colourSchemeRef = useRef(colourScheme)

  useEffect(() => {
    frameRef.current = frame
  }, [frame])

  useEffect(() => {
    colourSchemeRef.current = colourScheme
  }, [colourScheme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let animation = 0
    let previousTime = performance.now()
    let cssWidth = 1
    let cssHeight = 1

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      cssWidth = Math.max(1, Math.floor(bounds.width))
      cssHeight = Math.max(1, Math.floor(bounds.height))
      const scale = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(cssWidth * scale))
      canvas.height = Math.max(1, Math.round(cssHeight * scale))
      canvas.getContext('2d')?.setTransform(scale, 0, 0, scale, 0, 0)
    }
    resize()

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    if (!observer) window.addEventListener('resize', resize)

    const draw = (time: number) => {
      const context = canvas.getContext('2d')
      const current = frameRef.current
      if (context) {
        context.clearRect(0, 0, cssWidth, cssHeight)
        if (current && current.band_centres_hz.length > 0) {
          const layout = calculateMatrixLayout(
            cssWidth,
            cssHeight,
            current.levels.length,
            current.max_levels,
          )
          const aggregated = aggregateBands(
            current.levels,
            current.band_centres_hz,
            layout.bandCount,
          )
          for (let index = 0; index < aggregated.levels.length; index += 1) {
            aggregated.levels[index] = Math.round(
              applyVisualiserSensitivity(
                aggregated.levels[index] / current.max_levels,
                sensitivityDb,
              ) * current.max_levels,
            )
          }
          stepDisplayedLevels(
            displayedRef.current,
            aggregated.levels,
            Math.min(0.05, Math.max(0, (time - previousTime) / 1_000)),
            riseRate,
            fallRate,
            creditRef.current,
          )
          drawMatrix(
            context,
            layout,
            displayedRef.current,
            colourSchemeRef.current,
          )
        }
      }
      previousTime = time
      animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animation)
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', resize)
    }
  }, [fallRate, riseRate, sensitivityDb])

  return (
    <canvas
      ref={canvasRef}
      className="spectrum-canvas"
      role="img"
      aria-label={`Real-time audio spectrum, ${colourScheme} colours`}
    />
  )
}

function drawMatrix(
  context: CanvasRenderingContext2D,
  layout: ReturnType<typeof calculateMatrixLayout>,
  levels: readonly number[],
  colourScheme: SpectrumColourScheme,
) {
  const colours = blockColourPalette(layout.levels, colourScheme)
  for (let column = 0; column < levels.length; column += 1) {
    const height = Math.min(layout.levels, Math.max(0, levels[column]))
    const x = layout.matrixX + column * (layout.cellSize + layout.gap)
    for (let row = 0; row < height; row += 1) {
      const y =
        layout.matrixY +
        layout.matrixHeight -
        layout.cellSize -
        row * (layout.cellSize + layout.gap)
      context.fillStyle = colours[height - row - 1]
      // Both dimensions deliberately use the one integer cellSize.
      context.fillRect(x, y, layout.cellSize, layout.cellSize)
    }
  }
}
