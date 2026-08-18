"""SQLite persistence for rip jobs, per-track progress, and recovery."""

from collections.abc import Sequence
from typing import Any

from pi_jukebox.catalogue.database import Catalogue, utc_now
from pi_jukebox.cd.models import ReleaseCandidate


class RipStore:
    def __init__(self, catalogue: Catalogue) -> None:
        self.catalogue = catalogue

    def recover_interrupted(self) -> int:
        """Mark work that cannot survive a process restart honestly as interrupted."""

        with self.catalogue.connect() as connection:
            rows = connection.execute(
                "SELECT id FROM cd_rip_jobs WHERE status IN ('queued', 'ripping')"
            ).fetchall()
            for row in rows:
                connection.execute(
                    """
                    UPDATE cd_rip_jobs
                    SET status = 'interrupted', finished_at = ?,
                        error_message = 'The jukebox restarted before this rip finished.'
                    WHERE id = ?
                    """,
                    (utc_now(), row["id"]),
                )
                connection.execute(
                    """
                    UPDATE cd_rip_tracks
                    SET state = 'error', updated_at = ?,
                        error_message = 'Interrupted before this track was finalised.'
                    WHERE job_id = ? AND state IN ('waiting', 'reading', 'encoding', 'tagging')
                    """,
                    (utc_now(), row["id"]),
                )
            return len(rows)

    def create_job(self, disc_id: str, release: ReleaseCandidate) -> int:
        now = utc_now()
        with self.catalogue.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO cd_rip_jobs (
                    status, disc_id, release_id, album_title, album_artist,
                    total_tracks, created_at
                ) VALUES ('queued', ?, ?, ?, ?, ?, ?)
                """,
                (
                    disc_id,
                    release.release_id,
                    release.title,
                    release.artist,
                    len(release.tracks),
                    now,
                ),
            )
            job_id = int(cursor.lastrowid)
            connection.executemany(
                """
                INSERT INTO cd_rip_tracks (
                    job_id, track_number, title, artist, duration_seconds, state, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'waiting', ?)
                """,
                (
                    (
                        job_id,
                        track.number,
                        track.title,
                        track.artist,
                        track.duration_seconds,
                        now,
                    )
                    for track in release.tracks
                ),
            )
            return job_id

    def set_job_state(
        self,
        job_id: int,
        state: str,
        *,
        message: str | None = None,
        error: str | None = None,
        finished: bool = False,
    ) -> None:
        with self.catalogue.connect() as connection:
            connection.execute(
                """
                UPDATE cd_rip_jobs
                SET status = ?, message = ?, error_message = ?,
                    started_at = CASE
                        WHEN ? = 'ripping' AND started_at IS NULL THEN ?
                        ELSE started_at
                    END,
                    finished_at = CASE WHEN ? THEN ? ELSE finished_at END
                WHERE id = ?
                """,
                (state, message, error, state, utc_now(), finished, utc_now(), job_id),
            )

    def set_track_state(
        self,
        job_id: int,
        track_number: int,
        state: str,
        *,
        relative_path: str | None = None,
        error: str | None = None,
    ) -> None:
        with self.catalogue.connect() as connection:
            connection.execute(
                """
                UPDATE cd_rip_tracks
                SET state = ?, final_relative_path = COALESCE(?, final_relative_path),
                    error_message = ?, updated_at = ?
                WHERE job_id = ? AND track_number = ?
                """,
                (state, relative_path, error, utc_now(), job_id, track_number),
            )
            connection.execute(
                """
                UPDATE cd_rip_jobs
                SET completed_tracks = (
                        SELECT COUNT(*) FROM cd_rip_tracks WHERE job_id = ? AND state = 'ready'
                    ),
                    failed_tracks = (
                        SELECT COUNT(*) FROM cd_rip_tracks WHERE job_id = ? AND state = 'error'
                    )
                WHERE id = ?
                """,
                (job_id, job_id, job_id),
            )

    def cancel_requested(self, job_id: int) -> bool:
        with self.catalogue.connect() as connection:
            row = connection.execute(
                "SELECT cancel_requested FROM cd_rip_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            return bool(row and row["cancel_requested"])

    def request_cancel(self, job_id: int) -> bool:
        with self.catalogue.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE cd_rip_jobs SET cancel_requested = 1
                WHERE id = ? AND status IN ('queued', 'ripping')
                """,
                (job_id,),
            )
            return cursor.rowcount == 1

    def latest_job(self) -> dict[str, Any] | None:
        with self.catalogue.connect() as connection:
            row = connection.execute(
                "SELECT * FROM cd_rip_jobs ORDER BY id DESC LIMIT 1"
            ).fetchone()
            return self._with_tracks(connection, dict(row)) if row else None

    def get_job(self, job_id: int) -> dict[str, Any] | None:
        with self.catalogue.connect() as connection:
            row = connection.execute("SELECT * FROM cd_rip_jobs WHERE id = ?", (job_id,)).fetchone()
            return self._with_tracks(connection, dict(row)) if row else None

    @staticmethod
    def _with_tracks(connection: Any, job: dict[str, Any]) -> dict[str, Any]:
        tracks: Sequence[Any] = connection.execute(
            """
            SELECT track_number, title, artist, duration_seconds, state,
                   final_relative_path, error_message, updated_at
            FROM cd_rip_tracks WHERE job_id = ? ORDER BY track_number
            """,
            (job["id"],),
        ).fetchall()
        job["cancel_requested"] = bool(job["cancel_requested"])
        job["tracks"] = [dict(track) for track in tracks]
        return job
