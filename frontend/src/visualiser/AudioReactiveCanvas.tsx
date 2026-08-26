import { useEffect, useRef } from 'react'
import type { SpectrumFrame } from '../api/types'
import { mapFrameToLogicalBands } from './bandMapping'
import { applyVisualiserSensitivity } from './sensitivity'

export interface CanvasRendererFrame {
  context: CanvasRenderingContext2D
  width: number
  height: number
  levels: readonly number[]
  time: number
  deltaSeconds: number
  sourceFrame: SpectrumFrame | null
}

export interface AudioReactiveRenderer {
  targetFps: number
  paintToleranceMs?: number
  draw(frame: CanvasRendererFrame): void
  dispose?(): void
}

export interface AudioReactiveCanvasProps {
  frame: SpectrumFrame | null
  bandEdges: readonly number[]
  createRenderer: () => AudioReactiveRenderer
  label: string
  onFailure?: () => void
  maximumPixelRatio?: number
  sensitivityDb?: number
}

export function AudioReactiveCanvas({
  frame,
  bandEdges,
  createRenderer,
  label,
  onFailure,
  maximumPixelRatio,
  sensitivityDb = 0,
}: AudioReactiveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(frame)

  useEffect(() => {
    frameRef.current = frame
  }, [frame])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = createRenderer()
    let animation = 0
    let cssWidth = 1
    let cssHeight = 1
    let previousTime = performance.now()
    let previousPaint = 0
    let mappedSequence = Number.NaN
    let mappedLevels = new Array<number>(bandEdges.length - 1).fill(0)
    let failed = false

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      cssWidth = Math.max(1, Math.floor(bounds.width))
      cssHeight = Math.max(1, Math.floor(bounds.height))
      const scale = Math.min(
        maximumPixelRatio ?? Number.POSITIVE_INFINITY,
        Math.max(1, window.devicePixelRatio || 1),
      )
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
      const interval = 1_000 / Math.max(1, renderer.targetFps)
      if (
        !failed &&
        (previousPaint === 0 ||
          time - previousPaint + (renderer.paintToleranceMs ?? 0) >= interval)
      ) {
        const current = frameRef.current
        if (current && current.sequence !== mappedSequence) {
          mappedSequence = current.sequence
          mappedLevels = mapFrameToLogicalBands(current, bandEdges).levels.map(
            (level) => applyVisualiserSensitivity(level, sensitivityDb),
          )
        }
        const context = canvas.getContext('2d')
        if (context) {
          try {
            renderer.draw({
              context,
              width: cssWidth,
              height: cssHeight,
              levels: mappedLevels,
              time: time / 1_000,
              deltaSeconds: Math.min(
                0.1,
                Math.max(0, (time - previousTime) / 1_000),
              ),
              sourceFrame: current,
            })
          } catch {
            failed = true
            context.clearRect(0, 0, cssWidth, cssHeight)
            onFailure?.()
          }
        }
        previousPaint = time
        previousTime = time
      }
      if (!failed) animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animation)
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', resize)
      renderer.dispose?.()
    }
  }, [bandEdges, createRenderer, maximumPixelRatio, onFailure, sensitivityDb])

  return (
    <canvas
      ref={canvasRef}
      className="spectrum-canvas"
      role="img"
      aria-label={label}
    />
  )
}
