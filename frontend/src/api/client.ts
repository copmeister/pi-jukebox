import type {
  AlbumDetail,
  AlbumSummary,
  ScanStart,
  ScanStatus,
  SearchResults,
  Track,
} from './types'

type JsonRecord = Record<string, unknown>
type Validator<T> = (value: unknown) => value is T

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
const API_BASE_URL = configuredBaseUrl.replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}/api${path}`
}

async function requestJson<T>(
  path: string,
  validate: Validator<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      headers: { Accept: 'application/json', ...init?.headers },
      ...init,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new ApiError(
      'The jukebox service is unavailable. Check that the backend is running.',
    )
  }

  if (!response.ok) {
    throw new ApiError(
      response.status === 409
        ? 'A library scan is already running.'
        : 'The jukebox service could not complete that request.',
      response.status,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('The jukebox service returned an unreadable response.')
  }
  if (!validate(payload)) {
    throw new ApiError('The jukebox service returned unexpected information.')
  }
  return payload
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isAlbumSummary(value: unknown): value is AlbumSummary {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    typeof value.title === 'string' &&
    typeof value.album_artist === 'string' &&
    isNullableNumber(value.artwork_id) &&
    isNumber(value.track_count) &&
    isNumber(value.duration_seconds)
  )
}

function isTrack(value: unknown): value is Track {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    isNumber(value.album_id) &&
    typeof value.relative_path === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    typeof value.album_artist === 'string' &&
    typeof value.album === 'string' &&
    isNullableNumber(value.disc_number) &&
    isNullableNumber(value.track_number) &&
    isNullableNumber(value.duration_seconds) &&
    typeof value.file_format === 'string' &&
    typeof value.playback_support === 'string' &&
    isNullableNumber(value.artwork_id)
  )
}

function isAlbumDetail(value: unknown): value is AlbumDetail {
  const tracks = isRecord(value) ? value.tracks : undefined
  return isAlbumSummary(value) && Array.isArray(tracks) && tracks.every(isTrack)
}

function isScanRun(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    ['running', 'completed', 'failed'].includes(String(value.status)) &&
    typeof value.started_at === 'string' &&
    isNullableString(value.finished_at) &&
    isNumber(value.files_discovered) &&
    isNumber(value.files_added) &&
    isNumber(value.files_updated) &&
    isNumber(value.files_unchanged) &&
    isNumber(value.files_removed) &&
    isNumber(value.files_with_errors) &&
    isNullableString(value.error_message)
  )
}

function isScanStatus(value: unknown): value is ScanStatus {
  return (
    isRecord(value) &&
    typeof value.configured === 'boolean' &&
    typeof value.available === 'boolean' &&
    isNullableString(value.configuration_error) &&
    typeof value.running === 'boolean' &&
    (value.latest_scan === null || isScanRun(value.latest_scan))
  )
}

function isSearchResults(value: unknown): value is SearchResults {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    Array.isArray(value.albums) &&
    value.albums.every(isAlbumSummary) &&
    Array.isArray(value.tracks) &&
    value.tracks.every(isTrack)
  )
}

function isScanStart(value: unknown): value is ScanStart {
  return (
    isRecord(value) &&
    isNumber(value.scan_id) &&
    typeof value.status === 'string'
  )
}

export function getAlbums(signal?: AbortSignal): Promise<AlbumSummary[]> {
  return requestJson(
    '/albums?limit=500',
    (value): value is AlbumSummary[] => {
      return Array.isArray(value) && value.every(isAlbumSummary)
    },
    { signal },
  )
}

export function getAlbum(
  albumId: number,
  signal?: AbortSignal,
): Promise<AlbumDetail> {
  return requestJson(`/albums/${albumId}`, isAlbumDetail, { signal })
}

export function getTrack(
  trackId: number,
  signal?: AbortSignal,
): Promise<Track> {
  return requestJson(`/tracks/${trackId}`, isTrack, { signal })
}

export function getScanStatus(signal?: AbortSignal): Promise<ScanStatus> {
  return requestJson('/library/scan/status', isScanStatus, { signal })
}

export function startScan(): Promise<ScanStart> {
  return requestJson('/library/scan', isScanStart, { method: 'POST' })
}

export function searchCatalogue(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResults> {
  const params = new URLSearchParams({ q: query })
  return requestJson(`/search?${params.toString()}`, isSearchResults, {
    signal,
  })
}

export function artworkUrl(artworkId: number): string {
  return apiUrl(`/artwork/${artworkId}`)
}
