import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_JUKEBOX_SOUND_SETTINGS } from './soundSettings'
import { JukeboxSoundEngine } from './sounds'

class FakeAudioParam {
  value = 0
  scheduled: number[] = []

  setValueAtTime(value: number) {
    this.value = value
    this.scheduled.push(value)
  }

  linearRampToValueAtTime(value: number) {
    this.value = value
    this.scheduled.push(value)
  }

  exponentialRampToValueAtTime(value: number) {
    this.value = value
    this.scheduled.push(value)
  }
}

class FakeNode {
  disconnect = vi.fn()
  connect = vi.fn(() => this)
}

class FakeSourceNode extends FakeNode {
  start = vi.fn()
  stop = vi.fn()
  listeners = new Map<string, () => void>()

  addEventListener(name: string, callback: EventListenerOrEventListenerObject) {
    if (typeof callback === 'function') {
      this.listeners.set(name, () => callback(new Event(name)))
    }
  }

  end() {
    this.listeners.get('ended')?.()
  }
}

class FakeGainNode extends FakeNode {
  gain = new FakeAudioParam()
}

class FakeOscillatorNode extends FakeSourceNode {
  type: OscillatorType = 'sine'
  frequency = new FakeAudioParam()
}

class FakeFilterNode extends FakeNode {
  type: BiquadFilterType = 'lowpass'
  frequency = new FakeAudioParam()
  Q = new FakeAudioParam()
}

class FakeCompressorNode extends FakeNode {
  threshold = new FakeAudioParam()
  knee = new FakeAudioParam()
  ratio = new FakeAudioParam()
  attack = new FakeAudioParam()
  release = new FakeAudioParam()
}

class FakeAudioContext {
  currentTime = 2
  sampleRate = 1000
  state: AudioContextState = 'running'
  destination = new FakeNode()
  gains: FakeGainNode[] = []
  sources: FakeSourceNode[] = []
  oscillators: FakeOscillatorNode[] = []
  resume = vi.fn(async () => undefined)

  createGain() {
    const node = new FakeGainNode()
    this.gains.push(node)
    return node
  }

  createDynamicsCompressor() {
    return new FakeCompressorNode()
  }

  createBuffer(_channels: number, frames: number) {
    return {
      getChannelData: () => new Float32Array(frames),
    }
  }

  createBufferSource() {
    const node = new FakeSourceNode() as FakeSourceNode & {
      buffer: unknown
    }
    node.buffer = null
    this.sources.push(node)
    return node
  }

  createBiquadFilter() {
    return new FakeFilterNode()
  }

  createOscillator() {
    const node = new FakeOscillatorNode()
    this.oscillators.push(node)
    this.sources.push(node)
    return node
  }
}

describe('Jukebox Web Audio engine', () => {
  it('creates no AudioContext before an audible qualifying effect', () => {
    const factory = vi.fn(
      () => new FakeAudioContext() as unknown as AudioContext,
    )
    const engine = new JukeboxSoundEngine(factory)

    expect(factory).not.toHaveBeenCalled()
    engine.playButton({
      ...DEFAULT_JUKEBOX_SOUND_SETTINGS,
      enabled: false,
    })
    engine.playMovement(
      { ...DEFAULT_JUKEBOX_SOUND_SETTINGS, movementVolume: 0 },
      320,
    )
    expect(factory).not.toHaveBeenCalled()
  })

  it('schedules distinct short effects through one conservative master path', () => {
    const context = new FakeAudioContext()
    const factory = vi.fn(() => context as unknown as AudioContext)
    const engine = new JukeboxSoundEngine(factory)

    engine.playButton(DEFAULT_JUKEBOX_SOUND_SETTINGS)
    const afterButton = context.oscillators.length
    engine.playMovement(DEFAULT_JUKEBOX_SOUND_SETTINGS, 320)
    const afterMovement = context.oscillators.length
    engine.playConfirmation(DEFAULT_JUKEBOX_SOUND_SETTINGS)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(afterButton).toBe(1)
    expect(afterMovement).toBe(2)
    expect(context.oscillators).toHaveLength(3)
    expect(
      context.gains.some((gain) => gain.gain.scheduled.includes(0.6)),
    ).toBe(true)
    expect(
      context.gains.some((gain) => gain.gain.scheduled.includes(0.7)),
    ).toBe(true)
    expect(
      context.gains.some((gain) => gain.gain.scheduled.includes(0.35)),
    ).toBe(true)
    expect(
      context.gains.some((gain) => gain.gain.scheduled.includes(0.65)),
    ).toBe(true)

    expect(
      context.gains.some((gain) => gain.gain.scheduled.includes(0.26)),
    ).toBe(true)

    context.oscillators.at(-1)?.end()
    expect(context.gains.at(-1)?.disconnect).toHaveBeenCalled()
  })

  it('uses a short low mechanical latch without a long notification tone', () => {
    const context = new FakeAudioContext()
    const engine = new JukeboxSoundEngine(
      () => context as unknown as AudioContext,
    )

    engine.playConfirmation(DEFAULT_JUKEBOX_SOUND_SETTINGS)

    expect(context.oscillators).toHaveLength(1)
    const clunk = context.oscillators[0]
    expect(clunk.type).toBe('triangle')
    expect(Math.max(...clunk.frequency.scheduled)).toBeLessThanOrEqual(200)
    expect(
      Number(clunk.stop.mock.calls[0][0]) -
        Number(clunk.start.mock.calls[0][0]),
    ).toBeLessThanOrEqual(0.16)
    expect(context.sources).toHaveLength(3)
    expect(context.sources[2].start).toHaveBeenCalledWith(2.075)
  })

  it('schedules and cancels the quiet loading mechanism independently', () => {
    const context = new FakeAudioContext()
    const engine = new JukeboxSoundEngine(
      () => context as unknown as AudioContext,
    )

    const cancel = engine.playLoading(DEFAULT_JUKEBOX_SOUND_SETTINGS, 900)

    expect(context.sources).toHaveLength(5)
    expect(context.oscillators).toHaveLength(2)
    expect(
      context.gains.some((gain) => gain.gain.scheduled.includes(0.45)),
    ).toBe(true)
    cancel()
    expect(
      context.sources.every((source) => source.stop.mock.calls.length > 0),
    ).toBe(true)
    expect(context.gains.at(-1)?.disconnect).toHaveBeenCalled()

    const silentContext = new FakeAudioContext()
    const silentFactory = vi.fn(() => silentContext as unknown as AudioContext)
    const silentEngine = new JukeboxSoundEngine(silentFactory)
    silentEngine.playLoading(
      { ...DEFAULT_JUKEBOX_SOUND_SETTINGS, loadingVolume: 0 },
      900,
    )
    expect(silentFactory).not.toHaveBeenCalled()
  })

  it('resumes suspended contexts and never exposes sound-engine failures', async () => {
    const context = new FakeAudioContext()
    context.state = 'suspended'
    const engine = new JukeboxSoundEngine(
      () => context as unknown as AudioContext,
    )

    expect(() =>
      engine.playButton(DEFAULT_JUKEBOX_SOUND_SETTINGS),
    ).not.toThrow()
    await Promise.resolve()
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.oscillators).toHaveLength(1)

    const failed = new JukeboxSoundEngine(() => {
      throw new Error('audio hardware unavailable')
    })
    expect(() =>
      failed.playConfirmation(DEFAULT_JUKEBOX_SOUND_SETTINGS),
    ).not.toThrow()
  })
})
