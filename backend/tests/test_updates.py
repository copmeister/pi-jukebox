import hashlib
import io
import json
import shutil
import tarfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pi_jukebox.cd.hardware import CommandResult
from pi_jukebox.config import Settings
from pi_jukebox.main import create_app
from pi_jukebox.updates.helper import (
    GitHubReleaseDownloader,
    HelperConfig,
    HelperConfigurationError,
    ProcessResult,
    UpdateHelper,
)
from pi_jukebox.updates.installer import (
    ReleaseInstaller,
    ReleaseManifest,
    ReleaseValidationError,
    UpdateRolledBackError,
    newer_than,
    normalized_version,
)
from pi_jukebox.updates.service import GitHubCliReleaseSource, ReleaseInfo, UpdateService
from pi_jukebox.version import __version__


def release_info(version: str, *, assets: bool = True) -> ReleaseInfo:
    names = (
        frozenset(
            {
                f"pi-jukebox-v{version}.tar.gz",
                f"pi-jukebox-v{version}-manifest.json",
            }
        )
        if assets
        else frozenset()
    )
    return ReleaseInfo(version, f"v{version}", names)


class Source:
    def __init__(self, release=None, error=None):
        self.release = release
        self.error = error

    def latest_release(self):
        if self.error:
            raise self.error
        return self.release


def wait_until(predicate, timeout: float = 2) -> None:
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert predicate()


@pytest.mark.parametrize(
    ("candidate", "installed", "available"),
    [
        ("0.6.0", "0.6.0", False),
        ("v0.6.1", "0.6.0", True),
        ("0.10.0", "0.9.9", True),
        ("0.6.0-rc1", "0.6.0", False),
        ("main", "0.6.0", False),
    ],
)
def test_strict_semantic_version_comparison(candidate, installed, available) -> None:
    assert newer_than(candidate, installed) is available
    assert normalized_version(candidate) == (
        candidate.removeprefix("v") if available else None
    ) or (candidate == installed and normalized_version(candidate) == candidate)


def test_update_check_current_and_newer_release() -> None:
    current = UpdateService(Settings(_env_file=None), Source(release_info(__version__)))
    assert current.check()
    wait_until(lambda: not current.status()["checking"])
    assert current.status()["update_available"] is False

    newer = UpdateService(Settings(_env_file=None), Source(release_info("0.6.5")))
    assert newer.check()
    wait_until(lambda: not newer.status()["checking"])
    assert newer.status()["update_available"] is True


def test_update_check_offline_is_nonfatal() -> None:
    service = UpdateService(Settings(_env_file=None), Source(error=TimeoutError()))
    service.check()
    wait_until(lambda: not service.status()["checking"])
    status = service.status()
    assert status["last_error"]
    assert status["installed_version"] == __version__


def test_release_without_required_assets_is_visible_but_not_installable(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        update_install_enabled=True,
        update_request_path=(tmp_path / "request.json").resolve(),
        update_status_path=(tmp_path / "status.json").resolve(),
    )
    service = UpdateService(settings, Source(release_info("0.6.5", assets=False)))
    service.check()
    wait_until(lambda: not service.status()["checking"])
    assert service.status()["update_available"] is True
    assert service.status()["install_available"] is False
    assert not service.request_install()


def test_old_terminal_outcome_does_not_hide_a_later_release(tmp_path: Path) -> None:
    status_path = tmp_path / "status.json"
    status_path.write_text(
        json.dumps(
            {
                "format_version": 1,
                "state": "succeeded",
                "stage": "complete",
                "requested_version": "0.6.1",
                "previous_version": "0.6.0",
                "message": "Updated successfully to 0.6.1.",
                "error": None,
            }
        )
    )
    settings = Settings(_env_file=None, update_status_path=status_path)
    service = UpdateService(settings, Source(release_info("0.6.5")))
    service.check()
    wait_until(lambda: not service.status()["checking"])

    assert service.status()["outcome"] is None
    assert service.status()["latest_version"] == "0.6.5"
    assert service.status()["message"] == "Version 0.6.5 is available."


class GhRunner:
    def __init__(self, result):
        self.result = result
        self.arguments = None

    def run(self, arguments, *, timeout=None):
        self.arguments = arguments
        return self.result


def gh_release(version: str, *, draft=False, prerelease=False, assets=True) -> dict:
    return {
        "tag_name": f"v{version}",
        "draft": draft,
        "prerelease": prerelease,
        "assets": (
            [
                {"name": f"pi-jukebox-v{version}.tar.gz", "size": 5},
                {"name": f"pi-jukebox-v{version}-manifest.json", "size": 5},
            ]
            if assets
            else []
        ),
    }


def test_private_release_check_filters_drafts_and_prereleases_without_credentials() -> None:
    payload = [
        gh_release("9.0.0", draft=True),
        gh_release("8.0.0", prerelease=True),
        gh_release("0.6.1"),
        gh_release("0.4.9"),
    ]
    runner = GhRunner(CommandResult(0, json.dumps(payload), ""))
    source = GitHubCliReleaseSource(Settings(_env_file=None), runner)  # type: ignore[arg-type]
    release = source.latest_release()
    assert release == release_info("0.6.1")
    command = " ".join(runner.arguments)
    assert command == ("gh api --method GET repos/copmeister/pi-jukebox/releases -f per_page=30")
    assert "token" not in command.casefold()
    assert "main" not in command.casefold()


class RootGhExecutor:
    def __init__(self, release: dict) -> None:
        self.release = release
        self.calls: list[tuple[list[str], dict[str, str] | None]] = []

    def run(
        self,
        arguments,
        *,
        timeout,
        retries=0,
        environment=None,
    ) -> ProcessResult:
        self.calls.append((arguments, environment))
        if arguments[1] == "api":
            return ProcessResult(0, json.dumps(self.release))
        destination = Path(arguments[arguments.index("--dir") + 1])
        destination.mkdir(parents=True, exist_ok=True)
        asset = arguments[arguments.index("--pattern") + 1]
        (destination / asset).write_bytes(b"asset")
        return ProcessResult(0, "")


def test_root_downloader_uses_fixed_authenticated_cli_and_exact_assets(tmp_path: Path) -> None:
    config = helper_config(tmp_path)
    executor = RootGhExecutor(gh_release("0.6.1"))
    archive, manifest = GitHubReleaseDownloader(config, executor).download(  # type: ignore[arg-type]
        "0.6.1", tmp_path / "download"
    )

    assert archive.name == "pi-jukebox-v0.6.1.tar.gz"
    assert manifest.name == "pi-jukebox-v0.6.1-manifest.json"
    assert len(executor.calls) == 3
    assert all(Path(call[0][0]).as_posix() == "/usr/bin/gh" for call in executor.calls)
    assert {call[0][call[0].index("--pattern") + 1] for call in executor.calls[1:]} == {
        archive.name,
        manifest.name,
    }
    assert all(
        call[1] and call[1]["GH_CONFIG_DIR"] == "/home/admin/.config/gh" for call in executor.calls
    )
    assert all("token" not in " ".join(call[0]).casefold() for call in executor.calls)


def test_root_downloader_rejects_non_stable_release(tmp_path: Path) -> None:
    config = helper_config(tmp_path)
    executor = RootGhExecutor(gh_release("0.6.1", prerelease=True))
    with pytest.raises(ReleaseValidationError, match="not stable"):
        GitHubReleaseDownloader(config, executor).download(  # type: ignore[arg-type]
            "0.6.1", tmp_path / "download"
        )


def make_release(
    directory: Path,
    version: str = "0.6.1",
    *,
    extra_members: list[tarfile.TarInfo] | None = None,
) -> tuple[Path, Path]:
    contents = {
        f"app/pi_jukebox-{version}-py3-none-any.whl": b"app wheel",
        "requirements.lock": b"dependency==1 --hash=sha256:" + b"0" * 64,
        "wheelhouse/dependency-1-py3-none-any.whl": b"dependency wheel",
        "frontend/dist/index.html": b"<main>Pi Jukebox</main>",
        "frontend/dist/assets/app.js": b"console.log('jukebox')",
    }
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / f"pi-jukebox-v{version}.tar.gz"
    with tarfile.open(archive, "w:gz") as package:
        for name, content in contents.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            package.addfile(member, io.BytesIO(content))
        for member in extra_members or []:
            content = b"escape" if member.isreg() else None
            if content is not None:
                member.size = len(content)
            package.addfile(member, io.BytesIO(content) if content is not None else None)
    archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    manifest = directory / f"pi-jukebox-v{version}-manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "format_version": 1,
                "application_version": version,
                "archive": {"filename": archive.name, "sha256": archive_hash},
                "compatibility": {"architecture": "aarch64", "python": "3.11"},
                "files": {
                    name: hashlib.sha256(content).hexdigest() for name, content in contents.items()
                },
            }
        ),
        encoding="utf-8",
    )
    return archive, manifest


def active_root(tmp_path: Path, version: str = "0.6.0") -> Path:
    root = tmp_path / "releases-root"
    (root / "releases" / version).mkdir(parents=True)
    (root / "current-version").write_text(version + "\n", encoding="utf-8")
    return root


def test_manifest_archive_staging_activation_and_data_preservation(tmp_path: Path) -> None:
    archive, manifest = make_release(tmp_path / "package")
    root = active_root(tmp_path)
    data = tmp_path / "jukebox-data" / "catalogue.sqlite3"
    data.parent.mkdir()
    data.write_bytes(b"keep me")
    restarts: list[str] = []
    installer = ReleaseInstaller(
        root,
        prepare=lambda release, _manifest: (release / ".venv").mkdir(),
        restart=lambda: restarts.append("restart"),
        healthy=lambda version: version == "0.6.1",
    )
    result = installer.install(archive, manifest, "0.6.1")
    assert result.version == "0.6.1"
    assert (result.release_directory / "frontend" / "dist" / "index.html").is_file()
    assert (root / "current-version").read_text().strip() == "0.6.1"
    assert data.read_bytes() == b"keep me"
    assert restarts == ["restart"]


def test_failed_health_check_restores_current_version(tmp_path: Path) -> None:
    archive, manifest = make_release(tmp_path / "package")
    root = active_root(tmp_path)
    restarts: list[str] = []
    installer = ReleaseInstaller(
        root,
        prepare=lambda _release, _manifest: None,
        restart=lambda: restarts.append("restart"),
        healthy=lambda version: version == "0.6.0",
    )
    with pytest.raises(UpdateRolledBackError) as failure:
        installer.install(archive, manifest, "0.6.1")
    assert failure.value.previous_version == "0.6.0"
    assert (root / "current-version").read_text().strip() == "0.6.0"
    assert restarts == ["restart", "restart"]
    assert list((root / "failed").glob("0.6.1-*"))


def test_failed_pointer_activation_removes_unactivated_release(tmp_path: Path) -> None:
    archive, manifest = make_release(tmp_path / "package")
    root = active_root(tmp_path)
    installer = ReleaseInstaller(
        root,
        prepare=lambda _release, _manifest: None,
        restart=lambda: None,
        healthy=lambda _version: True,
    )

    def fail_activation(_version: str) -> None:
        raise OSError("simulated pointer write failure")

    installer.pointer.activate = fail_activation  # type: ignore[method-assign]
    with pytest.raises(OSError, match="pointer write failure"):
        installer.install(archive, manifest, "0.6.1")
    assert (root / "current-version").read_text().strip() == "0.6.0"
    assert not (root / "releases" / "0.6.1").exists()


def test_checksum_mismatch_and_malformed_manifest_leave_current_untouched(tmp_path: Path) -> None:
    archive, manifest = make_release(tmp_path / "package")
    root = active_root(tmp_path)
    payload = json.loads(manifest.read_text())
    payload["archive"]["sha256"] = "f" * 64
    manifest.write_text(json.dumps(payload))
    installer = ReleaseInstaller(
        root,
        prepare=lambda _release, _manifest: None,
        restart=lambda: None,
        healthy=lambda _version: True,
    )
    with pytest.raises(ReleaseValidationError):
        installer.install(archive, manifest, "0.6.1")
    assert (root / "current-version").read_text().strip() == "0.6.0"
    assert not (root / "releases" / "0.6.1").exists()

    manifest.write_text("not json")
    with pytest.raises(ReleaseValidationError):
        ReleaseManifest.load(manifest, "0.6.1")


@pytest.mark.parametrize("kind", ["traversal", "symlink"])
def test_archive_rejects_traversal_and_links(tmp_path: Path, kind: str) -> None:
    member = tarfile.TarInfo("../escape" if kind == "traversal" else "frontend/dist/link")
    if kind == "symlink":
        member.type = tarfile.SYMTYPE
        member.linkname = "/etc/passwd"
    archive, manifest = make_release(tmp_path / "package", extra_members=[member])
    loaded = ReleaseManifest.load(manifest, "0.6.1")
    destination = tmp_path / "staging"
    destination.mkdir()
    with pytest.raises(ReleaseValidationError):
        loaded.extract(archive, destination)
    assert not (tmp_path / "escape").exists()


def test_install_request_is_narrow_and_concurrent_requests_are_rejected(tmp_path: Path) -> None:
    state = tmp_path / "state"
    settings = Settings(
        _env_file=None,
        update_install_enabled=True,
        update_request_path=state / "request.json",
        update_status_path=state / "status.json",
    )
    service = UpdateService(settings, Source(release_info("0.6.5")))
    service.check()
    wait_until(lambda: not service.status()["checking"])
    assert service.request_install()
    wait_until(lambda: (state / "request.json").exists())
    assert not service.request_install()
    assert service.status()["installing"] is True
    assert service.status()["stage"] == "queued"
    request = json.loads((state / "request.json").read_text())
    assert set(request) == {"format_version", "version", "installed_version", "requested_at"}
    assert request["version"] == "0.6.5"
    assert all("token" not in str(value).casefold() for value in request.values())


def test_install_api_rejects_cross_origin_style_simple_post(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        data_directory=tmp_path / "data",
        update_check_enabled=False,
    )
    with TestClient(create_app(settings)) as client:
        rejected = client.post("/api/system/updates/install")
        permitted_request = client.post(
            "/api/system/updates/install",
            headers={"X-Pi-Jukebox-Action": "install-stable-release"},
        )

    assert rejected.status_code == 403
    assert permitted_request.status_code == 409


class FakeDownloader:
    def __init__(self, archive: Path, manifest: Path) -> None:
        self.archive = archive
        self.manifest = manifest

    def download(self, _version: str, destination: Path) -> tuple[Path, Path]:
        destination.mkdir(parents=True)
        archive = destination / self.archive.name
        manifest = destination / self.manifest.name
        shutil.copyfile(self.archive, archive)
        shutil.copyfile(self.manifest, manifest)
        return archive, manifest


class FakeController:
    def __init__(self, healthy_versions: set[str]) -> None:
        self.healthy_versions = healthy_versions
        self.restarts = 0

    def restart(self) -> None:
        self.restarts += 1

    def healthy(self, version: str) -> bool:
        return version in self.healthy_versions


def helper_config(tmp_path: Path) -> HelperConfig:
    return HelperConfig(
        repository="copmeister/pi-jukebox",
        release_root=active_root(tmp_path, "0.6.4"),
        request_path=tmp_path / "request" / "request.json",
        status_path=tmp_path / "status" / "status.json",
        lock_path=tmp_path / "lock" / "installer.lock",
        gh_user="admin",
        command_timeout_seconds=30,
        download_timeout_seconds=60,
        retry_count=0,
        health_attempts=2,
        health_interval_seconds=0.25,
    )


def test_root_helper_config_rejects_arbitrary_install_destinations(tmp_path: Path) -> None:
    config = {
        "format_version": 1,
        "repository": "copmeister/pi-jukebox",
        "release_root": str(tmp_path / "attacker-selected"),
        "request_path": "/home/admin/jukebox-data/updater/request.json",
        "status_path": "/var/lib/pi-jukebox-updater/status.json",
        "lock_path": "/run/lock/pi-jukebox-updater.lock",
        "gh_user": "admin",
        "command_timeout_seconds": 120,
        "download_timeout_seconds": 600,
        "retry_count": 2,
        "health_attempts": 15,
        "health_interval_seconds": 2,
    }
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    with pytest.raises(HelperConfigurationError):
        HelperConfig.load(path)


def write_request(config: HelperConfig, version="0.6.5") -> None:
    config.request_path.parent.mkdir(parents=True, exist_ok=True)
    config.request_path.write_text(
        json.dumps(
            {
                "format_version": 1,
                "version": version,
                "installed_version": "0.6.4",
                "requested_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )


def test_helper_persists_success_and_rollback_outcomes(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("pi_jukebox.updates.helper.platform.machine", lambda: "aarch64")
    monkeypatch.setattr("pi_jukebox.updates.helper.__version__", __version__)
    archive, manifest = make_release(tmp_path / "package", version="0.6.5")

    success_config = helper_config(tmp_path / "success")
    write_request(success_config)
    success_controller = FakeController({"0.6.5"})
    success = UpdateHelper(
        success_config,
        downloader_factory=lambda _config, _executor: FakeDownloader(archive, manifest),
        preparer_factory=lambda _config, _executor: (
            lambda release, _manifest: (release / ".venv").mkdir()
        ),
        controller_factory=lambda _config, _executor: success_controller,
    )
    assert success.run()
    success_status = json.loads(success_config.status_path.read_text())
    assert success_status["state"] == "succeeded"
    assert success_status["stage"] == "complete"
    assert not success_config.request_path.exists()

    rollback_config = helper_config(tmp_path / "rollback")
    write_request(rollback_config)
    rollback_controller = FakeController({"0.6.4"})
    rollback = UpdateHelper(
        rollback_config,
        downloader_factory=lambda _config, _executor: FakeDownloader(archive, manifest),
        preparer_factory=lambda _config, _executor: (
            lambda release, _manifest: (release / ".venv").mkdir()
        ),
        controller_factory=lambda _config, _executor: rollback_controller,
    )
    assert not rollback.run()
    rollback_status = json.loads(rollback_config.status_path.read_text())
    assert rollback_status["state"] == "rolled_back"
    assert "restored to 0.6.4" in rollback_status["message"]
    assert (rollback_config.release_root / "current-version").read_text().strip() == "0.6.4"
