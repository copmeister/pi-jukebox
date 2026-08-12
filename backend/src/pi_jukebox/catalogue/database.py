"""Small SQLite data-access layer for the music catalogue."""

import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pi_jukebox.catalogue.models import FileState, ScannedTrack
from pi_jukebox.catalogue.schema import SCHEMA_SQL, SCHEMA_VERSION


def utc_now() -> str:
    """Return a sortable UTC timestamp."""

    return datetime.now(UTC).isoformat()


def normalize_group_value(value: str) -> str:
    """Normalize human metadata for stable grouping without changing display text."""

    return " ".join(value.split()).casefold()


class Catalogue:
    """Own SQLite connections and catalogue queries."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    def initialize(self) -> None:
        """Create the runtime directory and the current schema when needed."""

        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA_SQL)
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Open, transact with, and always close one short-lived connection."""

        connection = sqlite3.connect(self.database_path, timeout=10)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA busy_timeout = 10000")
            connection.create_function(
                "CASEFOLD", 1, lambda value: str(value).casefold(), deterministic=True
            )
            with connection:
                yield connection
        finally:
            connection.close()

    def create_scan_run(self, library_root: str | None) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO scan_runs (status, library_root, started_at) VALUES (?, ?, ?)",
                ("running", library_root, utc_now()),
            )
            return int(cursor.lastrowid)

    def complete_scan_run(self, scan_id: int, counters: dict[str, int]) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE scan_runs
                SET status = 'completed', finished_at = ?, files_discovered = ?,
                    files_added = ?, files_updated = ?, files_unchanged = ?,
                    files_removed = ?, files_with_errors = ?, error_message = NULL
                WHERE id = ?
                """,
                (
                    utc_now(),
                    counters["files_discovered"],
                    counters["files_added"],
                    counters["files_updated"],
                    counters["files_unchanged"],
                    counters["files_removed"],
                    counters["files_with_errors"],
                    scan_id,
                ),
            )

    def fail_scan_run(self, scan_id: int, message: str, counters: dict[str, int]) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE scan_runs
                SET status = 'failed', finished_at = ?, files_discovered = ?,
                    files_added = ?, files_updated = ?, files_unchanged = ?,
                    files_removed = ?, files_with_errors = ?, error_message = ?
                WHERE id = ?
                """,
                (
                    utc_now(),
                    counters["files_discovered"],
                    counters["files_added"],
                    counters["files_updated"],
                    counters["files_unchanged"],
                    counters["files_removed"],
                    counters["files_with_errors"],
                    message,
                    scan_id,
                ),
            )

    def latest_scan(self) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1").fetchone()
            return dict(row) if row else None

    def get_scan(self, scan_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM scan_runs WHERE id = ?", (scan_id,)).fetchone()
            return dict(row) if row else None

    def get_file_state(self, relative_path: str) -> FileState | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id, file_size, modified_time_ns FROM tracks WHERE relative_path = ?",
                (relative_path,),
            ).fetchone()
            return FileState(**dict(row)) if row else None

    def add_artwork(
        self, content_hash: str, mime_type: str, cache_filename: str, byte_size: int
    ) -> int:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO artwork (content_hash, mime_type, cache_filename, byte_size, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(content_hash) DO NOTHING
                """,
                (content_hash, mime_type, cache_filename, byte_size, utc_now()),
            )
            row = connection.execute(
                "SELECT id FROM artwork WHERE content_hash = ?", (content_hash,)
            ).fetchone()
            if row is None:  # pragma: no cover - guarded by the insert above
                raise RuntimeError("Artwork record could not be created")
            return int(row["id"])

    def upsert_track(self, track: ScannedTrack) -> bool:
        """Insert or update a track; return True when it was newly added."""

        now = utc_now()
        with self.connect() as connection:
            existing = connection.execute(
                "SELECT id FROM tracks WHERE relative_path = ?", (track.relative_path,)
            ).fetchone()
            artist_id = self._artist_id(connection, track.metadata.artist, now)
            album_artist_id = self._artist_id(connection, track.metadata.album_artist, now)
            album_id = self._album_id(
                connection,
                album_artist_id,
                track.metadata.album,
                track.artwork_id,
                now,
            )

            values = (
                album_id,
                artist_id,
                track.filename,
                track.metadata.title,
                track.metadata.disc_number,
                track.metadata.track_number,
                track.metadata.duration_seconds,
                track.file_format,
                track.playback_support,
                track.file_size,
                track.modified_time_ns,
                now,
                track.relative_path,
            )
            if existing:
                connection.execute(
                    """
                    UPDATE tracks
                    SET album_id = ?, artist_id = ?, filename = ?, title = ?, disc_number = ?,
                        track_number = ?, duration_seconds = ?, file_format = ?,
                        playback_support = ?, file_size = ?, modified_time_ns = ?, updated_at = ?
                    WHERE relative_path = ?
                    """,
                    values,
                )
            else:
                connection.execute(
                    """
                    INSERT INTO tracks (
                        album_id, artist_id, filename, title, disc_number, track_number,
                        duration_seconds, file_format, playback_support, file_size,
                        modified_time_ns, created_at, updated_at, relative_path
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (*values[:-1], now, values[-1]),
                )
            return existing is None

    def remove_missing_tracks(self, seen_paths: set[str]) -> int:
        """Delete tracks absent from a successful scan and prune empty grouping rows."""

        with self.connect() as connection:
            existing_paths = {
                str(row["relative_path"])
                for row in connection.execute("SELECT relative_path FROM tracks")
            }
            missing_paths = existing_paths - seen_paths
            if missing_paths:
                connection.executemany(
                    "DELETE FROM tracks WHERE relative_path = ?",
                    ((path,) for path in missing_paths),
                )
            connection.execute(
                "DELETE FROM albums WHERE NOT EXISTS "
                "(SELECT 1 FROM tracks WHERE tracks.album_id = albums.id)"
            )
            connection.execute(
                """
                DELETE FROM artists
                WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.artist_id = artists.id)
                  AND NOT EXISTS (SELECT 1 FROM albums WHERE albums.album_artist_id = artists.id)
                """
            )
            return len(missing_paths)

    def remove_unused_artwork(self) -> list[str]:
        """Remove unreferenced artwork rows and return cache filenames to delete."""

        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT cache_filename FROM artwork
                WHERE NOT EXISTS (SELECT 1 FROM albums WHERE albums.artwork_id = artwork.id)
                """
            ).fetchall()
            filenames = [str(row["cache_filename"]) for row in rows]
            if filenames:
                connection.executemany(
                    "DELETE FROM artwork WHERE cache_filename = ?",
                    ((filename,) for filename in filenames),
                )
            return filenames

    def list_albums(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT albums.id, albums.title, artists.name AS album_artist,
                       albums.artwork_id, COUNT(tracks.id) AS track_count,
                       COALESCE(SUM(tracks.duration_seconds), 0) AS duration_seconds
                FROM albums
                JOIN artists ON artists.id = albums.album_artist_id
                JOIN tracks ON tracks.album_id = albums.id
                GROUP BY albums.id
                ORDER BY artists.normalized_name, albums.normalized_title, albums.id
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_album(self, album_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            album = connection.execute(
                """
                SELECT albums.id, albums.title, artists.name AS album_artist,
                       albums.artwork_id, COUNT(tracks.id) AS track_count,
                       COALESCE(SUM(tracks.duration_seconds), 0) AS duration_seconds
                FROM albums
                JOIN artists ON artists.id = albums.album_artist_id
                LEFT JOIN tracks ON tracks.album_id = albums.id
                WHERE albums.id = ?
                GROUP BY albums.id
                """,
                (album_id,),
            ).fetchone()
            if album is None:
                return None
            result = dict(album)
            result["tracks"] = [
                dict(row)
                for row in connection.execute(
                    self._track_select()
                    + " WHERE tracks.album_id = ?"
                    + self._track_order_clause(),
                    (album_id,),
                )
            ]
            return result

    def get_track(self, track_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                self._track_select() + " WHERE tracks.id = ?", (track_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_artwork(self, artwork_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id, mime_type, cache_filename, byte_size FROM artwork WHERE id = ?",
                (artwork_id,),
            ).fetchone()
            return dict(row) if row else None

    def search(self, query: str, limit: int = 50) -> dict[str, list[dict[str, Any]]]:
        """Search album and track metadata with case-insensitive substring matching."""

        normalized_query = normalize_group_value(query)
        if not normalized_query:
            return {"albums": [], "tracks": []}
        escaped_query = (
            normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        pattern = f"%{escaped_query}%"
        with self.connect() as connection:
            albums = connection.execute(
                """
                SELECT albums.id, albums.title, album_artist.name AS album_artist,
                       albums.artwork_id, COUNT(DISTINCT tracks.id) AS track_count,
                       COALESCE(SUM(tracks.duration_seconds), 0) AS duration_seconds
                FROM albums
                JOIN artists AS album_artist ON album_artist.id = albums.album_artist_id
                JOIN tracks ON tracks.album_id = albums.id
                WHERE CASEFOLD(albums.title) LIKE ? ESCAPE '\\'
                   OR CASEFOLD(album_artist.name) LIKE ? ESCAPE '\\'
                   OR EXISTS (
                       SELECT 1
                       FROM tracks AS matching_track
                       JOIN artists AS matching_artist
                           ON matching_artist.id = matching_track.artist_id
                       WHERE matching_track.album_id = albums.id
                         AND (
                             CASEFOLD(matching_track.title) LIKE ? ESCAPE '\\'
                             OR CASEFOLD(matching_artist.name) LIKE ? ESCAPE '\\'
                         )
                   )
                GROUP BY albums.id
                ORDER BY album_artist.normalized_name, albums.normalized_title, albums.id
                LIMIT ?
                """,
                (pattern, pattern, pattern, pattern, limit),
            ).fetchall()
            tracks = connection.execute(
                self._track_select()
                + """
                WHERE CASEFOLD(tracks.title) LIKE ? ESCAPE '\\'
                   OR CASEFOLD(track_artist.name) LIKE ? ESCAPE '\\'
                """
                + self._track_order_clause()
                + " LIMIT ?",
                (pattern, pattern, limit),
            ).fetchall()
            return {
                "albums": [dict(row) for row in albums],
                "tracks": [dict(row) for row in tracks],
            }

    @staticmethod
    def _artist_id(connection: sqlite3.Connection, name: str, now: str) -> int:
        normalized_name = normalize_group_value(name)
        connection.execute(
            """
            INSERT INTO artists (name, normalized_name, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(normalized_name) DO NOTHING
            """,
            (name, normalized_name, now),
        )
        row = connection.execute(
            "SELECT id FROM artists WHERE normalized_name = ?", (normalized_name,)
        ).fetchone()
        if row is None:  # pragma: no cover - guarded by the insert above
            raise RuntimeError("Artist record could not be created")
        return int(row["id"])

    @staticmethod
    def _album_id(
        connection: sqlite3.Connection,
        album_artist_id: int,
        title: str,
        artwork_id: int | None,
        now: str,
    ) -> int:
        normalized_title = normalize_group_value(title)
        connection.execute(
            """
            INSERT INTO albums (
                album_artist_id, title, normalized_title, artwork_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(album_artist_id, normalized_title) DO UPDATE SET
                artwork_id = COALESCE(excluded.artwork_id, albums.artwork_id),
                updated_at = excluded.updated_at
            """,
            (album_artist_id, title, normalized_title, artwork_id, now, now),
        )
        row = connection.execute(
            "SELECT id FROM albums WHERE album_artist_id = ? AND normalized_title = ?",
            (album_artist_id, normalized_title),
        ).fetchone()
        if row is None:  # pragma: no cover - guarded by the insert above
            raise RuntimeError("Album record could not be created")
        return int(row["id"])

    @staticmethod
    def _track_select() -> str:
        return """
            SELECT tracks.id, tracks.album_id, tracks.relative_path, tracks.filename,
                   tracks.title, track_artist.name AS artist,
                   album_artist.name AS album_artist, albums.title AS album,
                   tracks.disc_number, tracks.track_number, tracks.duration_seconds,
                   tracks.file_format, tracks.playback_support, albums.artwork_id
            FROM tracks
            JOIN artists AS track_artist ON track_artist.id = tracks.artist_id
            JOIN albums ON albums.id = tracks.album_id
            JOIN artists AS album_artist ON album_artist.id = albums.album_artist_id
        """

    @staticmethod
    def _track_order_clause() -> str:
        return """
            ORDER BY
                CASE WHEN tracks.disc_number IS NULL THEN 1 ELSE 0 END,
                tracks.disc_number,
                CASE WHEN tracks.track_number IS NULL THEN 1 ELSE 0 END,
                tracks.track_number,
                tracks.title COLLATE NOCASE,
                tracks.id
        """


def count_rows(catalogue: Catalogue, table: str) -> int:
    """Return a table count for tests and diagnostics using a fixed allow-list."""

    allowed_tables: Iterable[str] = ("artists", "albums", "tracks", "artwork", "scan_runs")
    if table not in allowed_tables:
        raise ValueError(f"Unsupported table: {table}")
    with catalogue.connect() as connection:
        row = connection.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
        return int(row["count"])
