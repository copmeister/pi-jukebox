import hashlib
import json
import time
import zipfile
from pathlib import Path

import pytest
from pi_jukebox.cd.hardware import CommandResult
from pi_jukebox.config import Settings
from pi_jukebox.updates.installer import ReleaseInstaller, ReleaseValidationError
from pi_jukebox.updates.service import (
    GitHubCliReleaseSource,
    UpdateService,
    newer_than,
)


class Source:
    def __init__(self, version=None, error=None):
        self.version = version
        self.error = error

    def latest_version(self):
        if self.error:
            raise self.error
        return self.version


def wait_check(service: UpdateService) -> None:
    deadline = time.monotonic() + 2
    while service.status()["checking"] and time.monotonic() < deadline:
        time.sleep(0.01)


@pytest.mark.parametrize(
    ("latest", "available"), [("0.5.0", False), ("0.5.1", True), ("bad", False)]
)
def test_update_check_current_available_and_malformed(latest, available) -> None:
    service = UpdateService(Settings(_env_file=None), Source(latest))
    assert service.check()
    wait_check(service)
    assert service.status()["update_available"] is available


def test_update_check_offline_is_nonfatal() -> None:
    service = UpdateService(Settings(_env_file=None), Source(error=TimeoutError()))
    service.check()
    wait_check(service)
    status = service.status()
    assert status["last_error"]
    assert status["installed_version"] == "0.5.0"


class GhRunner:
    def __init__(self, result):
        self.result = result
        self.arguments = None

    def run(self, arguments, *, timeout=None):
        self.arguments = arguments
        return self.result


def test_private_release_check_uses_fixed_gh_api_and_exposes_no_credentials() -> None:
    runner = GhRunner(CommandResult(0, json.dumps({"tag_name": "v0.5.2"}), ""))
    source = GitHubCliReleaseSource(Settings(_env_file=None), runner)  # type: ignore[arg-type]
    assert source.latest_version() == "0.5.2"
    command = " ".join(runner.arguments)
    assert command == "gh api --method GET repos/copmeister/pi-jukebox/releases/latest"
    assert "token" not in command.casefold()


def make_release(path: Path, version="0.5.1", content=b"release") -> None:
    digest = hashlib.sha256(content).hexdigest()
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("app/readme.txt", content)
        package.writestr(
            "manifest.json",
            json.dumps({"version": version, "files": {"app/readme.txt": digest}}),
        )


def test_release_staging_validation_activation_and_health_rollback(tmp_path: Path) -> None:
    archive = tmp_path / "release.zip"
    make_release(archive)
    root = tmp_path / "install"
    (root / "releases" / "0.5.0").mkdir(parents=True)
    (root / "current-version").write_text("0.5.0\n")
    restarts = []
    installer = ReleaseInstaller(
        root,
        prepare=lambda release: (release / "prepared").write_text("yes"),
        restart=lambda: restarts.append("restart"),
        healthy=lambda: True,
    )
    final = installer.install(archive, "0.5.1")
    assert (final / "app" / "readme.txt").read_bytes() == b"release"
    assert (root / "current-version").read_text().strip() == "0.5.1"

    second = tmp_path / "release-2.zip"
    make_release(second, "0.5.2")
    failing = ReleaseInstaller(
        root,
        prepare=lambda _path: None,
        restart=lambda: restarts.append("restart"),
        healthy=lambda: False,
    )
    with pytest.raises(RuntimeError):
        failing.install(second, "0.5.2")
    assert (root / "current-version").read_text().strip() == "0.5.1"
    assert len(restarts) == 3


def test_release_rejects_bad_checksum_and_traversal(tmp_path: Path) -> None:
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as package:
        package.writestr("../escape", b"bad")
        package.writestr(
            "manifest.json",
            json.dumps({"version": "0.5.1", "files": {"../escape": "wrong"}}),
        )
    installer = ReleaseInstaller(
        tmp_path / "root", prepare=lambda _path: None, restart=lambda: None, healthy=lambda: True
    )
    with pytest.raises(ReleaseValidationError):
        installer.install(bad, "0.5.1")
    assert not (tmp_path / "escape").exists()
    assert newer_than("0.5.1", "0.5.0")
