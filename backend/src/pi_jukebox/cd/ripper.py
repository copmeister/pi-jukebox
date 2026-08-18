"""Track-at-a-time secure CD extraction and atomic library finalisation."""

import os
import re
import shutil
import threading
from contextlib import suppress
from pathlib import Path
from typing import Protocol

from mutagen.flac import FLAC, Picture

from pi_jukebox.cd.hardware import CdHardware, CommandRunner, SubprocessRunner
from pi_jukebox.cd.models import DiscLayout, ReleaseCandidate, ReleaseTrack
from pi_jukebox.cd.storage import StorageGuard, StorageSafetyError
from pi_jukebox.cd.store import RipStore
from pi_jukebox.config import Settings
from pi_jukebox.library.scanner import ScanService


class RipAlreadyRunningError(RuntimeError):
    pass


class RipConflictError(RuntimeError):
    pass


class AudioTagger(Protocol):
    def tag(
        self,
        path: Path,
        *,
        release: ReleaseCandidate,
        track: ReleaseTrack,
        artwork: tuple[bytes, str] | None,
    ) -> None: ...


class MutagenFlacTagger:
    def tag(
        self,
        path: Path,
        *,
        release: ReleaseCandidate,
        track: ReleaseTrack,
        artwork: tuple[bytes, str] | None,
    ) -> None:
        audio = FLAC(path)
        audio["title"] = track.title
        audio["artist"] = track.artist
        audio["albumartist"] = release.artist
        audio["album"] = release.title
        audio["tracknumber"] = str(track.number)
        audio["tracktotal"] = str(len(release.tracks))
        if release.year:
            audio["date"] = release.year
        if release.release_id and not release.release_id.startswith("disc-"):
            audio["musicbrainz_albumid"] = release.release_id
        if artwork:
            picture = Picture()
            picture.type = 3
            picture.mime = artwork[1]
            picture.desc = "Front cover"
            picture.data = artwork[0]
            audio.clear_pictures()
            audio.add_picture(picture)
        audio.save()


def sanitize_component(value: str, fallback: str) -> str:
    """Create a portable filename component without accepting path syntax."""

    cleaned = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", value)
    cleaned = " ".join(cleaned.split()).strip(" .")
    if cleaned.upper() in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{number}" for number in range(1, 10)),
        *(f"LPT{number}" for number in range(1, 10)),
    }:
        cleaned = f"_{cleaned}"
    return (cleaned or fallback)[:120]


class RipService:
    def __init__(
        self,
        settings: Settings,
        store: RipStore,
        storage: StorageGuard,
        hardware: CdHardware,
        scan_service: ScanService,
        *,
        runner: CommandRunner | None = None,
        tagger: AudioTagger | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.storage = storage
        self.hardware = hardware
        self.scan_service = scan_service
        self.runner = runner or SubprocessRunner()
        self.tagger = tagger or MutagenFlacTagger()
        self._guard = threading.Lock()
        self._thread: threading.Thread | None = None
        self._cancel = threading.Event()
        self._active_job_id: int | None = None
        self.store.recover_interrupted()
        self.cleanup_staging()

    @property
    def active(self) -> bool:
        with self._guard:
            return self._active_job_id is not None

    def start(
        self,
        disc: DiscLayout,
        release: ReleaseCandidate,
        artwork: tuple[bytes, str] | None,
    ) -> int:
        with self._guard:
            if self._active_job_id is not None:
                raise RipAlreadyRunningError("A CD rip is already running.")
            output_root = self.storage.require_safe_output()
            self._check_conflicts(output_root, release)
            job_id = self.store.create_job(disc.disc_id, release)
            self._active_job_id = job_id
            self._cancel = threading.Event()
            self._thread = threading.Thread(
                target=self._run,
                args=(job_id, disc, release, artwork),
                name=f"cd-rip-{job_id}",
                daemon=True,
            )
            self._thread.start()
            return job_id

    def cancel(self, job_id: int) -> bool:
        with self._guard:
            if self._active_job_id != job_id or not self.store.request_cancel(job_id):
                return False
            self._cancel.set()
            return True

    def wait(self, timeout: float = 10) -> bool:
        thread = self._thread
        if thread:
            thread.join(timeout)
        return not self.active

    def cleanup_staging(self) -> None:
        if self.settings.external_storage_path is not None and not self.storage.status().available:
            return
        root = self.settings.rip_staging_directory
        if not root.exists():
            return
        for child in root.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            elif child.is_file():
                child.unlink(missing_ok=True)

    def _run(
        self,
        job_id: int,
        disc: DiscLayout,
        release: ReleaseCandidate,
        artwork: tuple[bytes, str] | None,
    ) -> None:
        self.store.set_job_state(job_id, "ripping", message="Preparing the first track.")
        try:
            output_root = self.storage.require_safe_output()
            staging = self.storage.require_safe_staging() / str(job_id)
            staging.mkdir(parents=True, exist_ok=True)
            album_directory = self._album_directory(output_root, release)
            album_directory.mkdir(parents=True, exist_ok=True)
            self._save_cover(album_directory, artwork)
            for track in release.tracks:
                if self._cancelled(job_id):
                    self._cancel_waiting(job_id, release.tracks, track.number)
                    break
                current_disc = self.hardware.probe().disc
                if current_disc is None or current_disc.disc_id != disc.disc_id:
                    self.store.set_track_state(
                        job_id, track.number, "error", error="The CD was removed or changed."
                    )
                    self._cancel_waiting(job_id, release.tracks, track.number + 1, error=True)
                    break
                self._rip_track(job_id, release, track, artwork, staging, album_directory)

            job = self.store.get_job(job_id)
            if self._cancelled(job_id):
                self.store.set_job_state(
                    job_id,
                    "cancelled",
                    message="Rip cancelled; completed tracks were kept.",
                    finished=True,
                )
            elif job and job["failed_tracks"]:
                self.store.set_job_state(
                    job_id,
                    "partial",
                    message="Rip finished with one or more track errors.",
                    finished=True,
                )
            else:
                self.store.set_job_state(
                    job_id, "completed", message="CD rip completed.", finished=True
                )
            with suppress(Exception):
                self.scan_service.reconcile_after_rip()
                # Each ready track is already indexed; reconciliation can be retried later.
        except StorageSafetyError as exc:
            self.store.set_job_state(job_id, "failed", error=str(exc), finished=True)
        except Exception:
            self.store.set_job_state(
                job_id,
                "failed",
                error="The rip stopped unexpectedly. Completed tracks were kept.",
                finished=True,
            )
        finally:
            staging = self.settings.rip_staging_directory / str(job_id)
            shutil.rmtree(staging, ignore_errors=True)
            with self._guard:
                self._active_job_id = None

    def _rip_track(
        self,
        job_id: int,
        release: ReleaseCandidate,
        track: ReleaseTrack,
        artwork: tuple[bytes, str] | None,
        staging: Path,
        album_directory: Path,
    ) -> None:
        wav = staging / f"track-{track.number:02d}.wav"
        encoded = staging / f"track-{track.number:02d}.partial.flac"
        final = album_directory / self._track_filename(track)
        try:
            self.store.set_track_state(job_id, track.number, "reading")
            result = self.runner.run_cancellable(
                [
                    self.settings.cdparanoia_executable,
                    "-d",
                    str(self.settings.optical_drive_path),
                    str(track.number),
                    str(wav),
                ],
                cancel=self._cancel,
                nice=self.settings.cd_process_nice,
            )
            if self._cancelled(job_id):
                self.store.set_track_state(job_id, track.number, "cancelled")
                return
            if result.returncode != 0 or not wav.is_file():
                raise RuntimeError("The drive could not read this track securely.")

            self.store.set_track_state(job_id, track.number, "encoding")
            result = self.runner.run_cancellable(
                [
                    self.settings.flac_executable,
                    "--silent",
                    "--best",
                    f"--output-name={encoded}",
                    str(wav),
                ],
                cancel=self._cancel,
                nice=self.settings.cd_process_nice,
            )
            if self._cancelled(job_id):
                self.store.set_track_state(job_id, track.number, "cancelled")
                return
            if result.returncode != 0 or not encoded.is_file():
                raise RuntimeError("This track could not be encoded as FLAC.")

            self.store.set_track_state(job_id, track.number, "tagging")
            self.tagger.tag(encoded, release=release, track=track, artwork=artwork)
            if self._cancelled(job_id):
                self.store.set_track_state(job_id, track.number, "cancelled")
                return
            if final.exists():
                raise RuntimeError("A track with this final name already exists.")
            os.replace(encoded, final)
            relative = final.relative_to(self.settings.validated_library_root()).as_posix()
            self.scan_service.index_finalized_file(final)
            self.store.set_track_state(job_id, track.number, "ready", relative_path=relative)
        except Exception as exc:
            if self._cancelled(job_id):
                self.store.set_track_state(job_id, track.number, "cancelled")
            else:
                message = (
                    str(exc)
                    if isinstance(exc, RuntimeError)
                    else "This track could not be finalised safely."
                )
                self.store.set_track_state(job_id, track.number, "error", error=message)
        finally:
            wav.unlink(missing_ok=True)
            encoded.unlink(missing_ok=True)

    def _cancelled(self, job_id: int) -> bool:
        return self._cancel.is_set() or self.store.cancel_requested(job_id)

    def _cancel_waiting(
        self,
        job_id: int,
        tracks: tuple[ReleaseTrack, ...],
        start: int,
        *,
        error: bool = False,
    ) -> None:
        for track in tracks:
            if track.number >= start:
                self.store.set_track_state(
                    job_id,
                    track.number,
                    "error" if error else "cancelled",
                    error="The CD was removed or changed." if error else None,
                )

    def _check_conflicts(self, output_root: Path, release: ReleaseCandidate) -> None:
        album = self._album_directory(output_root, release)
        conflicts = [
            track for track in release.tracks if (album / self._track_filename(track)).exists()
        ]
        if conflicts:
            raise RipConflictError(
                "One or more destination tracks already exist. "
                "Existing music will not be overwritten."
            )

    @staticmethod
    def _album_directory(output_root: Path, release: ReleaseCandidate) -> Path:
        artist = sanitize_component(release.artist, "Unknown Artist")
        album = sanitize_component(release.title, "Unknown Album")
        return output_root / artist / album

    @staticmethod
    def _track_filename(track: ReleaseTrack) -> str:
        title = sanitize_component(track.title, f"Track {track.number}")
        return f"{track.number:02d} - {title}.flac"

    @staticmethod
    def _save_cover(album_directory: Path, artwork: tuple[bytes, str] | None) -> None:
        if not artwork:
            return
        target = album_directory / "Cover.jpg"
        if target.exists():
            return
        temporary = album_directory / ".Cover.jpg.partial"
        try:
            temporary.write_bytes(artwork[0])
            os.replace(temporary, target)
        except OSError:
            temporary.unlink(missing_ok=True)
