/* eslint-disable react-refresh/only-export-components -- renderer limits are exported for tests */
import { useCallback } from 'react'
import type { SpectrumFrame } from '../api/types'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
  type CanvasRendererFrame,
} from './AudioReactiveCanvas'
import { GALAXY_BAND_EDGES } from './bandMapping'

export const GALAXY_MAX_PARTICLES = 300
export const GALAXY_MAX_SHOCKWAVES = 8

const COLOURS = [
  '#1a66ff',
  '#00bfff',
  '#00e6bf',
  '#73ff59',
  '#ff991a',
  '#fff2c7',
] as const
const BASE_RADIUS = [22, 17, 12, 8, 5, 3]
const BASE_SPEED = [0.035, 0.055, 0.075, 0.1, 0.15, 0.22]
const BASE_LIFETIME = [3.5, 3, 2.5, 2, 1.4, 0.8]
const MAX_SPAWN_RATE = [3, 6, 10, 15, 23, 34]
const SPAWN_THRESHOLD = [0.23, 0.2, 0.19, 0.18, 0.19, 0.2]
const SHOCKWAVE_LAYERS = [
  { colour: '#0a66ff', alpha: 0.14, width: 7 },
  { colour: '#0aa6ff', alpha: 0.28, width: 4.2 },
  { colour: '#40d9ff', alpha: 0.55, width: 2.2 },
  { colour: '#bff7ff', alpha: 1, width: 0.75 },
] as const

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  age: number
  lifetime: number
  band: number
}

interface Shockwave {
  x: number
  y: number
  age: number
  strength: number
}

interface Star {
  x: number
  y: number
  radius: number
  alpha: number
}

export function ParticleGalaxyCanvas({
  frame,
  onFailure,
}: {
  frame: SpectrumFrame | null
  onFailure?: () => void
}) {
  const createRenderer = useCallback(() => createGalaxyRenderer(), [])
  return (
    <AudioReactiveCanvas
      frame={frame}
      bandEdges={GALAXY_BAND_EDGES}
      createRenderer={createRenderer}
      label="Particle Galaxy audio visualiser"
      onFailure={onFailure}
    />
  )
}

export function createGalaxyRenderer(): AudioReactiveRenderer {
  const particles: Particle[] = []
  const pool: Particle[] = []
  const shockwaves: Shockwave[] = []
  const levels = new Array<number>(6).fill(0)
  const spawnCredit = new Array<number>(6).fill(0)
  const stars = createStars(120)
  const sprites = COLOURS.map((colour) => createParticleSprite(colour))
  let previousSubLevel = 0

  return {
    targetFps: 45,
    draw(frame) {
      updateGalaxy(
        frame,
        levels,
        spawnCredit,
        particles,
        pool,
        shockwaves,
        () => previousSubLevel,
        (level) => {
          previousSubLevel = level
        },
      )
      drawGalaxy(frame, particles, shockwaves, stars, sprites)
    },
    dispose() {
      particles.length = 0
      pool.length = 0
      shockwaves.length = 0
    },
  }
}

function updateGalaxy(
  frame: CanvasRendererFrame,
  levels: number[],
  spawnCredit: number[],
  particles: Particle[],
  pool: Particle[],
  shockwaves: Shockwave[],
  getPreviousSubLevel: () => number,
  setPreviousSubLevel: (level: number) => void,
) {
  const dt = frame.deltaSeconds
  for (let band = 0; band < 6; band += 1) {
    const target = frame.levels[band] ?? 0
    const blend = 1 - Math.exp(-(target > levels[band] ? 22 : 6) * dt)
    levels[band] += (target - levels[band]) * blend
    const threshold = SPAWN_THRESHOLD[band]
    if (levels[band] > threshold) {
      const activity = (levels[band] - threshold) / (1 - threshold)
      spawnCredit[band] += activity * MAX_SPAWN_RATE[band] * dt
      while (
        spawnCredit[band] >= 1 &&
        particles.length < GALAXY_MAX_PARTICLES
      ) {
        spawnCredit[band] -= 1
        spawnParticle(particles, pool, band, levels[band])
      }
      spawnCredit[band] = Math.min(2, spawnCredit[band])
    }
  }

  const subLevel = levels[0]
  if (
    subLevel > 0.48 &&
    subLevel - getPreviousSubLevel() > 0.055 &&
    shockwaves.length < GALAXY_MAX_SHOCKWAVES
  ) {
    shockwaves.push({
      x: clamp(randomNormal(0.5, 0.16), 0.06, 0.94),
      y: clamp(randomNormal(0.5, 0.16), 0.1, 0.9),
      age: 0,
      strength: subLevel,
    })
  }
  setPreviousSubLevel(subLevel)

  let write = 0
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index]
    particle.age += dt
    if (particle.age >= particle.lifetime) {
      pool.push(particle)
      continue
    }
    particle.x = wrap(particle.x + particle.vx * dt)
    particle.y = wrap(particle.y + particle.vy * dt)
    particles[write] = particle
    write += 1
  }
  particles.length = write

  write = 0
  for (let index = 0; index < shockwaves.length; index += 1) {
    const wave = shockwaves[index]
    wave.age += dt
    if (wave.age < 1.5) {
      shockwaves[write] = wave
      write += 1
    }
  }
  shockwaves.length = write
}

function spawnParticle(
  particles: Particle[],
  pool: Particle[],
  band: number,
  level: number,
) {
  const particle = pool.pop() ?? ({} as Particle)
  particle.x = band <= 1 ? clamp(randomNormal(0.5, 0.24), 0, 1) : Math.random()
  particle.y = band <= 1 ? clamp(randomNormal(0.5, 0.24), 0, 1) : Math.random()
  const angle = Math.random() * Math.PI * 2
  const speed =
    BASE_SPEED[band] * randomBetween(0.65, 1.45) * (0.7 + 0.7 * level)
  particle.vx = Math.cos(angle) * speed
  particle.vy = Math.sin(angle) * speed
  const dx = particle.x - 0.5
  const dy = particle.y - 0.5
  const distance = Math.hypot(dx, dy)
  if (distance > 0.0001) {
    const outward = 0.012 + 0.025 * level
    particle.vx += (outward * dx) / distance
    particle.vy += (outward * dy) / distance
  }
  particle.radius =
    BASE_RADIUS[band] * randomBetween(0.65, 1.4) * (0.55 + 0.9 * level)
  particle.age = 0
  particle.lifetime = BASE_LIFETIME[band] * randomBetween(0.75, 1.25)
  particle.band = band
  particles.push(particle)
}

function drawGalaxy(
  { context, width, height }: CanvasRendererFrame,
  particles: readonly Particle[],
  shockwaves: readonly Shockwave[],
  stars: readonly Star[],
  sprites: readonly HTMLCanvasElement[],
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#02050c'
  context.fillRect(0, 0, width, height)

  context.fillStyle = '#8fc5ff'
  for (const star of stars) {
    context.globalAlpha = star.alpha
    context.beginPath()
    context.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2)
    context.fill()
  }

  context.globalCompositeOperation = 'lighter'
  const scale = Math.min(width, height) / 720
  for (const particle of particles) {
    const progress = particle.age / particle.lifetime
    const alpha = Math.min(1, progress / 0.1) * Math.pow(1 - progress, 1.5)
    const radius = particle.radius * Math.max(0.65, scale)
    const sprite = sprites[particle.band]
    context.globalAlpha = alpha
    context.drawImage(
      sprite,
      particle.x * width - radius * 3.25,
      particle.y * height - radius * 3.25,
      radius * 6.5,
      radius * 6.5,
    )
  }

  for (const wave of shockwaves) {
    const progress = wave.age / 1.5
    const radius = wave.age * 0.45 * Math.min(width, height)
    const alpha = (1 - progress) * 0.55 * wave.strength
    const x = wave.x * width
    const y = wave.y * height
    const lineWidth = 1.2 + 3 * (1 - progress)
    drawShockwaveRing(context, x, y, radius, alpha, lineWidth)
    drawShockwaveRing(
      context,
      x,
      y,
      radius + 0.045 * Math.min(width, height),
      alpha,
      lineWidth,
    )
  }
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
}

function drawShockwaveRing(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  width: number,
) {
  for (const layer of SHOCKWAVE_LAYERS) {
    context.globalAlpha = alpha * layer.alpha
    context.strokeStyle = layer.colour
    context.lineWidth = width * layer.width
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.stroke()
  }
}

function createParticleSprite(colour: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 48)
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(0.08, colour)
  gradient.addColorStop(0.28, `${colour}cc`)
  gradient.addColorStop(1, `${colour}00`)
  context.fillStyle = gradient
  context.fillRect(0, 0, 96, 96)
  return canvas
}

function createStars(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    radius: randomBetween(0.5, 1.7),
    alpha: randomBetween(0.08, 0.3),
  }))
}

function randomNormal(mean: number, deviation: number): number {
  const u = Math.max(Number.EPSILON, Math.random())
  const v = Math.random()
  return (
    mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  )
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function wrap(value: number): number {
  if (value < 0) return value + 1
  if (value > 1) return value - 1
  return value
}
