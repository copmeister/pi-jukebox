import type {
  AlbumDetail,
  AlbumSummary,
  ApiAction,
  BluetoothStatus,
  CdRelease,
  CdRipJob,
  CdStatus,
  DisplayAction,
  QueueItem,
  QueueSnapshot,
  ScanStart,
  ScanStatus,
  SearchResults,
  Track,
  UpdateStatus,
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
      path.startsWith('/system/updates')
        ? response.status === 409
          ? 'Another update is already active, or no installable stable release is available.'
          : 'The software update request could not be completed.'
        : path.startsWith('/bluetooth')
          ? response.status === 409
            ? 'That Bluetooth action is no longer available. The current receiver state has been kept.'
            : 'Bluetooth receiver control could not complete that request.'
          : path.startsWith('/queue')
            ? response.status === 404
              ? 'That track or queue item is no longer available.'
              : response.status === 409
                ? 'The queue changed before that action completed. Its current state has been kept.'
                : 'The queue action could not be completed.'
            : response.status === 409
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

function isQueueItem(value: unknown): value is QueueItem {
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    isNumber(value.track_id) &&
    isNumber(value.album_id) &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    typeof value.album === 'string' &&
    isNullableNumber(value.duration_seconds) &&
    isNullableNumber(value.artwork_id) &&
    isNumber(value.position) &&
    ['current', 'upcoming'].includes(String(value.status)) &&
    typeof value.available === 'boolean'
  )
}

function isQueueSnapshot(value: unknown): value is QueueSnapshot {
  return (
    isRecord(value) &&
    isNumber(value.revision) &&
    (value.current === null || isQueueItem(value.current)) &&
    Array.isArray(value.upcoming) &&
    value.upcoming.every(isQueueItem) &&
    isNumber(value.upcoming_count) &&
    isNumber(value.upcoming_duration_seconds) &&
    isNullableString(value.warning)
  )
}

function isCdRelease(value: unknown): value is CdRelease {
  return (
    isRecord(value) &&
    typeof value.release_id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    isNullableString(value.year) &&
    isNullableString(value.country) &&
    isNullableString(value.edition) &&
    isNumber(value.track_count) &&
    Array.isArray(value.tracks) &&
    value.tracks.every(
      (track) =>
        isRecord(track) &&
        isNumber(track.number) &&
        typeof track.title === 'string' &&
        typeof track.artist === 'string' &&
        isNullableNumber(track.duration_seconds),
    ) &&
    typeof value.artwork_available === 'boolean'
  )
}

function isCdRipJob(value: unknown): value is CdRipJob {
  const states = [
    'waiting',
    'reading',
    'encoding',
    'tagging',
    'ready',
    'error',
    'cancelled',
  ]
  return (
    isRecord(value) &&
    isNumber(value.id) &&
    [
      'queued',
      'ripping',
      'completed',
      'partial',
      'cancelled',
      'failed',
      'interrupted',
    ].includes(String(value.status)) &&
    typeof value.disc_id === 'string' &&
    isNullableString(value.release_id) &&
    typeof value.album_title === 'string' &&
    typeof value.album_artist === 'string' &&
    isNumber(value.total_tracks) &&
    isNumber(value.completed_tracks) &&
    isNumber(value.failed_tracks) &&
    isNullableString(value.message) &&
    isNullableString(value.error_message) &&
    typeof value.cancel_requested === 'boolean' &&
    typeof value.created_at === 'string' &&
    isNullableString(value.started_at) &&
    isNullableString(value.finished_at) &&
    Array.isArray(value.tracks) &&
    value.tracks.every(
      (track) =>
        isRecord(track) &&
        isNumber(track.track_number) &&
        typeof track.title === 'string' &&
        typeof track.artist === 'string' &&
        isNullableNumber(track.duration_seconds) &&
        states.includes(String(track.state)) &&
        isNullableString(track.final_relative_path) &&
        isNullableString(track.error_message) &&
        typeof track.updated_at === 'string',
    )
  )
}

function isCdStatus(value: unknown): value is CdStatus {
  const drive = isRecord(value) && isRecord(value.drive) ? value.drive : null
  const storage =
    isRecord(value) && isRecord(value.storage) ? value.storage : null
  const disc = drive?.disc
  const ripAction =
    isRecord(value) && isRecord(value.rip_action) ? value.rip_action : null
  return (
    isRecord(value) &&
    drive !== null &&
    typeof drive.configured === 'boolean' &&
    typeof drive.available === 'boolean' &&
    typeof drive.disc_present === 'boolean' &&
    typeof drive.message === 'string' &&
    (disc === null ||
      (isRecord(disc) &&
        typeof disc.disc_id === 'string' &&
        isNumber(disc.track_count) &&
        Array.isArray(disc.track_durations) &&
        disc.track_durations.every(isNullableNumber))) &&
    storage !== null &&
    typeof storage.configured === 'boolean' &&
    typeof storage.available === 'boolean' &&
    typeof storage.mounted === 'boolean' &&
    typeof storage.writable === 'boolean' &&
    isNullableNumber(storage.free_bytes) &&
    typeof storage.message === 'string' &&
    ['idle', 'reading', 'searching', 'ready', 'unavailable'].includes(
      String(value.metadata_state),
    ) &&
    isNullableString(value.metadata_message) &&
    Array.isArray(value.release_candidates) &&
    value.release_candidates.every(isCdRelease) &&
    isNullableString(value.selected_release_id) &&
    typeof value.active === 'boolean' &&
    (value.latest_job === null || isCdRipJob(value.latest_job)) &&
    ripAction !== null &&
    ['start', 'resume', 'complete', 'conflict', 'unavailable'].includes(
      String(ripAction.action),
    ) &&
    typeof ripAction.message === 'string' &&
    (ripAction.source_job_id === null || isNumber(ripAction.source_job_id))
  )
}

function isApiAction(value: unknown): value is ApiAction {
  return (
    isRecord(value) &&
    typeof value.accepted === 'boolean' &&
    typeof value.message === 'string' &&
    (value.job_id === undefined ||
      value.job_id === null ||
      isNumber(value.job_id))
  )
}

function isDisplayAction(value: unknown): value is DisplayAction {
  return (
    isRecord(value) &&
    typeof value.available === 'boolean' &&
    typeof value.adjusted === 'boolean' &&
    typeof value.message === 'string'
  )
}

function isUpdateStatus(value: unknown): value is UpdateStatus {
  return (
    isRecord(value) &&
    typeof value.installed_version === 'string' &&
    isNullableString(value.latest_version) &&
    typeof value.checking === 'boolean' &&
    typeof value.installing === 'boolean' &&
    typeof value.update_available === 'boolean' &&
    typeof value.install_available === 'boolean' &&
    typeof value.stage === 'string' &&
    (value.outcome === null ||
      ['succeeded', 'rolled_back', 'failed'].includes(String(value.outcome))) &&
    isNullableString(value.requested_version) &&
    isNullableString(value.previous_version) &&
    isNullableString(value.message) &&
    isNullableString(value.last_error) &&
    typeof value.source === 'string'
  )
}

function isBluetoothStatus(value: unknown): value is BluetoothStatus {
  const states = [
    'unavailable',
    'inactive',
    'not_connected',
    'pairing',
    'connected',
    'audio_playing',
    'error',
  ]
  const deviceId = /^[0-9a-f]{16}$/
  const requestId = /^[0-9a-f]{24}$/
  const pending = isRecord(value) ? value.pending_pairing : undefined
  return (
    isRecord(value) &&
    typeof value.available === 'boolean' &&
    typeof value.mode_active === 'boolean' &&
    states.includes(String(value.state)) &&
    isNullableString(value.adapter_alias) &&
    typeof value.discoverable === 'boolean' &&
    typeof value.pairable === 'boolean' &&
    isNumber(value.pairing_seconds_remaining) &&
    (value.connected_device_id === null ||
      (typeof value.connected_device_id === 'string' &&
        deviceId.test(value.connected_device_id))) &&
    Array.isArray(value.devices) &&
    value.devices.every(
      (device) =>
        isRecord(device) &&
        typeof device.id === 'string' &&
        deviceId.test(device.id) &&
        typeof device.name === 'string' &&
        typeof device.paired === 'boolean' &&
        typeof device.trusted === 'boolean' &&
        typeof device.connected === 'boolean' &&
        typeof device.audio_playing === 'boolean',
    ) &&
    (pending === null ||
      (isRecord(pending) &&
        typeof pending.id === 'string' &&
        requestId.test(pending.id) &&
        typeof pending.device_id === 'string' &&
        deviceId.test(pending.device_id) &&
        typeof pending.device_name === 'string' &&
        ['confirm', 'authorize'].includes(String(pending.kind)) &&
        (pending.passkey === null ||
          (typeof pending.passkey === 'string' &&
            /^\d{6}$/.test(pending.passkey))))) &&
    typeof value.message === 'string'
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

export function getTracks(signal?: AbortSignal): Promise<Track[]> {
  return requestJson(
    '/tracks',
    (value): value is Track[] => Array.isArray(value) && value.every(isTrack),
    { signal },
  )
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

export function mediaUrl(trackId: number): string {
  return apiUrl(`/tracks/${trackId}/media`)
}

export function getQueue(): Promise<QueueSnapshot> {
  return requestJson('/queue', isQueueSnapshot)
}

export function addTrackToQueue(trackId: number): Promise<QueueSnapshot> {
  return requestJson(`/queue/tracks/${trackId}`, isQueueSnapshot, {
    method: 'POST',
  })
}

export function playTrackNext(trackId: number): Promise<QueueSnapshot> {
  return requestJson(`/queue/tracks/${trackId}/next`, isQueueSnapshot, {
    method: 'POST',
  })
}

export function playTrackNow(trackId: number): Promise<QueueSnapshot> {
  return requestJson(`/queue/tracks/${trackId}/play-now`, isQueueSnapshot, {
    method: 'POST',
  })
}

export function addAlbumToQueue(albumId: number): Promise<QueueSnapshot> {
  return requestJson(`/queue/albums/${albumId}`, isQueueSnapshot, {
    method: 'POST',
  })
}

export function replaceQueueWithAlbum(albumId: number): Promise<QueueSnapshot> {
  return requestJson(`/queue/albums/${albumId}/play`, isQueueSnapshot, {
    method: 'POST',
  })
}

export function removeQueueItem(itemId: number): Promise<QueueSnapshot> {
  return requestJson(`/queue/items/${itemId}`, isQueueSnapshot, {
    method: 'DELETE',
  })
}

export function clearUpcomingQueue(): Promise<QueueSnapshot> {
  return requestJson('/queue/upcoming', isQueueSnapshot, { method: 'DELETE' })
}

export function stopAndClearQueue(): Promise<QueueSnapshot> {
  return requestJson('/queue', isQueueSnapshot, { method: 'DELETE' })
}

export function moveQueueItem(
  itemId: number,
  direction: 'up' | 'down',
): Promise<QueueSnapshot> {
  return requestJson(`/queue/items/${itemId}/move`, isQueueSnapshot, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  })
}

export function advanceQueue(currentItemId: number): Promise<QueueSnapshot> {
  return requestJson('/queue/advance', isQueueSnapshot, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_item_id: currentItemId }),
  })
}

export function getCdStatus(signal?: AbortSignal): Promise<CdStatus> {
  return requestJson('/cd/status', isCdStatus, { signal })
}

export function retryCdMetadata(): Promise<ApiAction> {
  return requestJson('/cd/metadata/retry', isApiAction, { method: 'POST' })
}

export function selectCdRelease(releaseId: string): Promise<ApiAction> {
  return requestJson(
    `/cd/releases/${encodeURIComponent(releaseId)}/select`,
    isApiAction,
    { method: 'POST' },
  )
}

export function cdArtworkUrl(releaseId: string): string {
  return apiUrl(`/cd/releases/${encodeURIComponent(releaseId)}/artwork`)
}

export function startCdRip(releaseId: string): Promise<ApiAction> {
  return requestJson('/cd/rips', isApiAction, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ release_id: releaseId }),
  })
}

export function cancelCdRip(jobId: number): Promise<ApiAction> {
  return requestJson(`/cd/rips/${jobId}/cancel`, isApiAction, {
    method: 'POST',
  })
}

export function ejectCd(): Promise<ApiAction> {
  return requestJson('/cd/eject', isApiAction, { method: 'POST' })
}

export function getUpdateStatus(signal?: AbortSignal): Promise<UpdateStatus> {
  return requestJson('/system/updates', isUpdateStatus, { signal })
}

export function sleepPhysicalDisplay(): Promise<DisplayAction> {
  return requestJson('/system/display/sleep', isDisplayAction, {
    method: 'POST',
    headers: { 'X-Pi-Jukebox-Action': 'display-sleep' },
  })
}

export function wakePhysicalDisplay(): Promise<DisplayAction> {
  return requestJson('/system/display/wake', isDisplayAction, {
    method: 'POST',
    headers: { 'X-Pi-Jukebox-Action': 'display-wake' },
  })
}

export function checkForUpdates(): Promise<ApiAction> {
  return requestJson('/system/updates/check', isApiAction, { method: 'POST' })
}

export function installUpdate(): Promise<ApiAction> {
  return requestJson('/system/updates/install', isApiAction, {
    method: 'POST',
    headers: { 'X-Pi-Jukebox-Action': 'install-stable-release' },
  })
}

const BLUETOOTH_ACTION_HEADERS = {
  'X-Pi-Jukebox-Action': 'bluetooth-control',
}

function bluetoothAction(
  path: string,
  method = 'POST',
): Promise<BluetoothStatus> {
  return requestJson(path, isBluetoothStatus, {
    method,
    headers: BLUETOOTH_ACTION_HEADERS,
  })
}

export function getBluetoothStatus(
  signal?: AbortSignal,
): Promise<BluetoothStatus> {
  return requestJson('/bluetooth/status', isBluetoothStatus, { signal })
}

export function activateBluetooth(): Promise<BluetoothStatus> {
  return bluetoothAction('/bluetooth/activate')
}

export function deactivateBluetooth(): Promise<BluetoothStatus> {
  return bluetoothAction('/bluetooth/deactivate')
}

export function startBluetoothPairing(): Promise<BluetoothStatus> {
  return bluetoothAction('/bluetooth/pairing/start')
}

export function cancelBluetoothPairing(): Promise<BluetoothStatus> {
  return bluetoothAction('/bluetooth/pairing/cancel')
}

export function respondToBluetoothPairing(
  requestId: string,
  accept: boolean,
): Promise<BluetoothStatus> {
  return bluetoothAction(
    `/bluetooth/pairing/${encodeURIComponent(requestId)}/${accept ? 'accept' : 'reject'}`,
  )
}

export function connectBluetoothDevice(
  deviceId: string,
): Promise<BluetoothStatus> {
  return bluetoothAction(
    `/bluetooth/devices/${encodeURIComponent(deviceId)}/connect`,
  )
}

export function disconnectBluetoothDevice(
  deviceId: string,
): Promise<BluetoothStatus> {
  return bluetoothAction(
    `/bluetooth/devices/${encodeURIComponent(deviceId)}/disconnect`,
  )
}

export function forgetBluetoothDevice(
  deviceId: string,
): Promise<BluetoothStatus> {
  return bluetoothAction(
    `/bluetooth/devices/${encodeURIComponent(deviceId)}`,
    'DELETE',
  )
}
