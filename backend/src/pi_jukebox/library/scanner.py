"""Incremental, guarded local music-library scanner."""

import os
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol

from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.catalogue.models import ScannedTrack, TrackMetadata
from pi_jukebox.config import LibraryConfigurationError, Settings
from pi_jukebox.library.artwork import ArtworkCache
from pi_jukebox.library.metadata import MutagenMetadataReader

FORMAT_SUPPORT = {
    ".mp3": ("mp3", "required"),
    ".flac": ("flac", "required"),
    ".wav": ("wav", "optional"),
    ".m4a": ("m4a", "provisional"),
    ".aac": ("aac", "provisional"),
}


class MetadataReader(Protocol):
    def read(self, path: Path) -> TrackMetadata: ...


class ScanAlreadyRunningError(RuntimeError):
    """Raised when a second scan is requested while one is active."""


def empty_counters() -> dict[str, int]:
    return {
        "files_discovered": 0,
        "files_added": 0,
        "files_updated": 0,
        "files_unchanged": 0,
        "files_removed": 0,
        "files_with_errors": 0,
    }


class LibraryScanner:
    """Scan one validated root and incrementally update the catalogue."""

    def __init__(
        self,
        settings: Settings,
        catalogue: Catalogue,
        metadata_reader: MetadataReader | None = None,
    ) -> None:
        self.settings = settings
        self.catalogue = catalogue
        self.metadata_reader = metadata_reader or MutagenMetadataReader()
        self.artwork_cache = ArtworkCache(settings.artwork_directory, catalogue)

    def scan(self, scan_id: int | None = None) -> dict[str, object]:
        """Run one complete scan and return its persisted result."""

        counters = empty_counters()
        if scan_id is None:
            configured_root = (
                str(self.settings.music_library_path)
                if self.settings.music_library_path is not None
                else None
            )
            scan_id = self.catalogue.create_scan_run(configured_root)

        try:
            root = self.settings.validated_library_root()
            seen_paths: set[str] = set()
            scan_integrity = {"complete": True}
            for path in self._audio_files(root, counters, scan_integrity):
                relative_path = path.relative_to(root).as_posix()
                seen_paths.add(relative_path)
                counters["files_discovered"] += 1
                try:
                    stat = path.stat()
                    stored = self.catalogue.get_file_state(relative_path)
                    if (
                        stored
                        and stored.file_size == stat.st_size
                        and stored.modified_time_ns == stat.st_mtime_ns
                    ):
                        counters["files_unchanged"] += 1
                        continue

                    metadata = self.metadata_reader.read(path)
                    artwork_id = (
                        self.artwork_cache.store(metadata.artwork) if metadata.artwork else None
                    )
                    file_format, playback_support = FORMAT_SUPPORT[path.suffix.casefold()]
                    added = self.catalogue.upsert_track(
                        ScannedTrack(
                            relative_path=relative_path,
                            filename=path.name,
                            file_size=stat.st_size,
                            modified_time_ns=stat.st_mtime_ns,
                            file_format=file_format,
                            playback_support=playback_support,
                            metadata=metadata,
                            artwork_id=artwork_id,
                        )
                    )
                    counters["files_added" if added else "files_updated"] += 1
                except (OSError, ValueError, TypeError):
                    counters["files_with_errors"] += 1

            if scan_integrity["complete"]:
                counters["files_removed"] = self.catalogue.remove_missing_tracks(seen_paths)
            unused_artwork = self.catalogue.remove_unused_artwork()
            self.artwork_cache.remove(unused_artwork)
            self.catalogue.complete_scan_run(scan_id, counters)
        except LibraryConfigurationError as exc:
            self.catalogue.fail_scan_run(scan_id, str(exc), counters)
        except OSError as exc:
            self.catalogue.fail_scan_run(
                scan_id, f"The music library could not be scanned: {exc}", counters
            )
        result = self.catalogue.get_scan(scan_id)
        if result is None:  # pragma: no cover - a scan row is always created first
            raise RuntimeError("Scan result could not be loaded")
        return result

    def index_finalized_file(self, path: Path) -> bool:
        """Index one atomically finalised rip without reconciling unrelated files."""

        root = self.settings.validated_library_root()
        resolved = path.resolve(strict=True)
        if not resolved.is_file() or not resolved.is_relative_to(root):
            raise ValueError("The finalised track is outside the configured library.")
        if resolved.suffix.casefold() not in FORMAT_SUPPORT:
            raise ValueError("The finalised track format is unsupported.")
        stat = resolved.stat()
        metadata = self.metadata_reader.read(resolved)
        artwork_id = self.artwork_cache.store(metadata.artwork) if metadata.artwork else None
        file_format, playback_support = FORMAT_SUPPORT[resolved.suffix.casefold()]
        return self.catalogue.upsert_track(
            ScannedTrack(
                relative_path=resolved.relative_to(root).as_posix(),
                filename=resolved.name,
                file_size=stat.st_size,
                modified_time_ns=stat.st_mtime_ns,
                file_format=file_format,
                playback_support=playback_support,
                metadata=metadata,
                artwork_id=artwork_id,
            )
        )

    @staticmethod
    def _audio_files(
        root: Path, counters: dict[str, int], scan_integrity: dict[str, bool]
    ) -> Iterator[Path]:
        def record_walk_error(_error: OSError) -> None:
            counters["files_with_errors"] += 1
            scan_integrity["complete"] = False

        for directory, subdirectories, filenames in os.walk(
            root, followlinks=False, onerror=record_walk_error
        ):
            directory_path = Path(directory)
            safe_subdirectories: list[str] = []
            for name in subdirectories:
                candidate_directory = directory_path / name
                try:
                    resolved_directory = candidate_directory.resolve(strict=True)
                except (OSError, RuntimeError):
                    counters["files_with_errors"] += 1
                    scan_integrity["complete"] = False
                    continue
                if resolved_directory.is_relative_to(root) and not candidate_directory.is_symlink():
                    safe_subdirectories.append(name)
                elif not resolved_directory.is_relative_to(root):
                    counters["files_with_errors"] += 1
            subdirectories[:] = safe_subdirectories
            for filename in sorted(filenames, key=str.casefold):
                candidate = directory_path / filename
                if candidate.suffix.casefold() not in FORMAT_SUPPORT:
                    continue
                try:
                    resolved = candidate.resolve(strict=True)
                except (OSError, RuntimeError):
                    counters["files_with_errors"] += 1
                    scan_integrity["complete"] = False
                    continue
                if resolved.is_file() and resolved.is_relative_to(root):
                    yield resolved
                else:
                    counters["files_with_errors"] += 1


class ScanService:
    """Ensure manual scans are non-blocking and never overlap."""

    def __init__(self, scanner: LibraryScanner, catalogue: Catalogue) -> None:
        self.scanner = scanner
        self.catalogue = catalogue
        self._guard = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
        self._operation_lock = threading.Lock()

    @property
    def is_running(self) -> bool:
        with self._guard:
            return self._running

    def start(self) -> int:
        """Reserve the scanner and start it in a daemon thread."""

        with self._guard:
            if self._running:
                raise ScanAlreadyRunningError("A library scan is already running.")
            configured_root = (
                str(self.scanner.settings.music_library_path)
                if self.scanner.settings.music_library_path is not None
                else None
            )
            scan_id = self.catalogue.create_scan_run(configured_root)
            self._running = True
            self._thread = threading.Thread(
                target=self._run,
                args=(scan_id,),
                name=f"library-scan-{scan_id}",
                daemon=True,
            )
            self._thread.start()
            return scan_id

    def _run(self, scan_id: int) -> None:
        try:
            with self._operation_lock:
                self.scanner.scan(scan_id)
        except Exception as exc:  # Keep the process healthy after an unexpected decoder failure.
            self.catalogue.fail_scan_run(
                scan_id, f"Unexpected library scan failure: {exc}", empty_counters()
            )
        finally:
            with self._guard:
                self._running = False

    def index_finalized_file(self, path: Path) -> bool:
        """Serialize one rip finalisation with full catalogue scans."""

        with self._operation_lock:
            return self.scanner.index_finalized_file(path)

    def reconcile_after_rip(self) -> dict[str, object]:
        """Run a final full reconciliation without blocking HTTP request threads."""

        with self._operation_lock:
            return self.scanner.scan()

    def wait(self, timeout: float = 5) -> bool:
        """Wait for the active scan in tests or controlled shutdown."""

        thread = self._thread
        if thread is not None:
            thread.join(timeout)
        return not self.is_running
