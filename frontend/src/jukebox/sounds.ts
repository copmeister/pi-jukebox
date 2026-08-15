import { useCallback, useRef, useState } from 'react'
import {
  DEFAULT_JUKEBOX_SOUND_SETTINGS,
  type JukeboxSoundSettings,
  loadJukeboxSoundSettings,
  saveJukeboxSoundSettings,
  validateJukeboxSoundSettings,
} from './soundSettings'

export type JukeboxSoundCategory =
  'button' | 'movement' | 'confirmation' | 'loading'

export interface JukeboxSoundController {
  settings: JukeboxSoundSettings
  updateSettings: (changes: Partial<JukeboxSoundSettings>) => void
  resetSettings: () => void
  playButton: () => void
  playMovement: (durationMs: number) => void
  playConfirmation: () => void
  playLoading: (durationMs: number) => () => void
  preview: (category: JukeboxSoundCategory) => void
}

type AudioContextFactory = () => AudioContext

function browserAudioContext(): AudioContext {
  const audioWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext
  }
  const Constructor = window.AudioContext ?? audioWindow.webkitAudioContext
  if (!Constructor) throw new Error('Web Audio is unavailable.')
  return new Constructor()
}

function safeExponentialRamp(
  parameter: AudioParam,
  value: number,
  time: number,
): void {
  parameter.exponentialRampToValueAtTime(Math.max(0.0001, value), time)
}

export class JukeboxSoundEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null

  constructor(
    private readonly createContext: AudioContextFactory = browserAudioContext,
  ) {}

  playButton(settings: JukeboxSoundSettings): void {
    this.play('button', settings)
  }

  playMovement(settings: JukeboxSoundSettings, durationMs: number): void {
    this.play('movement', settings, durationMs)
  }

  playConfirmation(settings: JukeboxSoundSettings): void {
    this.play('confirmation', settings)
  }

  playLoading(settings: JukeboxSoundSettings, durationMs: number): () => void {
    if (
      !settings.enabled ||
      settings.masterVolume <= 0 ||
      settings.loadingVolume <= 0
    )
      return () => undefined

    let cancelled = false
    let cancelScheduled: () => void = () => undefined
    try {
      const context = this.ensureContext(settings.masterVolume)
      const schedule = () => {
        if (cancelled) return
        try {
          cancelScheduled = this.scheduleLoading(context, settings, durationMs)
        } catch {
          // The independent loading timer still starts music if synthesis fails.
        }
      }
      if (context.state === 'suspended') {
        void context
          .resume()
          .then(schedule)
          .catch(() => undefined)
      } else {
        schedule()
      }
    } catch {
      // Web Audio is optional; the presentation delay remains functional.
    }

    return () => {
      cancelled = true
      cancelScheduled()
    }
  }

  private categoryVolume(
    category: JukeboxSoundCategory,
    settings: JukeboxSoundSettings,
  ): number {
    if (category === 'button') return settings.buttonVolume
    if (category === 'movement') return settings.movementVolume
    if (category === 'confirmation') return settings.confirmationVolume
    return settings.loadingVolume
  }

  private play(
    category: JukeboxSoundCategory,
    settings: JukeboxSoundSettings,
    durationMs = 320,
  ): void {
    if (
      !settings.enabled ||
      settings.masterVolume <= 0 ||
      this.categoryVolume(category, settings) <= 0
    )
      return

    try {
      const context = this.ensureContext(settings.masterVolume)
      const schedule = () => {
        try {
          if (category === 'button') this.scheduleButton(context, settings)
          else if (category === 'movement')
            this.scheduleMovement(context, settings, durationMs)
          else this.scheduleConfirmation(context, settings)
        } catch {
          // Sound design must never interrupt selector or playback behavior.
        }
      }
      if (context.state === 'suspended') {
        void context
          .resume()
          .then(schedule)
          .catch(() => undefined)
      } else {
        schedule()
      }
    } catch {
      // Web Audio is an enhancement; unsupported or failed contexts stay silent.
    }
  }

  private ensureContext(masterVolume: number): AudioContext {
    if (!this.context) {
      this.context = this.createContext()
      this.masterGain = this.context.createGain()
      this.compressor = this.context.createDynamicsCompressor()
      this.compressor.threshold.value = -12
      this.compressor.knee.value = 16
      this.compressor.ratio.value = 5
      this.compressor.attack.value = 0.003
      this.compressor.release.value = 0.12
      this.masterGain.connect(this.compressor)
      this.compressor.connect(this.context.destination)
    }
    this.masterGain!.gain.setValueAtTime(masterVolume, this.context.currentTime)
    return this.context
  }

  private createNoiseSource(context: AudioContext, durationSeconds: number) {
    const frameCount = Math.max(
      1,
      Math.ceil(context.sampleRate * durationSeconds),
    )
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = Math.random() * 2 - 1
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    return source
  }

  private scheduleButton(
    context: AudioContext,
    settings: JukeboxSoundSettings,
  ): void {
    const now = context.currentTime
    const output = context.createGain()
    output.gain.setValueAtTime(settings.buttonVolume, now)
    output.connect(this.masterGain!)

    const contact = this.createNoiseSource(context, 0.028)
    const contactFilter = context.createBiquadFilter()
    const contactGain = context.createGain()
    contactFilter.type = 'bandpass'
    contactFilter.frequency.setValueAtTime(1700, now)
    contactFilter.Q.setValueAtTime(0.75, now)
    contactGain.gain.setValueAtTime(0.17, now)
    safeExponentialRamp(contactGain.gain, 0.0001, now + 0.028)
    contact.connect(contactFilter)
    contactFilter.connect(contactGain)
    contactGain.connect(output)

    const thump = context.createOscillator()
    const thumpGain = context.createGain()
    thump.type = 'triangle'
    thump.frequency.setValueAtTime(176, now)
    thump.frequency.exponentialRampToValueAtTime(112, now + 0.09)
    thumpGain.gain.setValueAtTime(0.26, now)
    safeExponentialRamp(thumpGain.gain, 0.0001, now + 0.105)
    thump.connect(thumpGain)
    thumpGain.connect(output)

    const settle = this.createNoiseSource(context, 0.026)
    const settleFilter = context.createBiquadFilter()
    const settleGain = context.createGain()
    settleFilter.type = 'bandpass'
    settleFilter.frequency.setValueAtTime(980, now + 0.055)
    settleFilter.Q.setValueAtTime(0.65, now)
    settleGain.gain.setValueAtTime(0.1, now + 0.055)
    safeExponentialRamp(settleGain.gain, 0.0001, now + 0.081)
    settle.connect(settleFilter)
    settleFilter.connect(settleGain)
    settleGain.connect(output)

    contact.start(now)
    contact.stop(now + 0.028)
    thump.start(now)
    thump.stop(now + 0.115)
    settle.start(now + 0.055)
    settle.stop(now + 0.081)
    thump.addEventListener(
      'ended',
      () => {
        contact.disconnect()
        contactFilter.disconnect()
        contactGain.disconnect()
        thump.disconnect()
        thumpGain.disconnect()
        settle.disconnect()
        settleFilter.disconnect()
        settleGain.disconnect()
        output.disconnect()
      },
      { once: true },
    )
  }

  private scheduleMovement(
    context: AudioContext,
    settings: JukeboxSoundSettings,
    durationMs: number,
  ): void {
    const now = context.currentTime
    const duration = Math.max(0.08, Math.min(0.7, durationMs / 1000))
    const output = context.createGain()
    output.gain.setValueAtTime(settings.movementVolume, now)
    output.connect(this.masterGain!)

    const noise = this.createNoiseSource(context, duration)
    const filter = context.createBiquadFilter()
    const movementGain = context.createGain()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(520, now)
    filter.frequency.linearRampToValueAtTime(310, now + duration)
    filter.Q.setValueAtTime(0.65, now)
    movementGain.gain.setValueAtTime(0.0001, now)
    movementGain.gain.linearRampToValueAtTime(0.055, now + duration * 0.18)
    movementGain.gain.setValueAtTime(0.055, now + duration * 0.72)
    safeExponentialRamp(movementGain.gain, 0.0001, now + duration)
    noise.connect(filter)
    filter.connect(movementGain)
    movementGain.connect(output)

    const motor = context.createOscillator()
    const motorGain = context.createGain()
    motor.type = 'triangle'
    motor.frequency.setValueAtTime(68, now)
    motor.frequency.linearRampToValueAtTime(58, now + duration)
    motorGain.gain.setValueAtTime(0.0001, now)
    motorGain.gain.linearRampToValueAtTime(0.03, now + duration * 0.2)
    safeExponentialRamp(motorGain.gain, 0.0001, now + duration)
    motor.connect(motorGain)
    motorGain.connect(output)

    noise.start(now)
    noise.stop(now + duration)
    motor.start(now)
    motor.stop(now + duration)
    motor.addEventListener(
      'ended',
      () => {
        noise.disconnect()
        filter.disconnect()
        movementGain.disconnect()
        motor.disconnect()
        motorGain.disconnect()
        output.disconnect()
      },
      { once: true },
    )
  }

  private scheduleConfirmation(
    context: AudioContext,
    settings: JukeboxSoundSettings,
  ): void {
    const now = context.currentTime
    const output = context.createGain()
    output.gain.setValueAtTime(settings.confirmationVolume, now)
    output.connect(this.masterGain!)

    const latch = this.createNoiseSource(context, 0.052)
    const latchFilter = context.createBiquadFilter()
    const latchGain = context.createGain()
    latchFilter.type = 'bandpass'
    latchFilter.frequency.setValueAtTime(820, now)
    latchFilter.Q.setValueAtTime(0.7, now)
    latchGain.gain.setValueAtTime(0.2, now)
    safeExponentialRamp(latchGain.gain, 0.0001, now + 0.052)
    latch.connect(latchFilter)
    latchFilter.connect(latchGain)
    latchGain.connect(output)

    const clunk = context.createOscillator()
    const clunkGain = context.createGain()
    clunk.type = 'triangle'
    clunk.frequency.setValueAtTime(156, now)
    clunk.frequency.exponentialRampToValueAtTime(108, now + 0.12)
    clunkGain.gain.setValueAtTime(0.24, now)
    safeExponentialRamp(clunkGain.gain, 0.0001, now + 0.14)
    clunk.connect(clunkGain)
    clunkGain.connect(output)

    const relay = this.createNoiseSource(context, 0.04)
    const relayFilter = context.createBiquadFilter()
    const relayGain = context.createGain()
    relayFilter.type = 'bandpass'
    relayFilter.frequency.setValueAtTime(1450, now + 0.075)
    relayFilter.Q.setValueAtTime(0.8, now)
    relayGain.gain.setValueAtTime(0.12, now + 0.075)
    safeExponentialRamp(relayGain.gain, 0.0001, now + 0.115)
    relay.connect(relayFilter)
    relayFilter.connect(relayGain)
    relayGain.connect(output)

    latch.start(now)
    latch.stop(now + 0.052)
    clunk.start(now)
    clunk.stop(now + 0.15)
    relay.start(now + 0.075)
    relay.stop(now + 0.115)
    clunk.addEventListener(
      'ended',
      () => {
        latch.disconnect()
        latchFilter.disconnect()
        latchGain.disconnect()
        clunk.disconnect()
        clunkGain.disconnect()
        relay.disconnect()
        relayFilter.disconnect()
        relayGain.disconnect()
        output.disconnect()
      },
      { once: true },
    )
  }

  private scheduleLoading(
    context: AudioContext,
    settings: JukeboxSoundSettings,
    durationMs: number,
  ): () => void {
    const now = context.currentTime
    const duration = Math.max(0.8, Math.min(1, durationMs / 1000))
    const output = context.createGain()
    output.gain.setValueAtTime(settings.loadingVolume, now)
    output.connect(this.masterGain!)

    const carriage = this.createNoiseSource(context, duration * 0.84)
    const carriageFilter = context.createBiquadFilter()
    const carriageGain = context.createGain()
    carriageFilter.type = 'bandpass'
    carriageFilter.frequency.setValueAtTime(420, now)
    carriageFilter.frequency.linearRampToValueAtTime(280, now + duration * 0.84)
    carriageFilter.Q.setValueAtTime(0.55, now)
    carriageGain.gain.setValueAtTime(0.0001, now)
    carriageGain.gain.linearRampToValueAtTime(0.035, now + duration * 0.12)
    carriageGain.gain.setValueAtTime(0.035, now + duration * 0.68)
    safeExponentialRamp(carriageGain.gain, 0.0001, now + duration * 0.84)
    carriage.connect(carriageFilter)
    carriageFilter.connect(carriageGain)
    carriageGain.connect(output)

    const motor = context.createOscillator()
    const motorGain = context.createGain()
    motor.type = 'triangle'
    motor.frequency.setValueAtTime(96, now)
    motor.frequency.linearRampToValueAtTime(78, now + duration * 0.82)
    motorGain.gain.setValueAtTime(0.0001, now)
    motorGain.gain.linearRampToValueAtTime(0.018, now + duration * 0.14)
    safeExponentialRamp(motorGain.gain, 0.0001, now + duration * 0.82)
    motor.connect(motorGain)
    motorGain.connect(output)

    const position = this.createNoiseSource(context, 0.038)
    const positionFilter = context.createBiquadFilter()
    const positionGain = context.createGain()
    positionFilter.type = 'bandpass'
    positionFilter.frequency.setValueAtTime(720, now + duration * 0.48)
    positionFilter.Q.setValueAtTime(0.65, now)
    positionGain.gain.setValueAtTime(0.055, now + duration * 0.48)
    safeExponentialRamp(
      positionGain.gain,
      0.0001,
      now + duration * 0.48 + 0.038,
    )
    position.connect(positionFilter)
    positionFilter.connect(positionGain)
    positionGain.connect(output)

    const contactStart = now + duration - 0.09
    const contact = this.createNoiseSource(context, 0.042)
    const contactFilter = context.createBiquadFilter()
    const contactGain = context.createGain()
    contactFilter.type = 'bandpass'
    contactFilter.frequency.setValueAtTime(1180, contactStart)
    contactFilter.Q.setValueAtTime(0.75, now)
    contactGain.gain.setValueAtTime(0.075, contactStart)
    safeExponentialRamp(contactGain.gain, 0.0001, contactStart + 0.042)
    contact.connect(contactFilter)
    contactFilter.connect(contactGain)
    contactGain.connect(output)

    const finalBody = context.createOscillator()
    const finalBodyGain = context.createGain()
    finalBody.type = 'triangle'
    finalBody.frequency.setValueAtTime(145, contactStart)
    finalBody.frequency.exponentialRampToValueAtTime(105, now + duration - 0.01)
    finalBodyGain.gain.setValueAtTime(0.065, contactStart)
    safeExponentialRamp(finalBodyGain.gain, 0.0001, now + duration - 0.01)
    finalBody.connect(finalBodyGain)
    finalBodyGain.connect(output)

    const sources: AudioScheduledSourceNode[] = [
      carriage,
      motor,
      position,
      contact,
      finalBody,
    ]
    const nodes: AudioNode[] = [
      carriage,
      carriageFilter,
      carriageGain,
      motor,
      motorGain,
      position,
      positionFilter,
      positionGain,
      contact,
      contactFilter,
      contactGain,
      finalBody,
      finalBodyGain,
      output,
    ]
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      for (const node of nodes) node.disconnect()
    }

    carriage.start(now)
    carriage.stop(now + duration * 0.84)
    motor.start(now)
    motor.stop(now + duration * 0.82)
    position.start(now + duration * 0.48)
    position.stop(now + duration * 0.48 + 0.038)
    contact.start(contactStart)
    contact.stop(contactStart + 0.042)
    finalBody.start(contactStart)
    finalBody.stop(now + duration - 0.005)
    finalBody.addEventListener('ended', cleanup, { once: true })

    return () => {
      for (const source of sources) {
        try {
          source.stop()
        } catch {
          // A source that already ended is safe to ignore during cancellation.
        }
      }
      cleanup()
    }
  }
}

export function useJukeboxSounds(): JukeboxSoundController {
  const [settings, setSettings] = useState(loadJukeboxSoundSettings)
  const settingsRef = useRef(settings)
  const engineRef = useRef<JukeboxSoundEngine | null>(null)

  const engine = () => {
    engineRef.current ??= new JukeboxSoundEngine()
    return engineRef.current
  }

  const updateSettings = useCallback(
    (changes: Partial<JukeboxSoundSettings>) => {
      setSettings((current) => {
        const next = validateJukeboxSoundSettings({ ...current, ...changes })
        settingsRef.current = next
        saveJukeboxSoundSettings(next)
        return next
      })
    },
    [],
  )

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_JUKEBOX_SOUND_SETTINGS }
    settingsRef.current = defaults
    setSettings(defaults)
    saveJukeboxSoundSettings(defaults)
  }, [])

  return {
    settings,
    updateSettings,
    resetSettings,
    playButton: () => engine().playButton(settingsRef.current),
    playMovement: (durationMs) =>
      engine().playMovement(settingsRef.current, durationMs),
    playConfirmation: () => engine().playConfirmation(settingsRef.current),
    playLoading: (durationMs) =>
      engine().playLoading(settingsRef.current, durationMs),
    preview: (category) => {
      if (category === 'button') engine().playButton(settingsRef.current)
      else if (category === 'movement')
        engine().playMovement(settingsRef.current, 320)
      else if (category === 'confirmation')
        engine().playConfirmation(settingsRef.current)
      else engine().playLoading(settingsRef.current, 900)
    },
  }
}
