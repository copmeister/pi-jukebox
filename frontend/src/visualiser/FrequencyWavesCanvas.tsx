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
export const FREQUENCY_WAVE_COMPONENTS_PER_BAND = 12
export const FREQUENCY_WAVE_BASE_CYCLES = [0.9, 1.25, 1.7, 2.3, 3, 3.8] as const
export const FREQUENCY_WAVE_MAX_HEIGHT_FRACTION = 0.86

const BAND_COUNT = 6
const COMPONENT_COUNT = BAND_COUNT * FREQUENCY_WAVE_COMPONENTS_PER_BAND
const BAND_ATTACK_RATE = 14
const BAND_RELEASE_RATE = 4.5
const COMPONENT_ATTACK_RATE = 11
const COMPONENT_RELEASE_RATE = 5
const SILENCE_SNAP = 0.0005
const SAMPLE_SPACING = 5
const MAXIMUM_PIXEL_RATIO = 1.25
const MIN_STROKE_MARGIN = 14
const TAU = Math.PI * 2

type MutableLevels = number[] | Float32Array

export interface FrequencyWaveSampleMap {
  sourceCentres: Float64Array
  leftIndices: Int16Array
  rightIndices: Int16Array
  mixes: Float32Array
}

interface FrequencyWaveGeometry {
  width: number
  sampleCount: number
  xPositions: Float32Array
  basis: Float32Array
  shapes: Float32Array
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
  normalisedShape: number,
): number {
  if (amplitude === 0) return centre
  return centre + amplitude * Math.min(1, Math.max(-1, normalisedShape))
}

export function frequencyWaveBasisValue(
  band: number,
  component: number,
  xRatio: number,
): number {
  const safeBand = Math.min(BAND_COUNT - 1, Math.max(0, band))
  const componentRatio =
    component / Math.max(1, FREQUENCY_WAVE_COMPONENTS_PER_BAND - 1)
  const cycles =
    FREQUENCY_WAVE_BASE_CYCLES[safeBand] * (0.76 + componentRatio * 0.52)
  const fixedPhase = ((safeBand * 0.271 + component * 0.61803398875) % 1) * TAU
  const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, xRatio)))
  const primary = Math.sin(TAU * cycles * xRatio + fixedPhase)
  const detail = Math.sin(
    TAU * (cycles * 1.73 + 0.11 * safeBand) * xRatio - fixedPhase * 0.43,
  )
  return envelope * (primary + detail * 0.22)
}

export function createFrequencyWaveSampleMap(
  sourceCentres: readonly number[],
): FrequencyWaveSampleMap {
  const storedCentres = Float64Array.from(sourceCentres)
  const leftIndices = new Int16Array(COMPONENT_COUNT)
  const rightIndices = new Int16Array(COMPONENT_COUNT)
  const mixes = new Float32Array(COMPONENT_COUNT)
  leftIndices.fill(-1)
  rightIndices.fill(-1)

  if (sourceCentres.length === 0) {
    return { sourceCentres: storedCentres, leftIndices, rightIndices, mixes }
  }

  for (let band = 0; band < BAND_COUNT; band += 1) {
    const low = FREQUENCY_WAVES_BAND_EDGES[band]
    const high = FREQUENCY_WAVES_BAND_EDGES[band + 1]
    for (
      let component = 0;
      component < FREQUENCY_WAVE_COMPONENTS_PER_BAND;
      component += 1
    ) {
      const targetIndex = band * FREQUENCY_WAVE_COMPONENTS_PER_BAND + component
      const ratio = (component + 0.5) / FREQUENCY_WAVE_COMPONENTS_PER_BAND
      const targetFrequency = low * Math.pow(high / low, ratio)
      let right = sourceCentres.findIndex(
        (frequency) => frequency >= targetFrequency,
      )
      if (right < 0) right = sourceCentres.length - 1
      const left = Math.max(0, right - 1)
      if (right === 0 || left === right) {
        leftIndices[targetIndex] = right
        rightIndices[targetIndex] = right
        continue
      }
      const logLeft = Math.log(sourceCentres[left])
      const logRight = Math.log(sourceCentres[right])
      leftIndices[targetIndex] = left
      rightIndices[targetIndex] = right
      mixes[targetIndex] = Math.min(
        1,
        Math.max(
          0,
          (Math.log(targetFrequency) - logLeft) / (logRight - logLeft),
        ),
      )
    }
  }
  return { sourceCentres: storedCentres, leftIndices, rightIndices, mixes }
}

export function sampleFrequencyWaveComponents(
  frame: SpectrumFrame,
  map: FrequencyWaveSampleMap,
  output: MutableLevels,
): void {
  const normaliser = Math.max(1, frame.max_levels)
  for (let index = 0; index < output.length; index += 1) {
    const left = map.leftIndices[index]
    const right = map.rightIndices[index]
    if (left < 0 || right < 0) {
      output[index] = 0
      continue
    }
    const mix = map.mixes[index]
    const leftLevel = frame.levels[left] ?? 0
    const rightLevel = frame.levels[right] ?? leftLevel
    output[index] = Math.min(
      1,
      Math.max(0, (leftLevel + (rightLevel - leftLevel) * mix) / normaliser),
    )
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
      updateFrequencyWaveLevels(
        componentLevels,
        componentTargets,
        frame.deltaSeconds,
        COMPONENT_ATTACK_RATE,
        COMPONENT_RELEASE_RATE,
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

function createFrequencyWaveGeometry(width: number): FrequencyWaveGeometry {
  const sampleCount = Math.max(2, Math.ceil(width / SAMPLE_SPACING) + 1)
  const xPositions = new Float32Array(sampleCount)
  const basis = new Float32Array(COMPONENT_COUNT * sampleCount)
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const xRatio = sample / (sampleCount - 1)
    xPositions[sample] = width * xRatio
    for (let band = 0; band < BAND_COUNT; band += 1) {
      for (
        let component = 0;
        component < FREQUENCY_WAVE_COMPONENTS_PER_BAND;
        component += 1
      ) {
        const componentIndex =
          band * FREQUENCY_WAVE_COMPONENTS_PER_BAND + component
        basis[componentIndex * sampleCount + sample] = frequencyWaveBasisValue(
          band,
          component,
          xRatio,
        )
      }
    }
  }
  return {
    width,
    sampleCount,
    xPositions,
    basis,
    shapes: new Float32Array(BAND_COUNT * sampleCount),
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
  const { basis, sampleCount, shapes, xPositions } = geometry

  context.globalCompositeOperation = 'lighter'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const componentOffset = band * FREQUENCY_WAVE_COMPONENTS_PER_BAND
    const shapeOffset = band * sampleCount
    let peak = 0
    for (let sample = 0; sample < sampleCount; sample += 1) {
      let value = 0
      for (
        let component = 0;
        component < FREQUENCY_WAVE_COMPONENTS_PER_BAND;
        component += 1
      ) {
        const componentIndex = componentOffset + component
        value +=
          componentLevels[componentIndex] *
          basis[componentIndex * sampleCount + sample]
      }
      shapes[shapeOffset + sample] = value
      peak = Math.max(peak, Math.abs(value))
    }

    const colour = FREQUENCY_WAVE_COLOURS[band]
    const amplitude = frequencyWaveAmplitude(bandLevels[band], height)
    const normaliser = peak > 0.000001 ? peak : 1
    context.beginPath()
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const y = frequencyWaveY(
        centre,
        amplitude,
        shapes[shapeOffset + sample] / normaliser,
      )
      if (sample === 0) context.moveTo(xPositions[sample], y)
      else context.lineTo(xPositions[sample], y)
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
