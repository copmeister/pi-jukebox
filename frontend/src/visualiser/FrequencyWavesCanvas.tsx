/* eslint-disable react-refresh/only-export-components -- renderer constants are tested */
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
export const FREQUENCY_WAVE_CYCLES = [1.2, 1.75, 2.4, 3.15, 4.15, 5.35] as const
export const FREQUENCY_WAVE_PHASE_SPEEDS = [
  0.62, 0.78, 0.98, 1.2, 1.48, 1.8,
] as const

const BAND_COUNT = 6
const ATTACK_RATE = 24
const RELEASE_RATE = 6
const SILENCE_SNAP = 0.001
const SAMPLE_SPACING = 4

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
      onFailure={onFailure}
    />
  )
}

export function updateFrequencyWaveLevels(
  levels: number[],
  targets: readonly number[],
  deltaSeconds: number,
): void {
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const target = Math.min(1, Math.max(0, targets[band] ?? 0))
    const rate = target > levels[band] ? ATTACK_RATE : RELEASE_RATE
    const blend = 1 - Math.exp(-rate * Math.max(0, deltaSeconds))
    const next = levels[band] + (target - levels[band]) * blend
    levels[band] = target === 0 && next < SILENCE_SNAP ? 0 : next
  }
}

export function frequencyWaveAmplitude(
  level: number,
  height: number,
  band: number,
): number {
  if (level <= 0 || height <= 0) return 0
  const bandScale = 1 - Math.min(BAND_COUNT - 1, Math.max(0, band)) * 0.045
  return height * 0.22 * Math.pow(Math.min(1, level), 1.15) * bandScale
}

export function frequencyWaveY(
  centre: number,
  amplitude: number,
  xRatio: number,
  cycles: number,
  phase: number,
): number {
  if (amplitude === 0) return centre
  const angle = xRatio * cycles * Math.PI * 2 + phase
  const shape = Math.sin(angle) + 0.18 * Math.sin(angle * 2.03 - phase * 0.35)
  return centre + amplitude * (shape / 1.18)
}

export function createFrequencyWavesRenderer(): AudioReactiveRenderer {
  const levels = new Array<number>(BAND_COUNT).fill(0)
  const phases = new Array<number>(BAND_COUNT).fill(0)

  return {
    targetFps: 60,
    draw(frame) {
      updateFrequencyWaveLevels(levels, frame.levels, frame.deltaSeconds)
      for (let band = 0; band < BAND_COUNT; band += 1) {
        if (levels[band] > 0) {
          phases[band] =
            (phases[band] +
              frame.deltaSeconds *
                FREQUENCY_WAVE_PHASE_SPEEDS[band] *
                Math.PI *
                2) %
            (Math.PI * 2)
        }
      }
      drawFrequencyWaves(frame, levels, phases)
    },
    dispose() {
      levels.fill(0)
      phases.fill(0)
    },
  }
}

function drawFrequencyWaves(
  { context, width, height }: CanvasRendererFrame,
  levels: readonly number[],
  phases: readonly number[],
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#010208'
  context.fillRect(0, 0, width, height)
  const centre = height / 2

  context.globalCompositeOperation = 'lighter'
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const colour = FREQUENCY_WAVE_COLOURS[band]
    const amplitude = frequencyWaveAmplitude(levels[band], height, band)
    context.beginPath()
    for (let x = 0; x <= width; x += SAMPLE_SPACING) {
      const y = frequencyWaveY(
        centre,
        amplitude,
        width > 0 ? x / width : 0,
        FREQUENCY_WAVE_CYCLES[band],
        phases[band],
      )
      if (x === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    if (width % SAMPLE_SPACING !== 0) {
      context.lineTo(
        width,
        frequencyWaveY(
          centre,
          amplitude,
          1,
          FREQUENCY_WAVE_CYCLES[band],
          phases[band],
        ),
      )
    }

    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = colour
    context.globalAlpha = 0.2
    context.lineWidth = 10
    context.shadowColor = colour
    context.shadowBlur = 16
    context.stroke()
    context.globalAlpha = 0.96
    context.lineWidth = 2.6
    context.shadowBlur = 5
    context.stroke()
    context.restore()
  }
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
}
