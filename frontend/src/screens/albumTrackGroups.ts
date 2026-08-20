import type { Track } from '../api/types'

export interface AlbumTrackGroup {
  key: string
  label: string | null
  tracks: Track[]
}

export function groupAlbumTracks(tracks: readonly Track[]): AlbumTrackGroup[] {
  const discNumbers = Array.from(
    new Set(
      tracks
        .map((track) => track.disc_number)
        .filter(
          (discNumber): discNumber is number =>
            Number.isInteger(discNumber) && (discNumber ?? 0) > 0,
        ),
    ),
  ).sort((left, right) => left - right)

  if (discNumbers.length < 2) {
    return [{ key: 'album', label: null, tracks: [...tracks] }]
  }

  const groups = discNumbers.map((discNumber) => ({
    key: `disc-${discNumber}`,
    label: `Disc ${discNumber}`,
    tracks: tracks.filter((track) => track.disc_number === discNumber),
  }))
  const unnumbered = tracks.filter(
    (track) =>
      track.disc_number === null ||
      !Number.isInteger(track.disc_number) ||
      track.disc_number <= 0,
  )
  if (unnumbered.length) {
    groups.push({ key: 'other', label: 'Other tracks', tracks: unnumbered })
  }
  return groups
}
