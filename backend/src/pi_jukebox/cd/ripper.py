"""Track-at-a-time secure CD extraction and atomic library finalisation."""

import os
import re
import shutil
import threading
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from mutagen import MutagenError
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


class FinalizedTrackVerifier(Protocol):
    def matches(
        self,
        path: Path,
        *,
        release: ReleaseCandidate,
        track: ReleaseTrack,
    ) -> bool: ...


class MutagenFinalizedTrackVerifier:
    """Verify that an existing FLAC belongs to the persisted release snapshot."""

    @staticmethod
    def _first(audio: FLAC, key: str) -> str | None:
        values = audio.get(key)
        return str(values[0]) if values else None

    def matches(
        self,
        path: Path,
        *,
        release: ReleaseCandidate,
        track: ReleaseTrack,
    ) -> bool:
        try:
            audio = FLAC(path)
            track_number = self._first(audio, "tracknumber")
            if track_number is None or int(track_number.split("/", 1)[0]) != track.number:
                return False
            expected = {
                "title": track.title,
                "artist": track.artist,
                "album": release.title,
                "albumartist": release.artist,
            }
            if any(self._first(audio, key) != value for key, value in expected.items()):
                return False
            if not release.release_id.startswith("disc-"):
                return self._first(audio, "musicbrainz_albumid") == release.release_id
            return True
        except (MutagenError, OSError, TypeError, ValueError):
            return False


RipAction = Literal["start", "resume", "complete", "conflict", "unavailable"]


@dataclass(frozen=True, slots=True)
class RipAssessment:
    action: RipAction
    message: str
    source_job_id: int | None = None
    ready_paths: tuple[tuple[int, str], ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {
            "action": self.action,
            "message": self.message,
            "source_job_id": self.source_job_id,
        }


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
        finalized_verifier: FinalizedTrackVerifier | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.storage = storage
        self.hardware = hardware
        self.scan_service = scan_service
        self.runner = runner or SubprocessRunner()
        self.tagger = tagger or MutagenFlacTagger()
        self.finalized_verifier = finalized_verifier or MutagenFinalizedTrackVerifier()
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
            assessment = self._assess(output_root, disc, release)
            if assessment.action == "conflict":
                raise RipConflictError(assessment.message)
            if assessment.action == "complete":
                raise RipConflictError(assessment.message)
            if assessment.action == "unavailable":
                raise RipConflictError(assessment.message)
            ready_paths = dict(assessment.ready_paths)
            job_id = self.store.create_job(
                disc.disc_id,
                release,
                ready_paths=ready_paths,
            )
            self._active_job_id = job_id
            self._cancel = threading.Event()
            self._thread = threading.Thread(
                target=self._run,
                args=(job_id, disc, release, artwork, frozenset(ready_paths)),
                name=f"cd-rip-{job_id}",
                daemon=True,
            )
            self._thread.start()
            return job_id

    def assess(self, disc: DiscLayout | None, release: ReleaseCandidate | None) -> RipAssessment:
        if disc is None or release is None:
            return RipAssessment("unavailable", "Select a release for the inserted CD first.")
        if self.active:
            return RipAssessment("unavailable", "A CD rip is already running.")
        try:
            output_root = self.storage.require_safe_output()
        except StorageSafetyError as exc:
            return RipAssessment("unavailable", str(exc))
        return self._assess(output_root, disc, release)

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
        ready_track_numbers: frozenset[int],
    ) -> None:
        message = (
            f"Resuming with {len(ready_track_numbers)} completed track(s)."
            if ready_track_numbers
            else "Preparing the first track."
        )
        self.store.set_job_state(job_id, "ripping", message=message)
        try:
            output_root = self.storage.require_safe_output()
            staging = self.storage.require_safe_staging() / str(job_id)
            staging.mkdir(parents=True, exist_ok=True)
            album_directory = self._album_directory(output_root, release)
            album_directory.mkdir(parents=True, exist_ok=True)
            self._save_cover(album_directory, artwork)
            for track in release.tracks:
                if track.number in ready_track_numbers:
                    continue
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

    def _assess(
        self,
        output_root: Path,
        disc: DiscLayout,
        release: ReleaseCandidate,
    ) -> RipAssessment:
        prior = self.store.latest_for_disc_release(disc.disc_id, release.release_id)
        album = self._album_directory(output_root, release)
        expected_paths = {
            track.number: album / self._track_filename(track) for track in release.tracks
        }
        existing = [path for path in expected_paths.values() if path.exists() or path.is_symlink()]

        if prior is None:
            if existing:
                return RipAssessment(
                    "conflict",
                    "Destination tracks already exist without matching rip history. "
                    "Nothing will be overwritten.",
                )
            return RipAssessment("start", "This release is ready to rip.")

        mismatch = self._snapshot_mismatch(prior, release)
        if mismatch:
            return RipAssessment("conflict", mismatch, int(prior["id"]))

        resumable = prior["status"] in {"cancelled", "interrupted"}
        completed = prior["status"] == "completed"
        if not resumable and not completed:
            if existing:
                return RipAssessment(
                    "conflict",
                    "Existing tracks belong to a previous rip that is not safely resumable. "
                    "Nothing will be overwritten.",
                    int(prior["id"]),
                )
            return RipAssessment("start", "This release is ready to rip.")

        rows = {int(row["track_number"]): row for row in prior["tracks"]}
        ready_paths: dict[int, str] = {}
        library_root = self.settings.validated_library_root()
        for track in release.tracks:
            row = rows[track.number]
            path = expected_paths[track.number]
            expected_relative = path.relative_to(library_root).as_posix()
            recorded_relative = row["final_relative_path"]
            if path.exists() or path.is_symlink():
                try:
                    resolved = path.resolve(strict=True)
                    resolved.relative_to(library_root)
                except (OSError, RuntimeError, ValueError):
                    return self._track_conflict(prior, track)
                if (
                    path.is_symlink()
                    or not resolved.is_file()
                    or (recorded_relative is not None and recorded_relative != expected_relative)
                    or not self.finalized_verifier.matches(
                        resolved,
                        release=release,
                        track=track,
                    )
                ):
                    return self._track_conflict(prior, track)
                ready_paths[track.number] = expected_relative
            elif row["state"] == "ready" or recorded_relative is not None:
                return RipAssessment(
                    "conflict",
                    f"Track {track.number} was recorded as Ready but its finalized file "
                    "is missing. "
                    "Nothing will be overwritten.",
                    int(prior["id"]),
                )

        if len(ready_paths) == len(release.tracks):
            return RipAssessment(
                "complete",
                "Every track for this disc and release is already in the library.",
                int(prior["id"]),
                tuple(sorted(ready_paths.items())),
            )
        if completed:
            return RipAssessment(
                "conflict",
                "The completed rip history no longer matches every destination track. "
                "Nothing will be overwritten.",
                int(prior["id"]),
            )
        return RipAssessment(
            "resume",
            f"Resume will keep {len(ready_paths)} verified track(s) and rip only the remainder.",
            int(prior["id"]),
            tuple(sorted(ready_paths.items())),
        )

    @staticmethod
    def _snapshot_mismatch(prior: dict[str, object], release: ReleaseCandidate) -> str | None:
        if (
            prior["album_title"] != release.title
            or prior["album_artist"] != release.artist
            or int(prior["total_tracks"]) != len(release.tracks)
        ):
            return (
                "The selected release no longer matches the persisted rip details. "
                "Nothing will be overwritten."
            )
        rows = prior["tracks"]
        if not isinstance(rows, list) or len(rows) != len(release.tracks):
            return "The persisted track list is incomplete. Nothing will be overwritten."
        for row, track in zip(rows, release.tracks, strict=True):
            if (
                int(row["track_number"]) != track.number
                or row["title"] != track.title
                or row["artist"] != track.artist
            ):
                return (
                    "The selected release track list differs from the persisted rip. "
                    "Nothing will be overwritten."
                )
        return None

    @staticmethod
    def _track_conflict(prior: dict[str, object], track: ReleaseTrack) -> RipAssessment:
        return RipAssessment(
            "conflict",
            f"Existing track {track.number} could not be verified as part of this disc "
            "and release. "
            "Nothing will be overwritten.",
            int(prior["id"]),
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
