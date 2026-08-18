import { describe, expect, it } from 'vitest'
import type { Track } from '../api/types'
import {
  fisherYates,
  generatePanel,
  generatePanels,
  generateReplacementPanel,
} from './randomPanels'

function makeTracks(count: number): Track[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    album_id: 1,
    relative_path: `track-${index + 1}.mp3`,
    filename: `track-${index + 1}.mp3`,
    title: `Track ${index + 1}`,
    artist: `Artist ${index + 1}`,
    album_artist: 'Test Artist',
    album: 'Test Album',
    disc_number: 1,
    track_number: index + 1,
    duration_seconds: 180,
    file_format: 'mp3',
    playback_support: 'required',
    artwork_id: null,
  }))
}

describe('random jukebox panels', () => {
  it('uses deterministic injected randomness with Fisher-Yates', () => {
    const values = [0.1, 0.8, 0.3]
    let index = 0
    const first = fisherYates([1, 2, 3, 4], () => values[index++])
    index = 0
    const second = fisherYates([1, 2, 3, 4], () => values[index++])

    expect(first).toEqual(second)
    expect(first).toHaveLength(4)
    expect(new Set(first).size).toBe(4)
  })

  it('creates four eight-song panels without duplicates inside a panel for 17 tracks', () => {
    const panels = generatePanels(makeTracks(17), 4, 8, () => 0.37)

    expect(panels).toHaveLength(4)
    for (const panel of panels) {
      expect(panel).toHaveLength(8)
      expect(new Set(panel.map((track) => track.id)).size).toBe(8)
    }

    const occurrenceCounts = new Map<number, number>()
    for (const track of panels.flat()) {
      occurrenceCounts.set(track.id, (occurrenceCounts.get(track.id) ?? 0) + 1)
    }
    expect(Math.max(...occurrenceCounts.values())).toBe(2)
    expect(Math.min(...occurrenceCounts.values())).toBe(1)
  })

  it('uses every visible track only once when at least 32 are available', () => {
    const panels = generatePanels(makeTracks(40), 4, 8, () => 0.61)
    const visibleIds = panels.flat().map((track) => track.id)

    expect(visibleIds).toHaveLength(32)
    expect(new Set(visibleIds).size).toBe(32)
  })

  it('creates eighteen unique visible slots for the large 3×6 layout', () => {
    const panels = generatePanels(makeTracks(24), 3, 6, () => 0.51)
    const visibleIds = panels.flat().map((track) => track.id)

    expect(panels).toHaveLength(3)
    expect(panels.every((panel) => panel.length === 6)).toBe(true)
    expect(visibleIds).toHaveLength(18)
    expect(new Set(visibleIds).size).toBe(18)
  })

  it('fills an eight-song panel from newly shuffled small-library cycles', () => {
    const panel = generatePanel(makeTracks(3), 8, () => 0.25)

    expect(panel).toHaveLength(8)
    expect(new Set(panel.map((track) => track.id))).toEqual(new Set([1, 2, 3]))
    for (let index = 1; index < panel.length; index += 1) {
      expect(panel[index].id).not.toBe(panel[index - 1].id)
    }
  })

  it('gives a recycled panel a new group even with deterministic randomness', () => {
    const tracks = makeTracks(17)
    const outgoing = generatePanel(tracks, 8, () => 0.42)
    const incoming = generateReplacementPanel(tracks, outgoing, 8, () => 0.42)

    expect(incoming).toHaveLength(8)
    expect(new Set(incoming.map((track) => track.id)).size).toBe(8)
    expect(new Set(incoming.map((track) => track.id))).not.toEqual(
      new Set(outgoing.map((track) => track.id)),
    )
  })
})
