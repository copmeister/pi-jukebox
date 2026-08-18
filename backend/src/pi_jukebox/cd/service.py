"""Non-blocking CD state coordinator used by API polling and the rip worker."""

import logging
import threading
from dataclasses import replace
from pathlib import Path
from typing import Any

from pi_jukebox.cd.hardware import CdHardware
from pi_jukebox.cd.metadata import (
    CandidateArtworkCache,
    MetadataLookupError,
    MusicMetadataClient,
    fallback_release,
)
from pi_jukebox.cd.models import DriveState, ReleaseCandidate
from pi_jukebox.cd.ripper import RipService
from pi_jukebox.cd.storage import StorageGuard
from pi_jukebox.cd.store import RipStore
from pi_jukebox.config import Settings

logger = logging.getLogger(__name__)


class CdService:
    def __init__(
        self,
        settings: Settings,
        hardware: CdHardware,
        metadata: MusicMetadataClient,
        artwork_cache: CandidateArtworkCache,
        storage: StorageGuard,
        ripper: RipService,
        store: RipStore,
    ) -> None:
        self.settings = settings
        self.hardware = hardware
        self.metadata = metadata
        self.artwork_cache = artwork_cache
        self.storage = storage
        self.ripper = ripper
        self.store = store
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._monitor: threading.Thread | None = None
        self._lookup: threading.Thread | None = None
        self._drive = DriveState(
            settings.optical_drive_path is not None,
            False,
            False,
            "Checking the optical drive…",
        )
        self._metadata_state = "idle"
        self._metadata_message: str | None = None
        self._candidates: list[ReleaseCandidate] = []
        self._selected_id: str | None = None
        self._artwork_mime: dict[str, str] = {}

    def start(self) -> None:
        self._monitor = threading.Thread(target=self._monitor_loop, name="cd-monitor", daemon=True)
        self._monitor.start()

    def stop(self) -> None:
        self._stop.set()
        if self._monitor:
            self._monitor.join(5)
        self.ripper.wait(5)

    def refresh_now(self) -> None:
        # Avoid issuing drive-identification commands alongside secure reading.
        # The rip worker itself detects removal through command failure and its
        # between-track disc identity check.
        if self.ripper.active:
            return
        state = self.hardware.probe()
        should_lookup = False
        with self._lock:
            previous_id = self._drive.disc.disc_id if self._drive.disc else None
            current_id = state.disc.disc_id if state.disc else None
            self._drive = state
            if current_id != previous_id:
                self._candidates = []
                self._selected_id = None
                self._metadata_message = None
                self._metadata_state = "reading" if current_id else "idle"
                should_lookup = current_id is not None
        if should_lookup:
            self.lookup()

    def lookup(self) -> bool:
        with self._lock:
            if self._lookup and self._lookup.is_alive():
                return False
            disc = self._drive.disc
            if disc is None:
                return False
            self._metadata_state = "searching"
            self._metadata_message = None
            self._lookup = threading.Thread(
                target=self._lookup_worker,
                args=(disc.disc_id,),
                name=f"cd-metadata-{disc.disc_id}",
                daemon=True,
            )
            self._lookup.start()
            return True

    def select_release(self, release_id: str) -> bool:
        with self._lock:
            release = next(
                (item for item in self._candidates if item.release_id == release_id), None
            )
            if release is None:
                return False
            self._selected_id = release_id
        threading.Thread(
            target=self._artwork_worker,
            args=(release_id,),
            name=f"cd-artwork-{release_id}",
            daemon=True,
        ).start()
        return True

    def start_rip(self, release_id: str) -> int:
        with self._lock:
            disc = self._drive.disc
            release = next(
                (item for item in self._candidates if item.release_id == release_id), None
            )
        if disc is None or release is None:
            raise ValueError("Select a release for the inserted audio CD first.")
        if len(release.tracks) != disc.track_count:
            raise ValueError("The selected release does not match the inserted disc's track count.")
        cover_path = self.artwork_cache.get(release_id)
        artwork = (
            (cover_path.read_bytes(), self._artwork_mime.get(release_id, "image/jpeg"))
            if cover_path
            else None
        )
        return self.ripper.start(disc, release, artwork)

    def cancel(self, job_id: int) -> bool:
        return self.ripper.cancel(job_id)

    def eject(self) -> bool:
        if self.ripper.active:
            return False
        return self.hardware.eject()

    def artwork_path(self, release_id: str) -> Path | None:
        with self._lock:
            known = any(item.release_id == release_id for item in self._candidates)
        return self.artwork_cache.get(release_id) if known else None

    def status(self) -> dict[str, Any]:
        with self._lock:
            drive = self._drive.to_dict()
            candidates = [candidate.to_dict() for candidate in self._candidates]
            metadata_state = self._metadata_state
            metadata_message = self._metadata_message
            selected_id = self._selected_id
        for candidate in candidates:
            candidate["artwork_available"] = (
                self.artwork_cache.get(candidate["release_id"]) is not None
            )
        return {
            "drive": drive,
            "storage": self.storage.status().to_dict(),
            "metadata_state": metadata_state,
            "metadata_message": metadata_message,
            "release_candidates": candidates,
            "selected_release_id": selected_id,
            "active": self.ripper.active,
            "latest_job": self.store.latest_job(),
        }

    def _monitor_loop(self) -> None:
        while not self._stop.is_set():
            self.refresh_now()
            self._stop.wait(max(0.5, self.settings.cd_poll_interval_seconds))

    def _lookup_worker(self, expected_disc_id: str) -> None:
        with self._lock:
            disc = self._drive.disc
        if disc is None or disc.disc_id != expected_disc_id:
            return
        try:
            candidates = self.metadata.releases_for_disc(disc)
            message = None
        except MetadataLookupError as exc:
            candidates = []
            message = str(exc)
            logger.warning(
                "CD metadata lookup for local disc %s is using fallback: %s",
                expected_disc_id,
                message,
            )
        if not candidates:
            if message is None:
                logger.info(
                    "MusicBrainz returned no usable candidates for local disc %s; "
                    "using generic metadata.",
                    expected_disc_id,
                )
            candidates = [fallback_release(disc)]
            message = message or (
                "No MusicBrainz match was found. Generic track names are available."
            )
        with self._lock:
            current = self._drive.disc
            if current is None or current.disc_id != expected_disc_id:
                return
            self._candidates = candidates
            self._metadata_state = "ready" if candidates else "unavailable"
            self._metadata_message = message
            if len(candidates) == 1:
                self._selected_id = candidates[0].release_id
                selected = candidates[0].release_id
            else:
                selected = None
        if selected:
            self._artwork_worker(selected)

    def _artwork_worker(self, release_id: str) -> None:
        if release_id.startswith("disc-") or self.artwork_cache.get(release_id):
            return
        artwork = self.metadata.fetch_front_cover(release_id)
        if artwork is None:
            with self._lock:
                self._metadata_message = (
                    "Release information is ready, but no front cover could be downloaded."
                )
            return
        self.artwork_cache.store(release_id, artwork[0])
        with self._lock:
            self._artwork_mime[release_id] = artwork[1]
            self._candidates = [
                replace(item, artwork_available=True) if item.release_id == release_id else item
                for item in self._candidates
            ]
