import { describe, expect, it } from 'vitest'
import type { Track } from '../api/types'
import { groupAlbumTracks } from './albumTrackGroups'

function track(
  id: number,
  discNumber: number | null,
  trackNumber: number,
): Track {
  return {
    id,
    album_id: 1,
    relative_path: `${id}.flac`,
    filename: `${id}.flac`,
    title: `Track ${id}`,
    artist: 'Artist',
    album_artist: 'Artist',
    album: 'Album',
    disc_number: discNumber,
    track_number: trackNumber,
    duration_seconds: 60,
    file_format: 'flac',
    playback_support: 'required',
    artwork_id: null,
  }
}

describe('album track grouping', () => {
  it('groups genuine multi-disc albums without changing clean track titles', () => {
    const groups = groupAlbumTracks([
      track(1, 1, 1),
      track(2, 1, 2),
      track(3, 2, 1),
      track(4, 2, 2),
    ])

    expect(groups.map((group) => group.label)).toEqual(['Disc 1', 'Disc 2'])
    expect(groups.map((group) => group.tracks.map((item) => item.id))).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(
      groups.flatMap((group) => group.tracks.map((item) => item.title)),
    ).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4'])
  })

  it('does not add a Disc 1 heading to an ordinary single-disc album', () => {
    const groups = groupAlbumTracks([track(1, 1, 1), track(2, 1, 2)])

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBeNull()
  })

  it('keeps missing disc metadata unlabelled unless multiple real discs exist', () => {
    expect(
      groupAlbumTracks([track(1, null, 1), track(2, 1, 2)])[0].label,
    ).toBeNull()

    const groups = groupAlbumTracks([
      track(1, 1, 1),
      track(2, 2, 1),
      track(3, null, 3),
    ])
    expect(groups.map((group) => group.label)).toEqual([
      'Disc 1',
      'Disc 2',
      'Other tracks',
    ])
  })
})
