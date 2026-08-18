"""Non-blocking stable-release checks and a narrow updater-service trigger."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from pi_jukebox.cd.hardware import CommandRunner, SubprocessRunner
from pi_jukebox.config import Settings
from pi_jukebox.updates.installer import (
    newer_than,
    normalized_version,
    release_archive_name,
    release_manifest_name,
)
from pi_jukebox.version import __version__

ACTIVE_HELPER_STAGES = {
    "downloading",
    "verifying",
    "preparing",
    "installing",
    "restarting",
    "rolling_back",
}
HELPER_STATES = {"installing", "succeeded", "rolled_back", "failed"}
PRODUCTION_REQUEST_PATH = Path("/home/admin/jukebox-data/updater/request.json")
PRODUCTION_STATUS_PATH = Path("/var/lib/pi-jukebox-updater/status.json")


@dataclass(frozen=True, slots=True)
class ReleaseInfo:
    version: str
    tag_name: str
    asset_names: frozenset[str]

    @property
    def installable(self) -> bool:
        return {
            release_archive_name(self.version),
            release_manifest_name(self.version),
        }.issubset(self.asset_names)


class ReleaseSource(Protocol):
    def latest_release(self) -> ReleaseInfo | None: ...


class GitHubCliReleaseSource:
    """Read stable private releases using the service account's existing gh login."""

    def __init__(self, settings: Settings, runner: CommandRunner | None = None) -> None:
        self.settings = settings
        self.runner = runner or SubprocessRunner()

    def latest_release(self) -> ReleaseInfo | None:
        result = self.runner.run(
            [
                "gh",
                "api",
                "--method",
                "GET",
                f"repos/{self.settings.update_repository}/releases",
                "-f",
                "per_page=30",
            ],
            timeout=self.settings.update_timeout_seconds,
        )
        if result.returncode != 0:
            raise RuntimeError("The release service is unavailable.")
        try:
            payload: Any = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("The release service returned invalid information.") from exc
        if not isinstance(payload, list):
            raise RuntimeError("The release service returned invalid information.")

        stable: list[ReleaseInfo] = []
        for item in payload:
            if (
                not isinstance(item, dict)
                or item.get("draft") is not False
                or item.get("prerelease") is not False
            ):
                continue
            version = normalized_version(str(item.get("tag_name", "")))
            assets = item.get("assets")
            if version is None or not isinstance(assets, list):
                continue
            names = frozenset(
                str(asset["name"])
                for asset in assets
                if isinstance(asset, dict) and isinstance(asset.get("name"), str)
            )
            stable.append(ReleaseInfo(version, str(item["tag_name"]), names))
        if not stable:
            return None
        return max(stable, key=lambda item: tuple(map(int, item.version.split("."))))


@dataclass(frozen=True, slots=True)
class HelperStatus:
    state: str
    stage: str
    requested_version: str | None
    previous_version: str | None
    message: str
    error: str | None

    @classmethod
    def load(cls, path: Path | None) -> HelperStatus | None:
        if path is None or not path.is_file():
            return None
        try:
            raw: Any = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict) or raw.get("format_version") != 1:
            return None
        state = raw.get("state")
        stage = raw.get("stage")
        requested = raw.get("requested_version")
        previous = raw.get("previous_version")
        message = raw.get("message")
        error = raw.get("error")
        if (
            not isinstance(state, str)
            or state not in HELPER_STATES
            or not isinstance(stage, str)
            or (requested is not None and normalized_version(str(requested)) is None)
            or (previous is not None and normalized_version(str(previous)) is None)
            or not isinstance(message, str)
            or (error is not None and not isinstance(error, str))
        ):
            return None
        return cls(
            state=state,
            stage=stage,
            requested_version=str(requested) if requested is not None else None,
            previous_version=str(previous) if previous is not None else None,
            message=message,
            error=error,
        )


class UpdateService:
    def __init__(
        self,
        settings: Settings,
        source: ReleaseSource,
    ) -> None:
        self.settings = settings
        self.source = source
        self._lock = threading.Lock()
        self._checking = False
        self._triggering_install = False
        self._latest: ReleaseInfo | None = None
        self._last_error: str | None = None
        self._last_message: str | None = None
        self._stop = threading.Event()
        self._startup_thread: threading.Thread | None = None

    def start(self) -> None:
        if not self.settings.update_check_enabled:
            return
        self._startup_thread = threading.Thread(
            target=self._delayed_check, name="update-startup-check", daemon=True
        )
        self._startup_thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._startup_thread:
            self._startup_thread.join(2)

    def check(self) -> bool:
        with self._lock:
            if self._checking:
                return False
            self._checking = True
            self._last_error = None
        threading.Thread(target=self._check_worker, name="update-check", daemon=True).start()
        return True

    def request_install(self) -> bool:
        with self._lock:
            latest = self._latest
            helper = HelperStatus.load(self.settings.update_status_path)
            if (
                self._triggering_install
                or (helper is not None and helper.stage in ACTIVE_HELPER_STAGES)
                or bool(
                    self.settings.update_request_path and self.settings.update_request_path.exists()
                )
                or not self._installation_configured()
                or latest is None
                or not latest.installable
                or not newer_than(latest.version, __version__)
            ):
                return False
            self._triggering_install = True
            self._last_error = None
            self._last_message = f"Starting the isolated installer for {latest.version}."
        threading.Thread(
            target=self._install_worker,
            args=(latest.version,),
            name=f"update-install-{latest.version}",
            daemon=True,
        ).start()
        return True

    def status(self) -> dict[str, object]:
        helper = HelperStatus.load(self.settings.update_status_path)
        with self._lock:
            latest = self._latest
            helper_active = bool(helper and helper.stage in ACTIVE_HELPER_STAGES)
            request_pending = bool(
                self.settings.update_request_path and self.settings.update_request_path.exists()
            )
            queued = self._triggering_install or (request_pending and not helper_active)
            installing = queued or helper_active
            visible_helper = (
                helper
                if helper_active
                or latest is None
                or (helper is not None and helper.requested_version == latest.version)
                else None
            )
            update_available = bool(latest and newer_than(latest.version, __version__))
            install_available = bool(
                update_available
                and latest
                and latest.installable
                and self._installation_configured()
                and not installing
            )
            return {
                "installed_version": __version__,
                "latest_version": latest.version if latest else None,
                "checking": self._checking,
                "installing": installing,
                "update_available": update_available,
                "install_available": install_available,
                "stage": (
                    "queued" if queued else visible_helper.stage if visible_helper else "idle"
                ),
                "outcome": (
                    None
                    if queued or visible_helper is None or visible_helper.state == "installing"
                    else visible_helper.state
                ),
                "requested_version": (
                    latest.version
                    if queued and latest
                    else visible_helper.requested_version
                    if visible_helper
                    else None
                ),
                "previous_version": (
                    __version__
                    if queued
                    else visible_helper.previous_version
                    if visible_helper
                    else None
                ),
                "message": (
                    self._last_message
                    if queued
                    else visible_helper.message
                    if visible_helper
                    else self._last_message
                ),
                "last_error": (
                    None if queued else visible_helper.error if visible_helper else self._last_error
                ),
                "source": "Authenticated stable GitHub Releases via the local GitHub CLI",
            }

    def _installation_configured(self) -> bool:
        request = self.settings.update_request_path
        status = self.settings.update_status_path
        basic = bool(
            self.settings.update_install_enabled
            and request is not None
            and status is not None
            and request.is_absolute()
            and status.is_absolute()
            and request.parent != Path("/")
            and status.parent != Path("/")
        )
        if not basic:
            return False
        if self.settings.environment == "production":
            return request == PRODUCTION_REQUEST_PATH and status == PRODUCTION_STATUS_PATH
        return True

    def _delayed_check(self) -> None:
        if not self._stop.wait(max(0, self.settings.update_check_delay_seconds)):
            self.check()

    def _check_worker(self) -> None:
        try:
            latest = self.source.latest_release()
            with self._lock:
                self._latest = latest
                self._last_message = (
                    f"Version {latest.version} is available."
                    if latest and newer_than(latest.version, __version__)
                    else "This jukebox is up to date."
                )
                self._last_error = None
        except Exception:
            with self._lock:
                self._last_error = (
                    "Updates could not be checked right now. Normal jukebox use is unaffected."
                )
        finally:
            with self._lock:
                self._checking = False

    def _install_worker(self, version: str) -> None:
        request_path = self.settings.update_request_path
        try:
            if request_path is None:
                raise RuntimeError("The update request path is not configured.")
            request_path.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps(
                {
                    "format_version": 1,
                    "version": version,
                    "installed_version": __version__,
                    "requested_at": datetime.now(UTC).isoformat(),
                },
                sort_keys=True,
            ).encode()
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(request_path, flags, 0o640)
            try:
                os.write(descriptor, payload + b"\n")
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            with self._lock:
                self._last_message = (
                    "The isolated update service accepted the request. "
                    "Installation progress will appear here."
                )
        except Exception:
            if request_path is not None:
                request_path.unlink(missing_ok=True)
            with self._lock:
                self._last_error = (
                    "The update could not be started. The current version remains active."
                )
        finally:
            with self._lock:
                self._triggering_install = False
