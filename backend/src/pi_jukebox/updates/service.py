"""Non-blocking GitHub Release checks with a disabled-by-default install boundary."""

import json
import re
import threading
from typing import Protocol

from pi_jukebox.cd.hardware import CommandRunner, SubprocessRunner
from pi_jukebox.config import Settings
from pi_jukebox.version import __version__

VERSION_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


class ReleaseSource(Protocol):
    def latest_version(self) -> str | None: ...


def normalized_version(value: str) -> str | None:
    match = VERSION_PATTERN.fullmatch(value.strip())
    return ".".join(match.groups()) if match else None


def newer_than(candidate: str, installed: str) -> bool:
    candidate_value = normalized_version(candidate)
    installed_value = normalized_version(installed)
    if candidate_value is None or installed_value is None:
        return False
    return tuple(map(int, candidate_value.split("."))) > tuple(map(int, installed_value.split(".")))


class GitHubCliReleaseSource:
    """Read one private repository release through the service account's `gh` login."""

    def __init__(self, settings: Settings, runner: CommandRunner | None = None) -> None:
        self.settings = settings
        self.runner = runner or SubprocessRunner()

    def latest_version(self) -> str | None:
        result = self.runner.run(
            [
                "gh",
                "api",
                "--method",
                "GET",
                f"repos/{self.settings.update_repository}/releases/latest",
            ],
            timeout=self.settings.update_timeout_seconds,
        )
        if result.returncode != 0:
            raise RuntimeError("The release service is unavailable.")
        try:
            payload = json.loads(result.stdout)
            tag = payload["tag_name"]
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("The release service returned invalid information.") from exc
        version = normalized_version(str(tag))
        if version is None:
            raise RuntimeError("The latest release has an unsupported version tag.")
        return version


class UpdateService:
    def __init__(
        self,
        settings: Settings,
        source: ReleaseSource,
        runner: CommandRunner | None = None,
    ) -> None:
        self.settings = settings
        self.source = source
        self.runner = runner or SubprocessRunner()
        self._lock = threading.Lock()
        self._checking = False
        self._installing = False
        self._latest: str | None = None
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
            if (
                self._installing
                or not self.settings.update_install_enabled
                or self.settings.update_helper_path is None
                or self._latest is None
                or not newer_than(self._latest, __version__)
            ):
                return False
            version = self._latest
            self._installing = True
            self._last_error = None
            self._last_message = "Handing the verified release to the update helper."
        threading.Thread(
            target=self._install_worker,
            args=(version,),
            name=f"update-install-{version}",
            daemon=True,
        ).start()
        return True

    def status(self) -> dict[str, object]:
        with self._lock:
            latest = self._latest
            return {
                "installed_version": __version__,
                "latest_version": latest,
                "checking": self._checking,
                "installing": self._installing,
                "update_available": bool(latest and newer_than(latest, __version__)),
                "install_available": bool(
                    latest
                    and newer_than(latest, __version__)
                    and self.settings.update_install_enabled
                    and self.settings.update_helper_path
                ),
                "message": self._last_message,
                "last_error": self._last_error,
                "source": "Authenticated GitHub Releases via the local GitHub CLI",
            }

    def _delayed_check(self) -> None:
        if not self._stop.wait(max(0, self.settings.update_check_delay_seconds)):
            self.check()

    def _check_worker(self) -> None:
        try:
            latest = self.source.latest_version()
            with self._lock:
                self._latest = latest
                self._last_message = (
                    f"Version {latest} is available."
                    if latest and newer_than(latest, __version__)
                    else "This jukebox is up to date."
                )
        except Exception:
            with self._lock:
                self._last_error = (
                    "Updates could not be checked right now. Normal jukebox use is unaffected."
                )
        finally:
            with self._lock:
                self._checking = False

    def _install_worker(self, version: str) -> None:
        helper = self.settings.update_helper_path
        try:
            if helper is None or not helper.is_file():
                raise RuntimeError
            result = self.runner.run(
                [str(helper), "--version", version],
                timeout=None,
            )
            if result.returncode != 0:
                raise RuntimeError
            with self._lock:
                self._last_message = (
                    "The update helper accepted the release. The jukebox will restart when ready."
                )
        except Exception:
            with self._lock:
                self._last_error = (
                    "The update could not be prepared. The current version remains active."
                )
        finally:
            with self._lock:
                self._installing = False
