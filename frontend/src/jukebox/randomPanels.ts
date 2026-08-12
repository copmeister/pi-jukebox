import type { Track } from '../api/types'

export type RandomSource = () => number

function randomIndex(maxExclusive: number, random: RandomSource): number {
  const value = random()
  const bounded = Number.isFinite(value)
    ? Math.max(0, Math.min(0.9999999999999999, value))
    : 0
  return Math.floor(bounded * maxExclusive)
}

export function fisherYates<T>(items: readonly T[], random: RandomSource): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random)
    ;[shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ]
  }
  return shuffled
}

function moveBoundaryDuplicate(
  cycle: Track[],
  previousTrackId: number | undefined,
): void {
  if (cycle.length < 2 || cycle[0].id !== previousTrackId) return
  const replacement = cycle.findIndex((track) => track.id !== previousTrackId)
  if (replacement > 0) {
    ;[cycle[0], cycle[replacement]] = [cycle[replacement], cycle[0]]
  }
}

export function generatePanel(
  tracks: readonly Track[],
  panelSize = 8,
  random: RandomSource = Math.random,
  previousTrackId?: number,
): Track[] {
  if (tracks.length === 0 || panelSize <= 0) return []

  const panel: Track[] = []
  while (panel.length < panelSize) {
    const cycle = fisherYates(tracks, random)
    moveBoundaryDuplicate(cycle, panel.at(-1)?.id ?? previousTrackId)
    panel.push(...cycle.slice(0, panelSize - panel.length))
  }
  return panel
}

export function generatePanels(
  tracks: readonly Track[],
  panelCount = 4,
  panelSize = 8,
  random: RandomSource = Math.random,
): Track[][] {
  const capacity = panelCount * panelSize
  if (tracks.length >= capacity) {
    const shuffled = fisherYates(tracks, random)
    return Array.from({ length: panelCount }, (_, index) =>
      shuffled.slice(index * panelSize, (index + 1) * panelSize),
    )
  }

  if (tracks.length < panelSize) {
    const panels: Track[][] = []
    let previousTrackId: number | undefined
    for (let index = 0; index < panelCount; index += 1) {
      const panel = generatePanel(tracks, panelSize, random, previousTrackId)
      panels.push(panel)
      previousTrackId = panel.at(-1)?.id
    }
    return panels
  }

  const panels: Track[][] = []
  let bag: Track[] = []
  for (let panelIndex = 0; panelIndex < panelCount; panelIndex += 1) {
    const panel: Track[] = []
    const panelTrackIds = new Set<number>()
    const deferred: Track[] = []
    while (panel.length < panelSize) {
      if (bag.length === 0) bag = fisherYates(tracks, random)
      const candidate = bag.shift()!
      if (panelTrackIds.has(candidate.id)) {
        deferred.push(candidate)
        continue
      }
      panel.push(candidate)
      panelTrackIds.add(candidate.id)
    }
    bag = [...deferred, ...bag]
    panels.push(panel)
  }
  return panels
}

export function generateReplacementPanel(
  tracks: readonly Track[],
  outgoingTracks: readonly Track[],
  panelSize = 8,
  random: RandomSource = Math.random,
  previousTrackId?: number,
): Track[] {
  const panel = generatePanel(tracks, panelSize, random, previousTrackId)
  if (tracks.length <= panelSize || panel.length === 0) return panel

  const outgoingIds = new Set(outgoingTracks.map((track) => track.id))
  const isSameGroup =
    panel.length === outgoingTracks.length &&
    panel.every((track) => outgoingIds.has(track.id))
  if (!isSameGroup) return panel

  const replacement = fisherYates(
    tracks.filter((track) => !outgoingIds.has(track.id)),
    random,
  )[0]
  if (replacement) panel[panel.length - 1] = replacement
  return panel
}
