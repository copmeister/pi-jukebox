"""Versioned SQLite schema for the local music catalogue."""

SCHEMA_VERSION = 3

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artwork (
    id INTEGER PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    cache_filename TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY,
    album_artist_id INTEGER NOT NULL REFERENCES artists(id),
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    artwork_id INTEGER REFERENCES artwork(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (album_artist_id, normalized_title)
);

CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY,
    album_id INTEGER NOT NULL REFERENCES albums(id),
    artist_id INTEGER NOT NULL REFERENCES artists(id),
    relative_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    title TEXT NOT NULL,
    disc_number INTEGER CHECK (disc_number IS NULL OR disc_number >= 0),
    track_number INTEGER CHECK (track_number IS NULL OR track_number >= 0),
    duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    file_format TEXT NOT NULL,
    playback_support TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size >= 0),
    modified_time_ns INTEGER NOT NULL CHECK (modified_time_ns >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(normalized_title);
CREATE INDEX IF NOT EXISTS idx_tracks_album_order
    ON tracks(album_id, disc_number, track_number, title);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);

CREATE TABLE IF NOT EXISTS scan_runs (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    library_root TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    files_discovered INTEGER NOT NULL DEFAULT 0,
    files_added INTEGER NOT NULL DEFAULT 0,
    files_updated INTEGER NOT NULL DEFAULT 0,
    files_unchanged INTEGER NOT NULL DEFAULT 0,
    files_removed INTEGER NOT NULL DEFAULT 0,
    files_with_errors INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS queue_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_items (
    id INTEGER PRIMARY KEY,
    track_id INTEGER NOT NULL CHECK (track_id > 0),
    album_id INTEGER NOT NULL CHECK (album_id > 0),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    artwork_id INTEGER,
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_items_track_id ON queue_items(track_id);

INSERT OR IGNORE INTO queue_state (id, revision, updated_at)
VALUES (1, 0, '1970-01-01T00:00:00+00:00');

CREATE TABLE IF NOT EXISTS cd_rip_jobs (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    disc_id TEXT NOT NULL,
    release_id TEXT,
    album_title TEXT NOT NULL,
    album_artist TEXT NOT NULL,
    total_tracks INTEGER NOT NULL CHECK (total_tracks > 0),
    completed_tracks INTEGER NOT NULL DEFAULT 0,
    failed_tracks INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cd_rip_tracks (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES cd_rip_jobs(id) ON DELETE CASCADE,
    track_number INTEGER NOT NULL CHECK (track_number > 0),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    duration_seconds REAL,
    state TEXT NOT NULL,
    final_relative_path TEXT,
    error_message TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (job_id, track_number)
);

CREATE INDEX IF NOT EXISTS idx_cd_rip_tracks_job ON cd_rip_tracks(job_id, track_number);

CREATE TABLE IF NOT EXISTS software_update_runs (
    id INTEGER PRIMARY KEY,
    requested_version TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
);
"""
