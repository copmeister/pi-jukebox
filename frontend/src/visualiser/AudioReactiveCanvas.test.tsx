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
})
