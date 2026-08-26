import { describe, expect, it } from 'vitest'
import type { RadioNowPlaying } from '../api/types'
import { radioNowPlayingText } from './nowPlaying'

function metadata(values: Partial<RadioNowPlaying>): RadioNowPlaying {
  return {
    station_id: 'classic-fm',
    available: true,
    kind: 'track',
    text: 'Composer — Work',
    artist: 'Composer',
    title: 'Work',
    ...values,
  }
}

describe('radio now-playing presentation', () => {
  it('shows genuine track and programme text', () => {
    expect(radioNowPlayingText(metadata({}))).toBe('Composer — Work')
    expect(
      radioNowPlayingText(
        metadata({
          kind: 'programme',
          text: "Leading Britain's Conversation — James O'Brien",
          artist: null,
          title: null,
        }),
      ),
    ).toBe("Leading Britain's Conversation — James O'Brien")
  })

  it('uses station-only fallback for unavailable or blank metadata', () => {
    expect(radioNowPlayingText(null)).toBeNull()
    expect(
      radioNowPlayingText(
        metadata({
          available: false,
          kind: 'none',
          text: null,
          artist: null,
          title: null,
        }),
      ),
    ).toBeNull()
    expect(radioNowPlayingText(metadata({ text: '   ' }))).toBeNull()
  })
})
