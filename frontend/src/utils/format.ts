export function formatAlbumDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Duration unknown'
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${totalMinutes} min`
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

export function formatTrackDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0)
    return '–:––'
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  const remainingSeconds = rounded % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`
}
