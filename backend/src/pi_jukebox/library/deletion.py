"""Guarded album deletion across source files and derived jukebox state."""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.cd.metadata import CandidateArtworkCache
from pi_jukebox.config import Settings
from pi_jukebox.library.artwork import ArtworkCache
from pi_jukebox.library.scanner import FORMAT_SUPPORT

LOCAL_COVER_FILENAMES = ("Cover.jpg", "cover.jpg")


class AlbumDeletionError(RuntimeError):
    """Base class for a deletion that could not complete safely."""


class AlbumDeletionBusyError(AlbumDeletionError):
    """Raised when scanning, ripping, or another deletion is active."""


class AlbumNotFoundError(AlbumDeletionError):
    """Raised when the requested catalogue album no longer exists."""


class UnsafeAlbumPathError(AlbumDeletionError):
    """Raised before deletion when a catalogue path fails containment checks."""


class AlbumDeletionIncompleteError(AlbumDeletionError):
    """Raised when a preflighted file could not be removed."""


class AlbumDeletionService:
    """Delete one catalogue album without accepting frontend filesystem paths."""

    def __init__(
        self,
        settings: Settings,
        catalogue: Catalogue,
        cd_artwork_cache: CandidateArtworkCache,
        *,
        scan_active: Callable[[], bool],
        rip_active: Callable[[], bool],
    ) -> None:
        self.settings = settings
        self.catalogue = catalogue
        self.artwork_cache = ArtworkCache(settings.artwork_directory, catalogue)
        self.cd_artwork_cache = cd_artwork_cache
        self.scan_active = scan_active
        self.rip_active = rip_active
        self._guard = threading.Lock()

    def delete(self, album_id: int) -> dict[str, Any]:
        if not self._guard.acquire(blocking=False):
            raise AlbumDeletionBusyError("Another album deletion is already active.")
        try:
            if self.scan_active():
                raise AlbumDeletionBusyError(
                    "Wait for the current library scan to finish before deleting an album."
                )
            if self.rip_active():
                raise AlbumDeletionBusyError(
                    "Wait for the current CD rip to finish or cancel it before deleting an album."
                )

            root = self.settings.validated_library_root()
            album = self.catalogue.get_album(album_id)
            if album is None:
                raise AlbumNotFoundError("Album not found.")

            targets = [
                self._resolve_track_target(root, str(track["relative_path"]))
                for track in album["tracks"]
            ]
            unique_targets = list(dict.fromkeys(targets))
            missing_files = sum(not target.exists() for target in unique_targets)
            parent_directories = {target.parent for target in unique_targets}
            for directory in parent_directories:
                for filename in LOCAL_COVER_FILENAMES:
                    if (directory / filename).is_symlink():
                        raise UnsafeAlbumPathError(
                            "Album artwork is a symbolic link and nothing was deleted."
                        )

            removed_files = 0
            for target in unique_targets:
                if not target.exists():
                    continue
                try:
                    target.unlink()
                    removed_files += 1
                except OSError as exc:
                    raise AlbumDeletionIncompleteError(
                        "Album deletion stopped because one of its music files could not be "
                        "removed. Retry after checking the library storage."
                    ) from exc

            album_artwork_removed = 0
            removed_directories = 0
            for directory in sorted(
                parent_directories, key=lambda item: len(item.parts), reverse=True
            ):
                if directory == root or not directory.is_relative_to(root):
                    continue
                if not self._contains_audio(directory):
                    for filename in LOCAL_COVER_FILENAMES:
                        cover = directory / filename
                        if cover.is_file():
                            try:
                                cover.unlink()
                                album_artwork_removed += 1
                            except OSError as exc:
                                raise AlbumDeletionIncompleteError(
                                    "The album music was removed, but its local cover artwork "
                                    "could not be deleted. Retry after checking the library "
                                    "storage."
                                ) from exc
                try:
                    directory.rmdir()
                    removed_directories += 1
                except OSError:
                    # Non-empty album folders may contain unrelated user files and are retained.
                    pass

            deleted = self.catalogue.delete_album_records(album_id)
            if deleted is None:
                raise AlbumNotFoundError("Album not found.")

            runtime_artwork_removed = False
            cache_filename = deleted.pop("artwork_cache_filename")
            if cache_filename:
                self.artwork_cache.remove([str(cache_filename)])
                runtime_artwork_removed = True
            cd_artwork_removed = self.cd_artwork_cache.remove(deleted.pop("release_ids"))

            return {
                **deleted,
                "files_removed": removed_files,
                "missing_files": missing_files,
                "directories_removed": removed_directories,
                "album_artwork_removed": album_artwork_removed,
                "runtime_artwork_removed": runtime_artwork_removed,
                "cd_artwork_removed": cd_artwork_removed,
                "message": (
                    f'Deleted "{deleted["title"]}" from the jukebox. '
                    "The CD can now be ripped again as a fresh album."
                ),
            }
        finally:
            self._guard.release()

    @staticmethod
    def _resolve_track_target(root: Path, relative_path: str) -> Path:
        requested = Path(relative_path)
        if requested.is_absolute() or ".." in requested.parts:
            raise UnsafeAlbumPathError(
                "The album contains an unsafe library path and nothing was deleted."
            )
        candidate = root / requested
        current = root
        for part in requested.parts:
            current /= part
            if current.is_symlink():
                raise UnsafeAlbumPathError(
                    "The album contains a symbolic-link path and nothing was deleted."
                )
        try:
            resolved = candidate.resolve(strict=False)
        except (OSError, RuntimeError) as exc:
            raise UnsafeAlbumPathError(
                "The album contains an unreadable library path and nothing was deleted."
            ) from exc
        if resolved == root:
            raise UnsafeAlbumPathError("The music library root can never be deleted.")
        if not resolved.is_relative_to(root):
            raise UnsafeAlbumPathError(
                "The album contains a path outside the music library and nothing was deleted."
            )
        if resolved.exists() and not resolved.is_file():
            raise UnsafeAlbumPathError(
                "An album track path does not identify a regular file and nothing was deleted."
            )
        return resolved

    @staticmethod
    def _contains_audio(directory: Path) -> bool:
        if not directory.is_dir():
            return False
        for current, subdirectories, filenames in os.walk(directory, followlinks=False):
            current_path = Path(current)
            subdirectories[:] = [
                name for name in subdirectories if not (current_path / name).is_symlink()
            ]
            if any(Path(filename).suffix.casefold() in FORMAT_SUPPORT for filename in filenames):
                return True
        return False
