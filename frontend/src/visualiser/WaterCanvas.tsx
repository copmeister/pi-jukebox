/* eslint-disable react-refresh/only-export-components -- renderer limits are exported for tests */
import { useCallback } from 'react'
import type { SpectrumFrame } from '../api/types'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
  type CanvasRendererFrame,
} from './AudioReactiveCanvas'
import { WATER_BAND_EDGES } from './bandMapping'

export const WATER_MAX_RIPPLES = 28

const WAVELENGTHS = [0.125, 0.1, 0.078, 0.058, 0.04, 0.027]
const RING_COUNTS = [3.2, 3, 2.8, 2.6, 2.3, 2]
const WAVE_SPEEDS = [0.34, 0.37, 0.4, 0.43, 0.47, 0.51]
const BAND_STRENGTH = [1, 0.86, 0.72, 0.58, 0.44, 0.32]
const WAVE_DECAY = [0.46, 0.52, 0.58, 0.66, 0.76, 0.9]
const MAX_EVENT_RATE = [1.4, 1.7, 2, 2.5, 3.1, 3.8]
const EVENT_THRESHOLD = [0.18, 0.18, 0.2, 0.22, 0.24, 0.26]

interface Ripple {
  x: number
  y: number
  age: number
  amplitude: number
  wavelength: number
  speed: number
  rings: number
  decay: number
  band: number
}

export function WaterCanvas({
  frame,
  onFailure,
}: {
  frame: SpectrumFrame | null
  onFailure?: () => void
}) {
  const createRenderer = useCallback(() => createWaterRenderer(), [])
  return (
    <AudioReactiveCanvas
      frame={frame}
      bandEdges={WATER_BAND_EDGES}
      createRenderer={createRenderer}
      label="Water audio visualiser"
      onFailure={onFailure}
    />
  )
}

export function createWaterRenderer(): AudioReactiveRenderer {
  const ripples: Ripple[] = []
  const pool: Ripple[] = []
  const levels = new Array<number>(6).fill(0)
  const eventCredit = new Array<number>(6).fill(0)
  let gradient: CanvasGradient | null = null
  let gradientHeight = 0

  return {
    targetFps: 40,
    draw(frame) {
      if (!gradient || gradientHeight !== frame.height) {
        gradientHeight = frame.height
        gradient = frame.context.createLinearGradient(0, 0, 0, frame.height)
        gradient.addColorStop(0, '#075f78')
        gradient.addColorStop(0.42, '#063a57')
        gradient.addColorStop(1, '#031b2c')
      }
      updateWater(frame, levels, eventCredit, ripples, pool)
      drawWater(frame, ripples, gradient)
    },
    dispose() {
      ripples.length = 0
      pool.length = 0
    },
  }
}

function updateWater(
  frame: CanvasRendererFrame,
  levels: number[],
  eventCredit: number[],
  ripples: Ripple[],
  pool: Ripple[],
) {
  const dt = frame.deltaSeconds
  for (let band = 0; band < 6; band += 1) {
    const target = frame.levels[band] ?? 0
    const blend = 1 - Math.exp(-(target > levels[band] ? 22 : 7) * dt)
    levels[band] += (target - levels[band]) * blend
    const threshold = EVENT_THRESHOLD[band]
    if (levels[band] <= threshold) continue
    const activity = (levels[band] - threshold) / (1 - threshold)
    eventCredit[band] += activity * MAX_EVENT_RATE[band] * dt
    while (eventCredit[band] >= 1 && ripples.length < WATER_MAX_RIPPLES) {
      eventCredit[band] -= 1
      spawnRipple(ripples, pool, band, levels[band])
    }
    eventCredit[band] = Math.min(2, eventCredit[band])
  }

  let write = 0
  for (let index = 0; index < ripples.length; index += 1) {
    const ripple = ripples[index]
    ripple.age += dt
    const amplitude = ripple.amplitude * Math.exp(-ripple.decay * ripple.age)
    if (ripple.age > 6 || amplitude < 0.025) {
      pool.push(ripple)
      continue
    }
    ripples[write] = ripple
    write += 1
  }
  ripples.length = write
}

function spawnRipple(
  ripples: Ripple[],
  pool: Ripple[],
  band: number,
  level: number,
) {
  const ripple = pool.pop() ?? ({} as Ripple)
  ripple.x = randomBetween(0.035, 0.965)
  ripple.y = randomBetween(0.035, 0.965)
  ripple.age = 0
  ripple.amplitude =
    BAND_STRENGTH[band] * (0.35 + 0.9 * level) * randomBetween(0.82, 1.18)
  ripple.wavelength = WAVELENGTHS[band] * randomBetween(0.9, 1.1)
  ripple.speed = WAVE_SPEEDS[band]
  ripple.rings = RING_COUNTS[band]
  ripple.decay = WAVE_DECAY[band]
  ripple.band = band
  ripples.push(ripple)
}

function drawWater(
  { context, width, height, time }: CanvasRendererFrame,
  ripples: readonly Ripple[],
  gradient: CanvasGradient,
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  drawWaterTexture(context, width, height, time)

  const scale = Math.min(width, height)
  context.globalCompositeOperation = 'screen'
  for (const ripple of ripples) {
    const radius = ripple.speed * ripple.age * scale
    const amplitude = ripple.amplitude * Math.exp(-ripple.decay * ripple.age)
    drawRippleSource(
      context,
      ripple,
      ripple.x * width,
      ripple.y * height,
      radius,
      amplitude,
      scale,
      width,
      height,
    )
    const reflection = amplitude * 0.52
    drawRippleSource(
      context,
      ripple,
      -ripple.x * width,
      ripple.y * height,
      radius,
      reflection,
      scale,
      width,
      height,
    )
    drawRippleSource(
      context,
      ripple,
      (2 - ripple.x) * width,
      ripple.y * height,
      radius,
      reflection,
      scale,
      width,
      height,
    )
    drawRippleSource(
      context,
      ripple,
      ripple.x * width,
      -ripple.y * height,
      radius,
      reflection,
      scale,
      width,
      height,
    )
    drawRippleSource(
      context,
      ripple,
      ripple.x * width,
      (2 - ripple.y) * height,
      radius,
      reflection,
      scale,
      width,
      height,
    )
  }
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
}

function drawRippleSource(
  context: CanvasRenderingContext2D,
  ripple: Ripple,
  x: number,
  y: number,
  radius: number,
  amplitude: number,
  scale: number,
  width: number,
  height: number,
) {
  const wavelength = ripple.wavelength * scale
  const reach = radius + wavelength * ripple.rings
  if (x + reach < 0 || x - reach > width || y + reach < 0 || y - reach > height)
    return
  const ringCount = Math.ceil(ripple.rings)
  for (let ring = 0; ring < ringCount; ring += 1) {
    const ringRadius = radius - ring * wavelength
    if (ringRadius <= 0) continue
    const trailFade = Math.exp((-2 * ring) / ripple.rings)
    const alpha = Math.min(0.72, amplitude * trailFade * 0.5)
    context.globalAlpha = alpha * 0.2
    context.strokeStyle = '#19bbc1'
    context.lineWidth = Math.max(4, wavelength * 0.22)
    context.beginPath()
    context.arc(x, y, ringRadius, 0, Math.PI * 2)
    context.stroke()
    context.globalAlpha = alpha
    context.strokeStyle = ring % 2 === 0 ? '#b8ffff' : '#078da0'
    context.lineWidth = Math.max(1, wavelength * 0.045)
    context.beginPath()
    context.arc(x, y, ringRadius, 0, Math.PI * 2)
    context.stroke()
  }
}

function drawWaterTexture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
) {
  context.save()
  context.globalAlpha = 0.12
  context.strokeStyle = '#6cdddd'
  context.lineWidth = 1
  const spacing = Math.max(24, height / 20)
  for (let y = -spacing; y < height + spacing; y += spacing) {
    context.beginPath()
    for (let x = 0; x <= width; x += 32) {
      const waveY = y + Math.sin(x * 0.025 + time * 0.7 + y * 0.01) * 3
      if (x === 0) context.moveTo(x, waveY)
      else context.lineTo(x, waveY)
    }
    context.stroke()
  }
  context.restore()
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum)
}
