import type { RadioNowPlaying } from '../api/types'

export function radioNowPlayingText(
  metadata: RadioNowPlaying | null,
): string | null {
  if (!metadata?.available || !metadata.text?.trim()) return null
  return metadata.text.trim()
}
