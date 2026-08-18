"""Root-helper orchestration for authenticated, immutable Pi Jukebox updates.

This module is invoked only by the separately installed root-owned systemd unit.
The web process cannot pass commands, repository names, paths, or asset names to it;
it can only write one strictly validated semantic-version request.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pi_jukebox.updates.installer import (
    AtomicVersionPointer,
    ReleaseInstaller,
    ReleaseManifest,
    ReleaseValidationError,
    RollbackFailedError,
    UpdateRolledBackError,
    newer_than,
    normalized_version,
    release_archive_name,
    release_manifest_name,
)
from pi_jukebox.version import __version__

LOGGER = logging.getLogger("pi_jukebox.update_helper")
REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
USER_PATTERN = re.compile(r"^[a-z_][a-z0-9_-]*$")
ACTIVE_STAGES = {
    "downloading",
    "verifying",
    "preparing",
    "installing",
    "restarting",
    "rolling_back",
}
FIXED_GH = Path("/usr/bin/gh")
FIXED_SYSTEMCTL = Path("/usr/bin/systemctl")
FIXED_PYTHON = Path("/usr/bin/python3")
FIXED_APP_SERVICE = "pi-jukebox-app.service"
FIXED_HEALTH_URL = "http://127.0.0.1:5173/api/health"
FIXED_RELEASE_ROOT = Path("/home/admin/pi-jukebox-releases")
FIXED_REQUEST_PATH = Path("/home/admin/jukebox-data/updater/request.json")
FIXED_STATUS_PATH = Path("/var/lib/pi-jukebox-updater/status.json")
FIXED_LOCK_PATH = Path("/run/lock/pi-jukebox-updater.lock")
MAX_MANIFEST_DOWNLOAD_BYTES = 1024 * 1024
MAX_ARCHIVE_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024


class HelperConfigurationError(RuntimeError):
    """The root-owned updater configuration is unsafe or incomplete."""


class UpdateAlreadyRunningError(RuntimeError):
    """Another root helper already owns the installation lock."""


@dataclass(frozen=True, slots=True)
class HelperConfig:
    repository: str
    release_root: Path
    request_path: Path
    status_path: Path
    lock_path: Path
    gh_user: str
    command_timeout_seconds: float
    download_timeout_seconds: float
    retry_count: int
    health_attempts: int
    health_interval_seconds: float

    @classmethod
    def load(cls, path: Path) -> HelperConfig:
        try:
            raw: Any = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise HelperConfigurationError("The updater configuration could not be read.") from exc
        expected = {
            "format_version",
            "repository",
            "release_root",
            "request_path",
            "status_path",
            "lock_path",
            "gh_user",
            "command_timeout_seconds",
            "download_timeout_seconds",
            "retry_count",
            "health_attempts",
            "health_interval_seconds",
        }
        if not isinstance(raw, dict) or set(raw) != expected or raw.get("format_version") != 1:
            raise HelperConfigurationError("The updater configuration format is invalid.")

        repository = raw.get("repository")
        gh_user = raw.get("gh_user")
        release_root = Path(str(raw.get("release_root", "")))
        request_path = Path(str(raw.get("request_path", "")))
        status_path = Path(str(raw.get("status_path", "")))
        lock_path = Path(str(raw.get("lock_path", "")))
        try:
            command_timeout = float(raw.get("command_timeout_seconds"))
            download_timeout = float(raw.get("download_timeout_seconds"))
            retry_count = int(raw.get("retry_count"))
            health_attempts = int(raw.get("health_attempts"))
            health_interval = float(raw.get("health_interval_seconds"))
        except (TypeError, ValueError) as exc:
            raise HelperConfigurationError("The updater timing configuration is invalid.") from exc

        if (
            not isinstance(repository, str)
            or not REPOSITORY_PATTERN.fullmatch(repository)
            or not isinstance(gh_user, str)
            or not USER_PATTERN.fullmatch(gh_user)
            or release_root != FIXED_RELEASE_ROOT
            or request_path != FIXED_REQUEST_PATH
            or status_path != FIXED_STATUS_PATH
            or lock_path != FIXED_LOCK_PATH
            or not 5 <= command_timeout <= 300
            or not 10 <= download_timeout <= 900
            or not 0 <= retry_count <= 5
            or not 2 <= health_attempts <= 60
            or not 0.25 <= health_interval <= 10
        ):
            raise HelperConfigurationError("The updater configuration is unsafe.")
        return cls(
            repository=repository,
            release_root=release_root,
            request_path=request_path,
            status_path=status_path,
            lock_path=lock_path,
            gh_user=gh_user,
            command_timeout_seconds=command_timeout,
            download_timeout_seconds=download_timeout,
            retry_count=retry_count,
            health_attempts=health_attempts,
            health_interval_seconds=health_interval,
        )


@dataclass(frozen=True, slots=True)
class ProcessResult:
    returncode: int
    stdout: str


class CommandExecutor:
    """Run fixed argument arrays with bounded retry and no shell."""

    def run(
        self,
        arguments: list[str],
        *,
        timeout: float,
        retries: int = 0,
        environment: dict[str, str] | None = None,
    ) -> ProcessResult:
        last_error: Exception | None = None
        for attempt in range(retries + 1):
            try:
                completed = subprocess.run(
                    arguments,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    check=False,
                    shell=False,
                    env=environment,
                )
                if completed.returncode == 0:
                    return ProcessResult(0, completed.stdout)
                last_error = RuntimeError(
                    f"A required updater command exited with status {completed.returncode}."
                )
            except (OSError, subprocess.SubprocessError) as exc:
                last_error = exc
            if attempt < retries:
                time.sleep(min(1.0 * (attempt + 1), 3.0))
        raise RuntimeError("A required updater command failed.") from last_error


class UpdateStatusWriter:
    """Persist browser-safe progress outside every version directory."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def write(
        self,
        *,
        state: str,
        stage: str,
        requested_version: str | None,
        previous_version: str | None,
        message: str,
        error: str | None = None,
    ) -> None:
        payload = {
            "format_version": 1,
            "state": state,
            "stage": stage,
            "requested_version": requested_version,
            "previous_version": previous_version,
            "message": message,
            "error": error,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, self.path)


class GitHubReleaseDownloader:
    """Download two exact assets from one stable tag using the Pi account's gh login."""

    def __init__(self, config: HelperConfig, executor: CommandExecutor) -> None:
        self.config = config
        self.executor = executor

    def _gh(self, arguments: list[str], *, timeout: float, retries: int) -> ProcessResult:
        return self.executor.run(
            [str(FIXED_GH), *arguments],
            timeout=timeout,
            retries=retries,
            environment={
                "PATH": "/usr/bin:/bin",
                "HOME": f"/home/{self.config.gh_user}",
                "GH_CONFIG_DIR": f"/home/{self.config.gh_user}/.config/gh",
                "GH_NO_UPDATE_NOTIFIER": "1",
                "GH_PROMPT_DISABLED": "1",
                "LANG": "C.UTF-8",
            },
        )

    def download(self, version: str, destination: Path) -> tuple[Path, Path]:
        tag = f"v{version}"
        metadata = self._gh(
            ["api", "--method", "GET", f"repos/{self.config.repository}/releases/tags/{tag}"],
            timeout=self.config.command_timeout_seconds,
            retries=self.config.retry_count,
        )
        try:
            payload = json.loads(metadata.stdout)
            asset_sizes = {
                str(asset["name"]): int(asset["size"])
                for asset in payload["assets"]
                if isinstance(asset, dict) and "name" in asset and "size" in asset
            }
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ReleaseValidationError("GitHub returned invalid release metadata.") from exc
        if (
            payload.get("draft") is not False
            or payload.get("prerelease") is not False
            or normalized_version(str(payload.get("tag_name", ""))) != version
        ):
            raise ReleaseValidationError("The requested GitHub release is not stable.")

        archive_name = release_archive_name(version)
        manifest_name = release_manifest_name(version)
        if not {archive_name, manifest_name}.issubset(asset_sizes):
            raise ReleaseValidationError("The stable release is missing required update assets.")
        if (
            not 0 < asset_sizes[manifest_name] <= MAX_MANIFEST_DOWNLOAD_BYTES
            or not 0 < asset_sizes[archive_name] <= MAX_ARCHIVE_DOWNLOAD_BYTES
        ):
            raise ReleaseValidationError("A release asset exceeds the allowed download size.")

        destination.mkdir(parents=True, exist_ok=False)
        for asset_name in (manifest_name, archive_name):
            self._gh(
                [
                    "release",
                    "download",
                    tag,
                    "--repo",
                    self.config.repository,
                    "--pattern",
                    asset_name,
                    "--dir",
                    str(destination),
                    "--clobber",
                ],
                timeout=self.config.download_timeout_seconds,
                retries=self.config.retry_count,
            )
        manifest = destination / manifest_name
        archive = destination / archive_name
        if not manifest.is_file() or not archive.is_file():
            raise ReleaseValidationError("The required release assets were not downloaded.")
        if (
            manifest.stat().st_size != asset_sizes[manifest_name]
            or archive.stat().st_size != asset_sizes[archive_name]
        ):
            raise ReleaseValidationError("A downloaded release asset has an unexpected size.")
        return archive, manifest


class ReleasePreparer:
    """Create an isolated per-release venv entirely from the bundled wheelhouse."""

    def __init__(self, config: HelperConfig, executor: CommandExecutor) -> None:
        self.config = config
        self.executor = executor

    def __call__(self, release: Path, manifest: ReleaseManifest) -> None:
        architecture = platform.machine().casefold()
        expected_arch = "aarch64" if manifest.architecture == "arm64" else manifest.architecture
        actual_arch = "aarch64" if architecture == "arm64" else architecture
        expected_python = tuple(map(int, manifest.python_version.split(".")))
        actual_python = tuple(os.sys.version_info[:2])
        if actual_arch != expected_arch or actual_python != expected_python:
            raise ReleaseValidationError("This release is incompatible with this Raspberry Pi.")

        requirements = release / "requirements.lock"
        wheelhouse = release / "wheelhouse"
        app_wheels = sorted((release / "app").glob("*.whl"))
        frontend = release / "frontend" / "dist" / "index.html"
        if (
            not requirements.is_file()
            or not wheelhouse.is_dir()
            or len(app_wheels) != 1
            or not frontend.is_file()
        ):
            raise ReleaseValidationError("The release package cannot be prepared.")

        self.executor.run(
            [str(FIXED_PYTHON), "-m", "venv", str(release / ".venv")],
            timeout=self.config.command_timeout_seconds,
        )
        python = release / ".venv" / "bin" / "python"
        self.executor.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--no-index",
                "--find-links",
                str(wheelhouse),
                "--require-hashes",
                "-r",
                str(requirements),
            ],
            timeout=self.config.download_timeout_seconds,
        )
        self.executor.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--no-index",
                "--no-deps",
                str(app_wheels[0]),
            ],
            timeout=self.config.command_timeout_seconds,
        )
        installed = self.executor.run(
            [
                str(python),
                "-c",
                "from pi_jukebox.version import __version__; print(__version__)",
            ],
            timeout=self.config.command_timeout_seconds,
        )
        if normalized_version(installed.stdout.strip()) != manifest.application_version:
            raise ReleaseValidationError("The prepared application version did not match.")


class ApplicationController:
    def __init__(self, config: HelperConfig, executor: CommandExecutor) -> None:
        self.config = config
        self.executor = executor

    def restart(self) -> None:
        self.executor.run(
            [str(FIXED_SYSTEMCTL), "restart", FIXED_APP_SERVICE],
            timeout=self.config.command_timeout_seconds,
        )

    def healthy(self, expected_version: str) -> bool:
        for _attempt in range(self.config.health_attempts):
            try:
                request = urllib.request.Request(
                    FIXED_HEALTH_URL,
                    headers={"Accept": "application/json"},
                    method="GET",
                )
                with urllib.request.urlopen(request, timeout=3) as response:  # noqa: S310
                    payload = json.loads(response.read(64 * 1024))
                if (
                    response.status == 200
                    and payload.get("status") == "ok"
                    and normalized_version(str(payload.get("version", ""))) == expected_version
                ):
                    return True
            except (OSError, UnicodeError, ValueError, urllib.error.URLError):
                pass
            time.sleep(self.config.health_interval_seconds)
        return False


def _load_request(path: Path) -> tuple[str, str]:
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        try:
            details = os.fstat(descriptor)
            if not stat.S_ISREG(details.st_mode) or not 0 < details.st_size <= 4096:
                raise ReleaseValidationError("The update request is invalid.")
            content = os.read(descriptor, 4097)
        finally:
            os.close(descriptor)
        raw: Any = json.loads(content.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReleaseValidationError("The update request could not be read.") from exc
    if not isinstance(raw, dict) or set(raw) != {
        "format_version",
        "version",
        "installed_version",
        "requested_at",
    }:
        raise ReleaseValidationError("The update request is invalid.")
    version = normalized_version(str(raw.get("version", "")))
    installed = normalized_version(str(raw.get("installed_version", "")))
    requested_at = raw.get("requested_at")
    if (
        raw.get("format_version") != 1
        or version is None
        or installed is None
        or not isinstance(requested_at, str)
    ):
        raise ReleaseValidationError("The update request is invalid.")
    try:
        datetime.fromisoformat(requested_at)
    except ValueError as exc:
        raise ReleaseValidationError("The update request timestamp is invalid.") from exc
    return version, installed


@contextmanager
def _exclusive_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:
            pass
        except BlockingIOError as exc:
            raise UpdateAlreadyRunningError(
                "Another update installation is already active."
            ) from exc
        yield
    finally:
        os.close(descriptor)


class UpdateHelper:
    """Coordinate one semver request from download through rollback-safe activation."""

    def __init__(
        self,
        config: HelperConfig,
        *,
        executor: CommandExecutor | None = None,
        downloader_factory: Callable[[HelperConfig, CommandExecutor], GitHubReleaseDownloader]
        | None = None,
        preparer_factory: Callable[[HelperConfig, CommandExecutor], ReleasePreparer] | None = None,
        controller_factory: Callable[[HelperConfig, CommandExecutor], ApplicationController]
        | None = None,
    ) -> None:
        self.config = config
        self.executor = executor or CommandExecutor()
        self.downloader = (downloader_factory or GitHubReleaseDownloader)(config, self.executor)
        self.preparer = (preparer_factory or ReleasePreparer)(config, self.executor)
        self.controller = (controller_factory or ApplicationController)(config, self.executor)
        self.status = UpdateStatusWriter(config.status_path)

    def run(self) -> bool:
        requested: str | None = None
        previous: str | None = None
        owns_request = False
        try:
            with _exclusive_lock(self.config.lock_path):
                owns_request = True
                requested, installed = _load_request(self.config.request_path)
                pointer = AtomicVersionPointer(self.config.release_root)
                previous = pointer.current()
                if (
                    previous is None
                    or installed != previous
                    or normalized_version(__version__) != previous
                    or not newer_than(requested, previous)
                ):
                    raise ReleaseValidationError("The update request is stale or not newer.")

                self.status.write(
                    state="installing",
                    stage="downloading",
                    requested_version=requested,
                    previous_version=previous,
                    message=f"Downloading Pi Jukebox {requested}.",
                )
                download_root = self.config.release_root / "downloads"
                download_root.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(
                    prefix=f".{requested}-", dir=download_root
                ) as temp:
                    archive, manifest_path = self.downloader.download(
                        requested, Path(temp) / "assets"
                    )
                    manifest = ReleaseManifest.load(manifest_path, requested)
                    architecture = platform.machine().casefold()
                    expected = (
                        "aarch64" if manifest.architecture == "arm64" else manifest.architecture
                    )
                    actual = "aarch64" if architecture == "arm64" else architecture
                    if actual != expected:
                        raise ReleaseValidationError(
                            "The downloaded release does not support this architecture."
                        )
                    installer = ReleaseInstaller(
                        self.config.release_root,
                        prepare=self.preparer,
                        restart=self.controller.restart,
                        healthy=self.controller.healthy,
                        progress=lambda stage, message: self.status.write(
                            state="installing",
                            stage=stage,
                            requested_version=requested,
                            previous_version=previous,
                            message=message,
                        ),
                    )
                    installer.install(archive, manifest_path, requested)
                self.status.write(
                    state="succeeded",
                    stage="complete",
                    requested_version=requested,
                    previous_version=previous,
                    message=f"Updated successfully to {requested}.",
                )
                LOGGER.info("Pi Jukebox update to %s completed", requested)
                return True
        except UpdateAlreadyRunningError:
            LOGGER.warning("Another update helper already owns the installation lock")
            return False
        except UpdateRolledBackError as exc:
            self.status.write(
                state="rolled_back",
                stage="complete",
                requested_version=requested,
                previous_version=exc.previous_version,
                message=(f"Update failed. Pi Jukebox was restored to {exc.previous_version}."),
                error="The new release failed its health check.",
            )
            LOGGER.error("Update failed health checking and was rolled back")
            return False
        except RollbackFailedError:
            self.status.write(
                state="failed",
                stage="recovery_required",
                requested_version=requested,
                previous_version=previous,
                message="Automatic rollback could not restore a healthy jukebox.",
                error="Administrator recovery is required.",
            )
            LOGGER.exception("Update and automatic rollback both failed")
            return False
        except Exception:
            self.status.write(
                state="failed",
                stage="complete",
                requested_version=requested,
                previous_version=previous,
                message="The update failed before activation. The current version remains active.",
                error="The release could not be downloaded, verified, or prepared.",
            )
            LOGGER.exception("Update failed before successful activation")
            return False
        finally:
            if owns_request:
                self.config.request_path.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install one validated Pi Jukebox release")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("/etc/pi-jukebox-updater.json"),
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        config = HelperConfig.load(args.config)
        return 0 if UpdateHelper(config).run() else 1
    except Exception:
        with suppress(OSError):
            UpdateStatusWriter(FIXED_STATUS_PATH).write(
                state="failed",
                stage="recovery_required",
                requested_version=None,
                previous_version=None,
                message="The isolated updater configuration could not be loaded.",
                error="Administrator recovery is required.",
            )
        with suppress(OSError):
            FIXED_REQUEST_PATH.unlink(missing_ok=True)
        LOGGER.exception("The updater helper could not start")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
