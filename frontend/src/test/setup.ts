import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

const playingElements = new WeakSet<HTMLMediaElement>()

Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
  configurable: true,
  get() {
    return !playingElements.has(this)
  },
})

HTMLMediaElement.prototype.load = vi.fn(function (this: HTMLMediaElement) {
  this.dispatchEvent(new Event('loadstart'))
})
HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
  playingElements.add(this)
  this.dispatchEvent(new Event('playing'))
  return Promise.resolve()
})
HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
  playingElements.delete(this)
  this.dispatchEvent(new Event('pause'))
})
