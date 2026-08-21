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
export const FREQUENCY_WAVE_MODES = [4, 6.4, 9.3, 12.9, 17.2, 22.4] as const
export const FREQUENCY_WAVE_COMPONENT_OFFSETS = [0, 0.45, 0.9] as const
export const FREQUENCY_WAVE_PHASE_OFFSETS = [
  0.3, 1.23, 0.22, 2.91, 0.69, 1.47,
] as const
export const FREQUENCY_WAVE_SAMPLE_RATIOS = [0.25, 0.5, 0.75] as const
export const FREQUENCY_WAVE_MAX_HEIGHT_FRACTION = 0.94
export const FREQUENCY_WAVE_INPUT_GAIN = 3
export const FREQUENCY_WAVE_DATA_INTERVAL_SECONDS = 1 / 30
export const FREQUENCY_WAVE_EDGE_ENVELOPE = 0.3

const BAND_COUNT = 6
const COMPONENTS_PER_BAND = FREQUENCY_WAVE_COMPONENT_OFFSETS.length
const COMPONENT_COUNT = BAND_COUNT * COMPONENTS_PER_BAND
const BAND_ATTACK_RATE = 80
const BAND_RELEASE_RATE = 40
const COMPONENT_RESPONSE_RATE = 60
const SHAPE_SNAP = 0.0005
const SAMPLE_SPACING = 6
const MAXIMUM_PIXEL_RATIO = 1.25
const MIN_STROKE_MARGIN = 14

type MutableValues = number[] | Float32Array

export interface FrequencyWaveSampleMap {
  sourceCentres: Float64Array
  targetFrequencies: Float64Array
  leftIndices: Int16Array
  rightIndices: Int16Array
  mixes: Float32Array
}

interface FrequencyWaveGeometry {
  width: number
  sampleCount: number
  xPositions: Float32Array
  envelope: Float32Array
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

export function updateFrequencyWaveComponents(
  components: MutableValues,
  targets: ArrayLike<number>,
  deltaSeconds: number,
  responseRate = COMPONENT_RESPONSE_RATE,
): void {
  const blend = 1 - Math.exp(-responseRate * Math.max(0, deltaSeconds))
  for (let index = 0; index < components.length; index += 1) {
    const target = Math.min(1, Math.max(0, targets[index] ?? 0))
    const next = components[index] + (target - components[index]) * blend
    components[index] = target === 0 && next < SHAPE_SNAP ? 0 : next
  }
}

export function frequencyWaveAmplitude(level: number, height: number): number {
  if (level <= 0 || height <= 0) return 0
  const quietGate = 0.012
  const active = Math.min(
    1,
    Math.max(
      0,
      ((level - quietGate) / (1 - quietGate)) * FREQUENCY_WAVE_INPUT_GAIN,
    ),
  )
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
  component: number,
  xRatio: number,
): number {
  const safeBand = Math.min(BAND_COUNT - 1, Math.max(0, band))
  const safeComponent = Math.min(
    COMPONENTS_PER_BAND - 1,
    Math.max(0, component),
  )
  const mode =
    FREQUENCY_WAVE_MODES[safeBand] +
    FREQUENCY_WAVE_COMPONENT_OFFSETS[safeComponent]
  return Math.sin(
    Math.PI * mode * Math.min(1, Math.max(0, xRatio)) +
      FREQUENCY_WAVE_PHASE_OFFSETS[safeBand],
  )
}

export function frequencyWaveDirection(band: number): -1 | 1 {
  return band % 2 === 0 ? -1 : 1
}

export function frequencyWaveSpatialEnvelope(xRatio: number): number {
  const x = Math.min(1, Math.max(0, xRatio))
  const centreWeight = Math.sin(Math.PI * x) ** 2
  return (
    FREQUENCY_WAVE_EDGE_ENVELOPE +
    (1 - FREQUENCY_WAVE_EDGE_ENVELOPE) * centreWeight
  )
}

export function frequencyWaveShapeValue(
  band: number,
  xRatio: number,
  componentWeights: ArrayLike<number>,
): number {
  let value = 0
  let weightSum = 0
  for (let component = 0; component < COMPONENTS_PER_BAND; component += 1) {
    const weight = Math.min(1, Math.max(0, componentWeights[component] ?? 0))
    value += weight * frequencyWaveBasisValue(band, component, xRatio)
    weightSum += weight
  }
  if (weightSum <= 0) return 0
  return (
    frequencyWaveDirection(band) *
    (value / weightSum) *
    frequencyWaveSpatialEnvelope(xRatio)
  )
}

export function createFrequencyWaveSampleMap(
  sourceCentres: readonly number[],
): FrequencyWaveSampleMap {
  const targetFrequencies = new Float64Array(COMPONENT_COUNT)
  const leftIndices = new Int16Array(COMPONENT_COUNT)
  const rightIndices = new Int16Array(COMPONENT_COUNT)
  const mixes = new Float32Array(COMPONENT_COUNT)
  leftIndices.fill(-1)
  rightIndices.fill(-1)
  if (sourceCentres.length === 0) {
    return {
      sourceCentres: new Float64Array(),
      targetFrequencies,
      leftIndices,
      rightIndices,
      mixes,
    }
  }

  for (let band = 0; band < BAND_COUNT; band += 1) {
    const low = FREQUENCY_WAVES_BAND_EDGES[band]
    const high = FREQUENCY_WAVES_BAND_EDGES[band + 1]
    for (let sample = 0; sample < COMPONENTS_PER_BAND; sample += 1) {
      const ratio = FREQUENCY_WAVE_SAMPLE_RATIOS[sample]
      const frequency = low * Math.pow(high / low, ratio)
      const outputIndex = band * COMPONENTS_PER_BAND + sample
      const interpolation = frequencyInterpolation(sourceCentres, frequency)
      targetFrequencies[outputIndex] = frequency
      leftIndices[outputIndex] = interpolation.left
      rightIndices[outputIndex] = interpolation.right
      mixes[outputIndex] = interpolation.mix
    }
  }
  return {
    sourceCentres: Float64Array.from(sourceCentres),
    targetFrequencies,
    leftIndices,
    rightIndices,
    mixes,
  }
}

export function sampleFrequencyWaveComponents(
  frame: SpectrumFrame,
  map: FrequencyWaveSampleMap,
  output: MutableValues,
): void {
  const normaliser = Math.max(1, frame.max_levels)
  for (let index = 0; index < COMPONENT_COUNT; index += 1) {
    const left = map.leftIndices[index]
    const right = map.rightIndices[index]
    if (left < 0 || right < 0) {
      output[index] = 0
      continue
    }
    const mix = map.mixes[index]
    const leftLevel = frame.levels[left] ?? 0
    const rightLevel = frame.levels[right] ?? leftLevel
    const level = leftLevel + (rightLevel - leftLevel) * mix
    output[index] = Math.min(1, Math.max(0, level / normaliser))
  }
}

export function createFrequencyWavesRenderer(): AudioReactiveRenderer {
  const bandLevels = new Float32Array(BAND_COUNT)
  const componentLevels = new Float32Array(COMPONENT_COUNT)
  const componentTargets = new Float32Array(COMPONENT_COUNT)
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
        sampleFrequencyWaveComponents(source, sampleMap, componentTargets)
      }
      updateFrequencyWaveLevels(bandLevels, frame.levels, frame.deltaSeconds)
      updateFrequencyWaveComponents(
        componentLevels,
        componentTargets,
        frame.deltaSeconds,
      )
      if (!geometry || geometry.width !== frame.width)
        geometry = createFrequencyWaveGeometry(frame.width)
      drawFrequencyWaves(frame, bandLevels, componentLevels, geometry)
    },
    dispose() {
      bandLevels.fill(0)
      componentLevels.fill(0)
      componentTargets.fill(0)
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

function frequencyInterpolation(
  frequencies: readonly number[],
  target: number,
): { left: number; right: number; mix: number } {
  const last = frequencies.length - 1
  if (target <= frequencies[0]) return { left: 0, right: 0, mix: 0 }
  if (target >= frequencies[last]) return { left: last, right: last, mix: 0 }
  let right = 1
  while (right < frequencies.length && frequencies[right] < target) right += 1
  const left = right - 1
  const interval = Math.log(frequencies[right] / frequencies[left])
  const mix = interval > 0 ? Math.log(target / frequencies[left]) / interval : 0
  return { left, right, mix: Math.min(1, Math.max(0, mix)) }
}

function frequencyWaveShapeFromBuffer(
  band: number,
  sample: number,
  componentLevels: Float32Array,
  geometry: FrequencyWaveGeometry,
): number {
  const componentOffset = band * COMPONENTS_PER_BAND
  const basisOffset = componentOffset * geometry.sampleCount
  let value = 0
  let weightSum = 0
  for (let component = 0; component < COMPONENTS_PER_BAND; component += 1) {
    const weight = componentLevels[componentOffset + component]
    value +=
      weight *
      geometry.basis[basisOffset + component * geometry.sampleCount + sample]
    weightSum += weight
  }
  if (weightSum <= 0) return 0
  return (
    frequencyWaveDirection(band) *
    (value / weightSum) *
    geometry.envelope[sample]
  )
}

function createFrequencyWaveGeometry(width: number): FrequencyWaveGeometry {
  const sampleCount = Math.max(2, Math.ceil(width / SAMPLE_SPACING) + 1)
  const xPositions = new Float32Array(sampleCount)
  const envelope = new Float32Array(sampleCount)
  const basis = new Float32Array(COMPONENT_COUNT * sampleCount)
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const xRatio = sample / (sampleCount - 1)
    xPositions[sample] = width * xRatio
    envelope[sample] = frequencyWaveSpatialEnvelope(xRatio)
    for (let band = 0; band < BAND_COUNT; band += 1) {
      for (let component = 0; component < COMPONENTS_PER_BAND; component += 1) {
        basis[(band * COMPONENTS_PER_BAND + component) * sampleCount + sample] =
          frequencyWaveBasisValue(band, component, xRatio)
      }
    }
  }
  return {
    width,
    sampleCount,
    xPositions,
    envelope,
    basis,
    yPositions: new Float32Array(BAND_COUNT * sampleCount),
  }
}

function drawFrequencyWaves(
  { context, width, height }: CanvasRendererFrame,
  bandLevels: Float32Array,
  componentLevels: Float32Array,
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
    const yOffset = band * geometry.sampleCount
    for (let sample = 0; sample < geometry.sampleCount; sample += 1) {
      const shape = frequencyWaveShapeFromBuffer(
        band,
        sample,
        componentLevels,
        geometry,
      )
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
