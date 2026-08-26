export interface AlbumSummary {
  id: number
  title: string
  album_artist: string
  artwork_id: number | null
  track_count: number
  duration_seconds: number
}

export interface Track {
  id: number
  album_id: number
  relative_path: string
  filename: string
  title: string
  artist: string
  album_artist: string
  album: string
  disc_number: number | null
  track_number: number | null
  duration_seconds: number | null
  file_format: string
  playback_support: string
  artwork_id: number | null
}

export interface AlbumDetail extends AlbumSummary {
  tracks: Track[]
}

export interface AlbumDeletionResult {
  album_id: number
  title: string
  album_artist: string
  track_count: number
  files_removed: number
  missing_files: number
  directories_removed: number
  album_artwork_removed: number
  runtime_artwork_removed: boolean
  cd_artwork_removed: number
  queue_items_removed: number
  current_queue_item_removed: boolean
  rip_jobs_removed: number
  message: string
}

export interface ScanRun {
  id: number
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  files_discovered: number
  files_added: number
  files_updated: number
  files_unchanged: number
  files_removed: number
  files_with_errors: number
  error_message: string | null
}

export interface ScanStatus {
  configured: boolean
  available: boolean
  configuration_error: string | null
  running: boolean
  latest_scan: ScanRun | null
}

export interface SearchResults {
  query: string
  albums: AlbumSummary[]
  tracks: Track[]
}

export interface ScanStart {
  scan_id: number
  status: string
}

export interface QueueItem {
  id: number
  track_id: number
  album_id: number
  title: string
  artist: string
  album: string
  duration_seconds: number | null
  artwork_id: number | null
  position: number
  status: 'current' | 'upcoming'
  available: boolean
}

export interface QueueSnapshot {
  revision: number
  current: QueueItem | null
  upcoming: QueueItem[]
  upcoming_count: number
  upcoming_duration_seconds: number
  warning: string | null
}

export interface PlayerTrack {
  id: number
  album_id: number
  title: string
  artist: string
  album: string
  duration_seconds: number | null
  artwork_id: number | null
}

export type RipTrackState =
  | 'waiting'
  | 'reading'
  | 'encoding'
  | 'tagging'
  | 'ready'
  | 'error'
  | 'cancelled'

export interface CdDisc {
  disc_id: string
  track_count: number
  track_durations: Array<number | null>
}

export interface CdDriveStatus {
  configured: boolean
  available: boolean
  disc_present: boolean
  message: string
  disc: CdDisc | null
}

export interface CdStorageStatus {
  configured: boolean
  available: boolean
  mounted: boolean
  writable: boolean
  free_bytes: number | null
  message: string
}

export interface CdReleaseTrack {
  number: number
  title: string
  artist: string
  duration_seconds: number | null
}

export interface CdRelease {
  release_id: string
  title: string
  artist: string
  year: string | null
  country: string | null
  edition: string | null
  track_count: number
  tracks: CdReleaseTrack[]
  artwork_available: boolean
  disc_number: number | null
  disc_total: number | null
}

export interface CdRipTrack {
  track_number: number
  title: string
  artist: string
  duration_seconds: number | null
  state: RipTrackState
  final_relative_path: string | null
  error_message: string | null
  updated_at: string
}

export interface CdRipJob {
  id: number
  status:
    | 'queued'
    | 'ripping'
    | 'completed'
    | 'partial'
    | 'cancelled'
    | 'failed'
    | 'interrupted'
  disc_id: string
  release_id: string | null
  album_title: string
  album_artist: string
  total_tracks: number
  completed_tracks: number
  failed_tracks: number
  message: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  cancel_requested: boolean
  tracks: CdRipTrack[]
}

export interface CdRipAction {
  action: 'start' | 'resume' | 'complete' | 'conflict' | 'unavailable'
  message: string
  source_job_id: number | null
}

export interface CdStatus {
  drive: CdDriveStatus
  storage: CdStorageStatus
  metadata_state: 'idle' | 'reading' | 'searching' | 'ready' | 'unavailable'
  metadata_message: string | null
  release_candidates: CdRelease[]
  selected_release_id: string | null
  active: boolean
  latest_job: CdRipJob | null
  rip_action: CdRipAction
}

export interface ApiAction {
  accepted: boolean
  message: string
  job_id?: number | null
}

export interface UpdateStatus {
  installed_version: string
  latest_version: string | null
  checking: boolean
  installing: boolean
  update_available: boolean
  install_available: boolean
  stage: string
  outcome: 'succeeded' | 'rolled_back' | 'failed' | null
  requested_version: string | null
  previous_version: string | null
  message: string | null
  last_error: string | null
  source: string
}

export interface DisplayAction {
  available: boolean
  adjusted: boolean
  message: string
}

export type BluetoothPlaybackState =
  | 'unavailable'
  | 'inactive'
  | 'not_connected'
  | 'pairing'
  | 'connected'
  | 'audio_playing'
  | 'error'

export interface BluetoothDevice {
  id: string
  name: string
  paired: boolean
  trusted: boolean
  connected: boolean
  audio_playing: boolean
}

export interface BluetoothPairingRequest {
  id: string
  device_id: string
  device_name: string
  kind: 'confirm' | 'authorize'
  passkey: string | null
}

export interface BluetoothStatus {
  available: boolean
  mode_active: boolean
  state: BluetoothPlaybackState
  adapter_alias: string | null
  discoverable: boolean
  pairable: boolean
  pairing_seconds_remaining: number
  connected_device_id: string | null
  devices: BluetoothDevice[]
  pending_pairing: BluetoothPairingRequest | null
  message: string
}

export interface SpectrumFrame {
  sequence: number
  status: 'starting' | 'ready' | 'unavailable'
  message: string
  band_centres_hz: number[]
  levels: number[]
  max_levels: number
  rise_rate: number
  fall_rate: number
}

export interface RadioNowPlaying {
  station_id: string
  available: boolean
  kind: 'track' | 'programme' | 'text' | 'none'
  text: string | null
  artist: string | null
  title: string | null
}
