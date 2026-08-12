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
