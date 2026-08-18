"""Validated release packages, immutable staging, activation, and rollback."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tarfile
import uuid
from collections.abc import Callable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

VERSION_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MANIFEST_FORMAT_VERSION = 1
MAX_RELEASE_FILES = 20_000
MAX_RELEASE_FILE_BYTES = 512 * 1024 * 1024
MAX_RELEASE_TOTAL_BYTES = 2 * 1024 * 1024 * 1024


class ReleaseValidationError(RuntimeError):
    """A release package failed validation before activation."""


class UpdateRolledBackError(RuntimeError):
    """The new release failed health checking and the previous release recovered."""

    def __init__(self, previous_version: str, reason: str) -> None:
        self.previous_version = previous_version
        super().__init__(reason)


class RollbackFailedError(RuntimeError):
    """Neither the requested release nor the rollback became healthy."""


def normalized_version(value: str) -> str | None:
    """Return a strict stable semantic version without a leading ``v``."""

    match = VERSION_PATTERN.fullmatch(value.strip())
    return ".".join(match.groups()) if match else None


def newer_than(candidate: str, installed: str) -> bool:
    """Compare two supported stable semantic versions."""

    candidate_value = normalized_version(candidate)
    installed_value = normalized_version(installed)
    if candidate_value is None or installed_value is None:
        return False
    return tuple(map(int, candidate_value.split("."))) > tuple(map(int, installed_value.split(".")))


def release_archive_name(version: str) -> str:
    normalized = normalized_version(version)
    if normalized is None:
        raise ReleaseValidationError("The requested release version is invalid.")
    return f"pi-jukebox-v{normalized}.tar.gz"


def release_manifest_name(version: str) -> str:
    normalized = normalized_version(version)
    if normalized is None:
        raise ReleaseValidationError("The requested release version is invalid.")
    return f"pi-jukebox-v{normalized}-manifest.json"


def _safe_relative_path(value: object) -> PurePosixPath:
    text = str(value)
    path = PurePosixPath(text)
    if (
        not text
        or "\\" in text
        or path.is_absolute()
        or ".." in path.parts
        or "." in path.parts
        or any(not part for part in path.parts)
    ):
        raise ReleaseValidationError("The release manifest contains an unsafe path.")
    return path


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_directory(path: Path) -> None:
    """Make a completed rename durable on POSIX filesystems."""

    if os.name == "nt":
        return
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        with suppress(OSError):
            os.fsync(descriptor)
    finally:
        os.close(descriptor)


@dataclass(frozen=True, slots=True)
class ReleaseManifest:
    """Strict external manifest for one immutable Pi Jukebox release asset."""

    application_version: str
    archive_filename: str
    archive_sha256: str
    files: Mapping[str, str]
    architecture: str
    python_version: str
    format_version: int = MANIFEST_FORMAT_VERSION

    @classmethod
    def load(cls, path: Path, expected_version: str) -> ReleaseManifest:
        try:
            raw: Any = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ReleaseValidationError("The release manifest is malformed.") from exc
        if not isinstance(raw, dict):
            raise ReleaseValidationError("The release manifest is malformed.")

        allowed = {
            "format_version",
            "application_version",
            "archive",
            "compatibility",
            "files",
        }
        if set(raw) != allowed or raw.get("format_version") != MANIFEST_FORMAT_VERSION:
            raise ReleaseValidationError("The release manifest format is unsupported.")

        version = normalized_version(str(raw.get("application_version", "")))
        expected = normalized_version(expected_version)
        archive = raw.get("archive")
        compatibility = raw.get("compatibility")
        files = raw.get("files")
        if (
            version is None
            or expected is None
            or version != expected
            or not isinstance(archive, dict)
            or set(archive) != {"filename", "sha256"}
            or not isinstance(compatibility, dict)
            or set(compatibility) != {"architecture", "python"}
            or not isinstance(files, dict)
            or not files
            or len(files) > MAX_RELEASE_FILES
        ):
            raise ReleaseValidationError("The release manifest is invalid.")

        filename = archive.get("filename")
        archive_hash = archive.get("sha256")
        architecture = compatibility.get("architecture")
        python_version = compatibility.get("python")
        if (
            filename != release_archive_name(version)
            or not isinstance(archive_hash, str)
            or not SHA256_PATTERN.fullmatch(archive_hash)
            or not isinstance(architecture, str)
            or architecture not in {"aarch64", "arm64"}
            or not isinstance(python_version, str)
            or not re.fullmatch(r"3\.\d+", python_version)
        ):
            raise ReleaseValidationError("The release manifest is invalid.")

        checked_files: dict[str, str] = {}
        for name, digest in files.items():
            safe = _safe_relative_path(name)
            if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
                raise ReleaseValidationError("The release manifest contains an invalid checksum.")
            checked_files[safe.as_posix()] = digest
        if len(checked_files) != len(files):
            raise ReleaseValidationError("The release manifest contains duplicate paths.")

        required = {"requirements.lock", "frontend/dist/index.html"}
        if not required.issubset(checked_files):
            raise ReleaseValidationError(
                "The release package is missing required application files."
            )
        if not any(name.startswith("app/") and name.endswith(".whl") for name in checked_files):
            raise ReleaseValidationError("The release package is missing its application wheel.")
        if not any(
            name.startswith("wheelhouse/") and name.endswith(".whl") for name in checked_files
        ):
            raise ReleaseValidationError(
                "The release package is missing its dependency wheelhouse."
            )

        return cls(
            application_version=version,
            archive_filename=filename,
            archive_sha256=archive_hash,
            files=checked_files,
            architecture=architecture,
            python_version=python_version,
        )

    def verify_archive(self, archive: Path) -> None:
        if archive.name != self.archive_filename or not archive.is_file():
            raise ReleaseValidationError("The expected release archive is missing.")
        if _sha256_file(archive) != self.archive_sha256:
            raise ReleaseValidationError("The release archive checksum did not match.")

    def extract(self, archive: Path, destination: Path) -> None:
        """Extract only manifest-listed regular files without following archive links."""

        self.verify_archive(archive)
        destination_root = destination.resolve(strict=True)
        seen: set[str] = set()
        total_size = 0
        try:
            package = tarfile.open(archive, mode="r:gz")  # noqa: SIM115
        except (OSError, tarfile.TarError) as exc:
            raise ReleaseValidationError("The release archive could not be read.") from exc

        with package:
            members = package.getmembers()
            if len(members) > MAX_RELEASE_FILES * 2:
                raise ReleaseValidationError("The release archive contains too many entries.")
            for member in members:
                safe = _safe_relative_path(member.name)
                name = safe.as_posix()
                if member.isdir():
                    continue
                if not member.isreg() or member.issym() or member.islnk():
                    raise ReleaseValidationError("The release archive contains an unsafe entry.")
                if name in seen or name not in self.files:
                    raise ReleaseValidationError("The release archive contains an unexpected file.")
                if member.size < 0 or member.size > MAX_RELEASE_FILE_BYTES:
                    raise ReleaseValidationError("A release file exceeds the allowed size.")
                total_size += member.size
                if total_size > MAX_RELEASE_TOTAL_BYTES:
                    raise ReleaseValidationError("The release archive exceeds the allowed size.")
                seen.add(name)

            if seen != set(self.files):
                raise ReleaseValidationError("The release archive does not match its manifest.")

            for member in members:
                if not member.isreg():
                    continue
                safe = _safe_relative_path(member.name)
                target = destination.joinpath(*safe.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.parent.resolve(strict=True).is_relative_to(destination_root):
                    raise ReleaseValidationError(
                        "The release target escaped its staging directory."
                    )
                source = package.extractfile(member)
                if source is None:
                    raise ReleaseValidationError("A release file could not be read.")
                digest = hashlib.sha256()
                try:
                    with target.open("xb") as output:
                        while chunk := source.read(1024 * 1024):
                            digest.update(chunk)
                            output.write(chunk)
                except OSError as exc:
                    raise ReleaseValidationError("A release file could not be staged.") from exc
                finally:
                    source.close()
                if digest.hexdigest() != self.files[safe.as_posix()]:
                    raise ReleaseValidationError("A staged release file checksum did not match.")


class AtomicVersionPointer:
    """Root-owned text pointer consumed by the fixed application launcher."""

    def __init__(self, release_root: Path) -> None:
        self.release_root = release_root
        self.releases = release_root / "releases"
        self.path = release_root / "current-version"

    def current(self) -> str | None:
        if not self.path.exists():
            return None
        try:
            version = normalized_version(self.path.read_text(encoding="utf-8").strip())
        except OSError as exc:
            raise ReleaseValidationError("The active-version pointer is unreadable.") from exc
        if version is None:
            raise ReleaseValidationError("The active-version pointer is invalid.")
        return version

    def activate(self, version: str) -> None:
        normalized = normalized_version(version)
        if normalized is None or not (self.releases / normalized).is_dir():
            raise ReleaseValidationError("The requested release directory is unavailable.")
        temporary = self.release_root / f".current-version.{uuid.uuid4().hex}"
        try:
            with temporary.open("x", encoding="utf-8") as output:
                output.write(normalized + "\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
            _fsync_directory(self.release_root)
        finally:
            temporary.unlink(missing_ok=True)


@dataclass(frozen=True, slots=True)
class InstallResult:
    version: str
    previous_version: str
    release_directory: Path


class ReleaseInstaller:
    """Prepare an immutable version and atomically activate it with rollback."""

    def __init__(
        self,
        release_root: Path,
        *,
        prepare: Callable[[Path, ReleaseManifest], None],
        restart: Callable[[], None],
        healthy: Callable[[str], bool],
        progress: Callable[[str, str], None] | None = None,
    ) -> None:
        self.release_root = release_root
        self.prepare = prepare
        self.restart = restart
        self.healthy = healthy
        self.progress = progress or (lambda _stage, _message: None)
        self.pointer = AtomicVersionPointer(release_root)

    def install(
        self,
        archive: Path,
        manifest_path: Path,
        expected_version: str,
    ) -> InstallResult:
        version = normalized_version(expected_version)
        if version is None:
            raise ReleaseValidationError("The requested release version is invalid.")
        previous = self.pointer.current()
        if previous is None:
            raise ReleaseValidationError("No known-good release is active.")
        if not newer_than(version, previous):
            raise ReleaseValidationError(
                "The requested release is not newer than the active version."
            )

        releases = self.release_root / "releases"
        releases.mkdir(parents=True, exist_ok=True)
        final = releases / version
        staging = releases / f".{version}.staging-{uuid.uuid4().hex}"
        if final.exists():
            raise ReleaseValidationError("That release version already exists.")
        staging.mkdir(mode=0o755)
        activated = False
        finalized = False
        try:
            self.progress("verifying", "Verifying the release integrity manifest.")
            manifest = ReleaseManifest.load(manifest_path, version)
            manifest.extract(archive, staging)
            self.progress("preparing", "Preparing isolated application dependencies.")
            self.prepare(staging, manifest)
            self.progress("installing", "Installing the validated immutable release.")
            os.replace(staging, final)
            _fsync_directory(releases)
            finalized = True
            self.pointer.activate(version)
            activated = True
            self.progress("restarting", "Restarting Pi Jukebox on the new release.")
            self.restart()
            if not self.healthy(version):
                raise RuntimeError("The new release failed its health check.")
            return InstallResult(version, previous, final)
        except Exception as exc:
            if not activated:
                shutil.rmtree(staging, ignore_errors=True)
                if finalized:
                    shutil.rmtree(final, ignore_errors=True)
                raise
            self.progress("rolling_back", "Restoring the previous known-good release.")
            try:
                self.pointer.activate(previous)
                self.restart()
                if not self.healthy(previous):
                    raise RollbackFailedError(
                        "The previous release did not recover after rollback."
                    )
            except RollbackFailedError:
                raise
            except Exception as rollback_exc:
                raise RollbackFailedError(
                    "The previous release could not be restored after the update failed."
                ) from rollback_exc
            failed_root = self.release_root / "failed"
            failed_root.mkdir(exist_ok=True)
            failed = failed_root / f"{version}-{uuid.uuid4().hex[:8]}"
            with suppress(OSError):
                os.replace(final, failed)
            raise UpdateRolledBackError(previous, str(exc)) from exc
