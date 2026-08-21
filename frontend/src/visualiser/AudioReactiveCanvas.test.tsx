import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AudioReactiveCanvas,
  type AudioReactiveRenderer,
} from './AudioReactiveCanvas'
import { GALAXY_BAND_EDGES } from './bandMapping'
import { FrequencyWavesCanvas } from './FrequencyWavesCanvas'

describe('AudioReactiveCanvas lifecycle', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('cancels and disposes the previous renderer when modes switch', () => {
    const cancel = vi.fn()
    let animationId = 10
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => animationId++),
    )
    vi.stubGlobal('cancelAnimationFrame', cancel)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D)

    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const renderer = (dispose: () => void): AudioReactiveRenderer => ({
      targetFps: 40,
      draw: vi.fn(),
      dispose,
    })
    const firstFactory = vi.fn(() => renderer(firstDispose))
    const secondFactory = vi.fn(() => renderer(secondDispose))

    const view = render(
      <AudioReactiveCanvas
        key="water"
        frame={null}
        bandEdges={GALAXY_BAND_EDGES}
        createRenderer={firstFactory}
        label="First renderer"
      />,
    )
    view.rerender(
      <AudioReactiveCanvas
        key="galaxy"
        frame={null}
        bandEdges={GALAXY_BAND_EDGES}
        createRenderer={secondFactory}
        label="Second renderer"
      />,
    )

    expect(firstFactory).toHaveBeenCalledOnce()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalled()
    view.unmount()
    expect(secondDispose).toHaveBeenCalledOnce()
  })

  it('cancels the Frequency Waves animation when it becomes inactive', () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42),
    )
    vi.stubGlobal('cancelAnimationFrame', cancel)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D)

    const view = render(<FrequencyWavesCanvas frame={null} />)
    expect(
      view.getByRole('img', { name: 'Frequency Waves audio visualiser' }),
    ).toBeInTheDocument()
    view.unmount()

    expect(cancel).toHaveBeenCalledWith(42)
  })

  it('caps Frequency Waves canvas oversampling on high-density displays', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 24),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2)
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getBoundingClientRect',
    ).mockReturnValue({ width: 100, height: 50 } as DOMRect)
    const setTransform = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform,
    } as unknown as CanvasRenderingContext2D)

    const view = render(<FrequencyWavesCanvas frame={null} />)
    const canvas = view.getByRole('img', {
      name: 'Frequency Waves audio visualiser',
    }) as HTMLCanvasElement

    expect(canvas.width).toBe(125)
    expect(canvas.height).toBe(63)
    expect(setTransform).toHaveBeenCalledWith(1.25, 0, 0, 1.25, 0, 0)
  })
})
