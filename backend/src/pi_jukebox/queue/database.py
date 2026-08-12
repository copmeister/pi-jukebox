"""Transactional SQLite store for the authoritative jukebox queue."""

import sqlite3
from typing import Any, Literal

from pi_jukebox.catalogue.database import Catalogue, utc_now


class QueueItemNotFoundError(LookupError):
    """Raised when a queue-item ID is unknown."""


class InvalidQueueOperationError(ValueError):
    """Raised when a queue mutation would violate queue rules."""


class QueueStore:
    """Persist and mutate one ordered queue in the catalogue database."""

    def __init__(self, catalogue: Catalogue) -> None:
        self.catalogue = catalogue

    def snapshot(self, warning: str | None = None) -> dict[str, Any]:
        with self.catalogue.connect() as connection:
            return self._snapshot(connection, warning)

    def add_track(self, track: dict[str, Any]) -> dict[str, Any]:
        with self._write_connection() as connection:
            position = self._next_position(connection)
            self._insert_item(connection, track, position)
            self._touch(connection)
            return self._snapshot(connection)

    def play_next(self, track: dict[str, Any]) -> dict[str, Any]:
        with self._write_connection() as connection:
            upcoming_ids = self._upcoming_ids(connection)
            item_id = self._insert_item(connection, track, self._next_position(connection))
            self._set_upcoming_positions(connection, [item_id, *upcoming_ids])
            self._touch(connection)
            return self._snapshot(connection)

    def play_now(self, track: dict[str, Any]) -> dict[str, Any]:
        with self._write_connection() as connection:
            connection.execute("DELETE FROM queue_items WHERE position = 0")
            self._insert_item(connection, track, 0)
            self._touch(connection)
            return self._snapshot(connection)

    def add_album(self, tracks: list[dict[str, Any]]) -> dict[str, Any]:
        with self._write_connection() as connection:
            position = self._next_position(connection)
            for track in tracks:
                self._insert_item(connection, track, position)
                position += 1
            self._touch(connection)
            return self._snapshot(connection)

    def play_album(self, tracks: list[dict[str, Any]]) -> dict[str, Any]:
        with self._write_connection() as connection:
            connection.execute("DELETE FROM queue_items")
            for position, track in enumerate(tracks):
                self._insert_item(connection, track, position)
            self._touch(connection)
            return self._snapshot(connection)

    def remove_upcoming(self, item_id: int) -> dict[str, Any]:
        with self._write_connection() as connection:
            row = connection.execute(
                "SELECT position FROM queue_items WHERE id = ?", (item_id,)
            ).fetchone()
            if row is None:
                raise QueueItemNotFoundError("Queue item not found.")
            if int(row["position"]) == 0:
                raise InvalidQueueOperationError("The current queue item cannot be removed.")
            connection.execute("DELETE FROM queue_items WHERE id = ?", (item_id,))
            self._set_upcoming_positions(connection, self._upcoming_ids(connection))
            self._touch(connection)
            return self._snapshot(connection)

    def clear_upcoming(self) -> dict[str, Any]:
        with self._write_connection() as connection:
            connection.execute("DELETE FROM queue_items WHERE position > 0")
            self._touch(connection)
            return self._snapshot(connection)

    def move_upcoming(self, item_id: int, direction: Literal["up", "down"]) -> dict[str, Any]:
        with self._write_connection() as connection:
            row = connection.execute(
                "SELECT position FROM queue_items WHERE id = ?", (item_id,)
            ).fetchone()
            if row is None:
                raise QueueItemNotFoundError("Queue item not found.")
            if int(row["position"]) == 0:
                raise InvalidQueueOperationError("The current queue item cannot be reordered.")
            item_ids = self._upcoming_ids(connection)
            index = item_ids.index(item_id)
            target = index - 1 if direction == "up" else index + 1
            if target < 0 or target >= len(item_ids):
                raise InvalidQueueOperationError(
                    f"This queue item cannot move {direction} any further."
                )
            item_ids[index], item_ids[target] = item_ids[target], item_ids[index]
            self._set_upcoming_positions(connection, item_ids)
            self._touch(connection)
            return self._snapshot(connection)

    def advance(self, current_item_id: int, unavailable_item_ids: set[int]) -> dict[str, Any]:
        """Remove the expected current item and atomically promote one playable item."""

        with self._write_connection() as connection:
            current = connection.execute("SELECT id FROM queue_items WHERE position = 0").fetchone()
            if current is None or int(current["id"]) != current_item_id:
                raise InvalidQueueOperationError(
                    "The queue has already advanced. Refresh its current state."
                )
            connection.execute("DELETE FROM queue_items WHERE id = ?", (current_item_id,))
            if unavailable_item_ids:
                placeholders = ",".join("?" for _ in unavailable_item_ids)
                connection.execute(
                    f"DELETE FROM queue_items WHERE position > 0 AND id IN ({placeholders})",
                    tuple(unavailable_item_ids),
                )
            upcoming_ids = self._upcoming_ids(connection)
            self._set_all_positions(connection, upcoming_ids)
            self._touch(connection)
            skipped = len(unavailable_item_ids)
            warning = (
                f"Skipped {skipped} unavailable queued track{'s' if skipped != 1 else ''}."
                if skipped
                else None
            )
            return self._snapshot(connection, warning)

    def _write_connection(self):
        connection_context = self.catalogue.connect()

        class ImmediateTransaction:
            def __enter__(self_nonlocal):
                connection = connection_context.__enter__()
                connection.execute("BEGIN IMMEDIATE")
                self_nonlocal.connection = connection
                return connection

            def __exit__(self_nonlocal, exc_type, exc, traceback):
                return connection_context.__exit__(exc_type, exc, traceback)

        return ImmediateTransaction()

    @staticmethod
    def _insert_item(connection: sqlite3.Connection, track: dict[str, Any], position: int) -> int:
        cursor = connection.execute(
            """
            INSERT INTO queue_items (
                track_id, album_id, title, artist, album, duration_seconds,
                artwork_id, position, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                track["id"],
                track["album_id"],
                track["title"],
                track["artist"],
                track["album"],
                track["duration_seconds"],
                track["artwork_id"],
                position,
                utc_now(),
            ),
        )
        return int(cursor.lastrowid)

    @staticmethod
    def _next_position(connection: sqlite3.Connection) -> int:
        row = connection.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM queue_items"
        ).fetchone()
        return int(row["position"])

    @staticmethod
    def _upcoming_ids(connection: sqlite3.Connection) -> list[int]:
        return [
            int(row["id"])
            for row in connection.execute(
                "SELECT id FROM queue_items WHERE position > 0 ORDER BY position, id"
            )
        ]

    @staticmethod
    def _set_upcoming_positions(connection: sqlite3.Connection, item_ids: list[int]) -> None:
        connection.execute("UPDATE queue_items SET position = 1000000000 + id WHERE position > 0")
        connection.executemany(
            "UPDATE queue_items SET position = ? WHERE id = ?",
            ((position, item_id) for position, item_id in enumerate(item_ids, start=1)),
        )

    @staticmethod
    def _set_all_positions(connection: sqlite3.Connection, item_ids: list[int]) -> None:
        connection.execute("UPDATE queue_items SET position = 1000000000 + id")
        connection.executemany(
            "UPDATE queue_items SET position = ? WHERE id = ?",
            ((position, item_id) for position, item_id in enumerate(item_ids)),
        )

    @staticmethod
    def _touch(connection: sqlite3.Connection) -> None:
        connection.execute(
            "UPDATE queue_state SET revision = revision + 1, updated_at = ? WHERE id = 1",
            (utc_now(),),
        )

    @staticmethod
    def _snapshot(connection: sqlite3.Connection, warning: str | None = None) -> dict[str, Any]:
        rows = connection.execute(
            """
            SELECT queue_items.id, queue_items.track_id, queue_items.album_id,
                   queue_items.title, queue_items.artist, queue_items.album,
                   queue_items.duration_seconds, queue_items.artwork_id,
                   queue_items.position,
                   CASE WHEN tracks.id IS NULL THEN 0 ELSE 1 END AS available
            FROM queue_items
            LEFT JOIN tracks ON tracks.id = queue_items.track_id
            ORDER BY queue_items.position, queue_items.id
            """
        ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["available"] = bool(item["available"])
            item["status"] = "current" if item["position"] == 0 else "upcoming"
            items.append(item)
        revision = connection.execute("SELECT revision FROM queue_state WHERE id = 1").fetchone()
        current = next((item for item in items if item["position"] == 0), None)
        upcoming = [item for item in items if item["position"] > 0]
        return {
            "revision": int(revision["revision"]),
            "current": current,
            "upcoming": upcoming,
            "upcoming_count": len(upcoming),
            "upcoming_duration_seconds": sum(
                float(item["duration_seconds"] or 0) for item in upcoming
            ),
            "warning": warning,
        }
