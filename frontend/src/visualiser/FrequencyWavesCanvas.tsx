/* eslint-disable react-refresh/only-export-components -- renderer utilities are tested */
import { useCallback } from 'react'
import type { FrequencyWaveFrame, SpectrumFrame } from '../api/types'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
  type CanvasRendererFrame,
} from './AudioReactiveCanvas'
import {
  FREQUENCY_WAVES_BAND_EDGES,
  SHARED_SIX_BAND_COLOURS,
} from './bandMapping'

export const FREQUENCY_WAVE_COLOURS = SHARED_SIX_BAND_COLOURS
export const FREQUENCY_WAVE_MAX_HEIGHT_FRACTION = 0.86
export const FREQUENCY_WAVE_TRACE_MORPH_SECONDS = 0.05

const BAND_COUNT = 6
const BAND_ATTACK_RATE = 14
const BAND_RELEASE_RATE = 4.5
const SILENCE_SNAP = 0.0005
const MAXIMUM_PIXEL_RATIO = 1.25
const MIN_STROKE_MARGIN = 14
const TRACE_QUANTISATION = 127

type MutableLevels = number[] | Float32Array

interface FrequencyWaveBuffers {
  pointCount: number
  previous: Float32Array
  target: Float32Array
  current: Float32Array
  silentBands: Uint8Array
  progress: number
}

interface FrequencyWaveGeometry {
  width: number
  pointCount: number
  xPositions: Float32Array
}

export function FrequencyWavesCanvas({
  frame,
  onFailure,
}: {
  frame: SpectrumFrame | null
  onFailure?: () => void
}) {
  const createRenderer = useCallback(() => createFrequencyWavesRenderer(), [])
  return (
    <AudioReactiveCanvas
      frame={frame}
      bandEdges={FREQUENCY_WAVES_BAND_EDGES}
      createRenderer={createRenderer}
      label="Frequency Waves audio visualiser"
      maximumPixelRatio={MAXIMUM_PIXEL_RATIO}
      onFailure={onFailure}
    />
  )
}

export function updateFrequencyWaveLevels(
  levels: MutableLevels,
  targets: ArrayLike<number>,
  deltaSeconds: number,
  attackRate = BAND_ATTACK_RATE,
  releaseRate = BAND_RELEASE_RATE,
): void {
  const elapsed = Math.max(0, deltaSeconds)
  for (let index = 0; index < levels.length; index += 1) {
    const target = Math.min(1, Math.max(0, targets[index] ?? 0))
    const rate = target > levels[index] ? attackRate : releaseRate
    const blend = 1 - Math.exp(-rate * elapsed)
    const next = levels[index] + (target - levels[index]) * blend
    levels[index] = target === 0 && next < SILENCE_SNAP ? 0 : next
  }
}

export function frequencyWaveAmplitude(level: number, height: number): number {
  if (level <= 0 || height <= 0) return 0
  const quietGate = 0.012
  const active = Math.min(1, Math.max(0, (level - quietGate) / (1 - quietGate)))
  if (active <= 0) return 0
  const drive = 2.2
  const response = (1 - Math.exp(-drive * active)) / (1 - Math.exp(-drive))
  const requested = height * (FREQUENCY_WAVE_MAX_HEIGHT_FRACTION / 2) * response
  return Math.min(requested, Math.max(0, height / 2 - MIN_STROKE_MARGIN))
}

export function frequencyWaveY(
  centre: number,
  amplitude: number,
  normalisedTrace: number,
): number {
  if (amplitude === 0 || normalisedTrace === 0) return centre
  return centre + amplitude * Math.min(1, Math.max(-1, normalisedTrace))
}

export function copyFrequencyWaveTarget(
  traceFrame: FrequencyWaveFrame,
  buffers: FrequencyWaveBuffers,
): void {
  buffers.previous.set(buffers.current)
  buffers.progress = 0
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const trace = traceFrame.traces[band]
    const offset = band * buffers.pointCount
    let silent = true
    for (let point = 0; point < buffers.pointCount; point += 1) {
      const value = Math.min(
        TRACE_QUANTISATION,
        Math.max(-TRACE_QUANTISATION, trace[point] ?? 0),
      )
      buffers.target[offset + point] = value / TRACE_QUANTISATION
      if (value !== 0) silent = false
    }
    buffers.silentBands[band] = silent ? 1 : 0
    if (silent) {
      buffers.previous.fill(0, offset, offset + buffers.pointCount)
      buffers.current.fill(0, offset, offset + buffers.pointCount)
    }
  }
}

export function morphFrequencyWaveTraces(
  buffers: FrequencyWaveBuffers,
  deltaSeconds: number,
): void {
  buffers.progress = Math.min(
    1,
    buffers.progress +
      Math.max(0, deltaSeconds) / FREQUENCY_WAVE_TRACE_MORPH_SECONDS,
  )
  const progress = buffers.progress
  const eased = progress * progress * (3 - 2 * progress)
  for (let index = 0; index < buffers.current.length; index += 1) {
    buffers.current[index] =
      buffers.previous[index] +
      (buffers.target[index] - buffers.previous[index]) * eased
  }
}

export function createFrequencyWaveBuffers(
  pointCount: number,
): FrequencyWaveBuffers {
  const safePointCount = Math.max(2, Math.floor(pointCount))
  const valueCount = BAND_COUNT * safePointCount
  return {
    pointCount: safePointCount,
    previous: new Float32Array(valueCount),
    target: new Float32Array(valueCount),
    current: new Float32Array(valueCount),
    silentBands: new Uint8Array(BAND_COUNT).fill(1),
    progress: 1,
  }
}

export function createFrequencyWavesRenderer(): AudioReactiveRenderer {
  const bandLevels = new Float32Array(BAND_COUNT)
  let buffers: FrequencyWaveBuffers | null = null
  let geometry: FrequencyWaveGeometry | null = null
  let sourceSequence = Number.NaN

  return {
    targetFps: 60,
    paintToleranceMs: 1,
    draw(frame) {
      const source = frame.sourceFrame
      if (source && source.sequence !== sourceSequence) {
        sourceSequence = source.sequence
        const traceFrame = source.frequency_waves
        if (traceFrame) {
          const pointCount = traceFrame.traces[0]?.length ?? 0
          if (!buffers || buffers.pointCount !== pointCount) {
            buffers = createFrequencyWaveBuffers(pointCount)
            geometry = null
          }
          copyFrequencyWaveTarget(traceFrame, buffers)
        } else if (buffers) {
          buffers.previous.fill(0)
          buffers.target.fill(0)
          buffers.current.fill(0)
          buffers.silentBands.fill(1)
          buffers.progress = 1
        }
      }
      updateFrequencyWaveLevels(bandLevels, frame.levels, frame.deltaSeconds)
      if (buffers) {
        morphFrequencyWaveTraces(buffers, frame.deltaSeconds)
        if (
          !geometry ||
          geometry.width !== frame.width ||
          geometry.pointCount !== buffers.pointCount
        ) {
          geometry = createFrequencyWaveGeometry(
            frame.width,
            buffers.pointCount,
          )
        }
      }
      drawFrequencyWaves(frame, bandLevels, buffers, geometry)
    },
    dispose() {
      bandLevels.fill(0)
      buffers = null
      geometry = null
    },
  }
}

function createFrequencyWaveGeometry(
  width: number,
  pointCount: number,
): FrequencyWaveGeometry {
  const xPositions = new Float32Array(pointCount)
  for (let point = 0; point < pointCount; point += 1) {
    xPositions[point] = (width * point) / Math.max(1, pointCount - 1)
  }
  return { width, pointCount, xPositions }
}

function drawFrequencyWaves(
  { context, width, height }: CanvasRendererFrame,
  bandLevels: Float32Array,
  buffers: FrequencyWaveBuffers | null,
  geometry: FrequencyWaveGeometry | null,
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#010208'
  context.fillRect(0, 0, width, height)
  const centre = height / 2

  context.globalCompositeOperation = 'lighter'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const colour = FREQUENCY_WAVE_COLOURS[band]
    const amplitude = frequencyWaveAmplitude(bandLevels[band], height)
    context.beginPath()
    if (!buffers || !geometry) {
      context.moveTo(0, centre)
      context.lineTo(width, centre)
    } else {
      tracePath(context, centre, amplitude, band, buffers, geometry)
    }

    context.strokeStyle = colour
    context.globalAlpha = 0.18
    context.lineWidth = 8
    context.shadowColor = colour
    context.shadowBlur = 11
    context.stroke()
    context.globalAlpha = 0.94
    context.lineWidth = 2.5
    context.shadowBlur = 0
    context.stroke()
  }
  context.globalAlpha = 1
  context.shadowBlur = 0
  context.globalCompositeOperation = 'source-over'
}

function tracePath(
  context: CanvasRenderingContext2D,
  centre: number,
  amplitude: number,
  band: number,
  buffers: FrequencyWaveBuffers,
  geometry: FrequencyWaveGeometry,
) {
  const offset = band * buffers.pointCount
  const firstY = frequencyWaveY(centre, amplitude, buffers.current[offset])
  context.moveTo(geometry.xPositions[0], firstY)
  for (let point = 1; point < buffers.pointCount - 1; point += 1) {
    const x = geometry.xPositions[point]
    const y = frequencyWaveY(centre, amplitude, buffers.current[offset + point])
    const nextX = geometry.xPositions[point + 1]
    const nextY = frequencyWaveY(
      centre,
      amplitude,
      buffers.current[offset + point + 1],
    )
    context.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2)
  }
  const last = buffers.pointCount - 1
  context.lineTo(
    geometry.xPositions[last],
    frequencyWaveY(centre, amplitude, buffers.current[offset + last]),
  )
}
