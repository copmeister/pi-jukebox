/* eslint-disable react-refresh/only-export-components -- renderer utilities are tested */
import { useCallback } from 'react'
import type { SpectrumFrame } from '../api/types'
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
export const FREQUENCY_WAVE_MODES = [2, 3, 4, 5, 6, 8] as const
export const FREQUENCY_WAVE_MAX_HEIGHT_FRACTION = 0.86
export const FREQUENCY_WAVE_DATA_INTERVAL_SECONDS = 1 / 30

const BAND_COUNT = 6
const SHAPE_COEFFICIENTS_PER_BAND = 2
const SHAPE_COEFFICIENT_COUNT = BAND_COUNT * SHAPE_COEFFICIENTS_PER_BAND
const BAND_ATTACK_RATE = 22
const BAND_RELEASE_RATE = 10
const SHAPE_RESPONSE_RATE = 12
const SHAPE_SNAP = 0.0005
const FIRST_DETAIL_STRENGTH = 0.3
const SECOND_DETAIL_STRENGTH = 0.18
const SHAPE_NORMALISER = 1 + FIRST_DETAIL_STRENGTH + SECOND_DETAIL_STRENGTH
const SAMPLE_SPACING = 6
const MAXIMUM_PIXEL_RATIO = 1.25
const MIN_STROKE_MARGIN = 14

type MutableValues = number[] | Float32Array

export interface FrequencyWaveSampleMap {
  sourceCentres: Float64Array
  sampleIndices: Int16Array
}

interface FrequencyWaveGeometry {
  width: number
  sampleCount: number
  xPositions: Float32Array
  basis: Float32Array
  yPositions: Float32Array
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
  levels: MutableValues,
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
    levels[index] = target === 0 && next < SHAPE_SNAP ? 0 : next
  }
}

export function updateFrequencyWaveShape(
  coefficients: MutableValues,
  targets: ArrayLike<number>,
  deltaSeconds: number,
  responseRate = SHAPE_RESPONSE_RATE,
): void {
  const blend = 1 - Math.exp(-responseRate * Math.max(0, deltaSeconds))
  for (let index = 0; index < coefficients.length; index += 1) {
    const target = Math.min(1, Math.max(-1, targets[index] ?? 0))
    const next = coefficients[index] + (target - coefficients[index]) * blend
    coefficients[index] = target === 0 && Math.abs(next) < SHAPE_SNAP ? 0 : next
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
  normalisedShape: number,
): number {
  if (amplitude === 0 || normalisedShape === 0) return centre
  return centre + amplitude * Math.min(1, Math.max(-1, normalisedShape))
}

export function frequencyWaveBasisValue(
  band: number,
  detail: number,
  xRatio: number,
): number {
  const safeBand = Math.min(BAND_COUNT - 1, Math.max(0, band))
  const safeDetail = Math.min(2, Math.max(0, detail))
  const mode = FREQUENCY_WAVE_MODES[safeBand] + safeDetail
  return Math.sin(Math.PI * mode * Math.min(1, Math.max(0, xRatio)))
}

export function frequencyWaveShapeValue(
  band: number,
  xRatio: number,
  firstDetail: number,
  secondDetail: number,
): number {
  const value =
    frequencyWaveBasisValue(band, 0, xRatio) +
    Math.min(1, Math.max(-1, firstDetail)) *
      FIRST_DETAIL_STRENGTH *
      frequencyWaveBasisValue(band, 1, xRatio) +
    Math.min(1, Math.max(-1, secondDetail)) *
      SECOND_DETAIL_STRENGTH *
      frequencyWaveBasisValue(band, 2, xRatio)
  return value / SHAPE_NORMALISER
}

export function createFrequencyWaveSampleMap(
  sourceCentres: readonly number[],
): FrequencyWaveSampleMap {
  const sampleIndices = new Int16Array(BAND_COUNT * 3)
  sampleIndices.fill(-1)
  if (sourceCentres.length === 0) {
    return { sourceCentres: new Float64Array(), sampleIndices }
  }

  for (let band = 0; band < BAND_COUNT; band += 1) {
    const low = FREQUENCY_WAVES_BAND_EDGES[band]
    const high = FREQUENCY_WAVES_BAND_EDGES[band + 1]
    for (let sample = 0; sample < 3; sample += 1) {
      const ratio = (sample + 0.5) / 3
      const frequency = low * Math.pow(high / low, ratio)
      sampleIndices[band * 3 + sample] = nearestFrequencyIndex(
        sourceCentres,
        frequency,
      )
    }
  }
  return {
    sourceCentres: Float64Array.from(sourceCentres),
    sampleIndices,
  }
}

export function sampleFrequencyWaveShape(
  frame: SpectrumFrame,
  map: FrequencyWaveSampleMap,
  output: MutableValues,
): void {
  const normaliser = Math.max(1, frame.max_levels)
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const index = band * 3
    const low = (frame.levels[map.sampleIndices[index]] ?? 0) / normaliser
    const middle =
      (frame.levels[map.sampleIndices[index + 1]] ?? 0) / normaliser
    const high = (frame.levels[map.sampleIndices[index + 2]] ?? 0) / normaliser
    const peak = Math.max(low, middle, high)
    const outputIndex = band * SHAPE_COEFFICIENTS_PER_BAND
    if (peak <= 0) {
      output[outputIndex] = 0
      output[outputIndex + 1] = 0
      continue
    }
    output[outputIndex] = Math.min(1, Math.max(-1, (high - low) / peak))
    output[outputIndex + 1] = Math.min(
      1,
      Math.max(-1, (middle - (low + high) / 2) / peak),
    )
  }
}

export function createFrequencyWavesRenderer(): AudioReactiveRenderer {
  const bandLevels = new Float32Array(BAND_COUNT)
  const shapeCoefficients = new Float32Array(SHAPE_COEFFICIENT_COUNT)
  const shapeTargets = new Float32Array(SHAPE_COEFFICIENT_COUNT)
  let sampleMap: FrequencyWaveSampleMap | null = null
  let geometry: FrequencyWaveGeometry | null = null
  let sourceSequence = Number.NaN

  return {
    targetFps: 60,
    paintToleranceMs: 1,
    draw(frame) {
      const source = frame.sourceFrame
      if (source && source.sequence !== sourceSequence) {
        sourceSequence = source.sequence
        if (!sampleMapMatches(sampleMap, source.band_centres_hz))
          sampleMap = createFrequencyWaveSampleMap(source.band_centres_hz)
        sampleFrequencyWaveShape(source, sampleMap, shapeTargets)
      }
      updateFrequencyWaveLevels(bandLevels, frame.levels, frame.deltaSeconds)
      updateFrequencyWaveShape(
        shapeCoefficients,
        shapeTargets,
        frame.deltaSeconds,
      )
      if (!geometry || geometry.width !== frame.width)
        geometry = createFrequencyWaveGeometry(frame.width)
      drawFrequencyWaves(frame, bandLevels, shapeCoefficients, geometry)
    },
    dispose() {
      bandLevels.fill(0)
      shapeCoefficients.fill(0)
      shapeTargets.fill(0)
      sampleMap = null
      geometry = null
    },
  }
}

function sampleMapMatches(
  map: FrequencyWaveSampleMap | null,
  sourceCentres: readonly number[],
): map is FrequencyWaveSampleMap {
  if (!map || map.sourceCentres.length !== sourceCentres.length) return false
  for (let index = 0; index < sourceCentres.length; index += 1) {
    if (map.sourceCentres[index] !== sourceCentres[index]) return false
  }
  return true
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

function createFrequencyWaveGeometry(width: number): FrequencyWaveGeometry {
  const sampleCount = Math.max(2, Math.ceil(width / SAMPLE_SPACING) + 1)
  const xPositions = new Float32Array(sampleCount)
  const basis = new Float32Array(BAND_COUNT * 3 * sampleCount)
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const xRatio = sample / (sampleCount - 1)
    xPositions[sample] = width * xRatio
    for (let band = 0; band < BAND_COUNT; band += 1) {
      for (let detail = 0; detail < 3; detail += 1) {
        basis[(band * 3 + detail) * sampleCount + sample] =
          frequencyWaveBasisValue(band, detail, xRatio)
      }
    }
  }
  return {
    width,
    sampleCount,
    xPositions,
    basis,
    yPositions: new Float32Array(BAND_COUNT * sampleCount),
  }
}

function drawFrequencyWaves(
  { context, width, height }: CanvasRendererFrame,
  bandLevels: Float32Array,
  shapeCoefficients: Float32Array,
  geometry: FrequencyWaveGeometry,
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#010208'
  context.fillRect(0, 0, width, height)
  const centre = height / 2

  context.globalCompositeOperation = 'lighter'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const amplitude = frequencyWaveAmplitude(bandLevels[band], height)
    const coefficientOffset = band * SHAPE_COEFFICIENTS_PER_BAND
    const firstDetail = shapeCoefficients[coefficientOffset]
    const secondDetail = shapeCoefficients[coefficientOffset + 1]
    const basisOffset = band * 3 * geometry.sampleCount
    const yOffset = band * geometry.sampleCount
    for (let sample = 0; sample < geometry.sampleCount; sample += 1) {
      const base = geometry.basis[basisOffset + sample]
      const first = geometry.basis[basisOffset + geometry.sampleCount + sample]
      const second =
        geometry.basis[basisOffset + geometry.sampleCount * 2 + sample]
      const shape =
        (base +
          first * firstDetail * FIRST_DETAIL_STRENGTH +
          second * secondDetail * SECOND_DETAIL_STRENGTH) /
        SHAPE_NORMALISER
      geometry.yPositions[yOffset + sample] = frequencyWaveY(
        centre,
        amplitude,
        shape,
      )
    }
    context.beginPath()
    traceStandingWave(context, yOffset, geometry)

    const colour = FREQUENCY_WAVE_COLOURS[band]
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

function traceStandingWave(
  context: CanvasRenderingContext2D,
  yOffset: number,
  geometry: FrequencyWaveGeometry,
) {
  const { sampleCount, xPositions, yPositions } = geometry
  context.moveTo(xPositions[0], yPositions[yOffset])
  for (let sample = 1; sample < sampleCount - 1; sample += 1) {
    const x = xPositions[sample]
    const y = yPositions[yOffset + sample]
    const nextX = xPositions[sample + 1]
    const nextY = yPositions[yOffset + sample + 1]
    context.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2)
  }
  const last = sampleCount - 1
  context.lineTo(xPositions[last], yPositions[yOffset + last])
}
