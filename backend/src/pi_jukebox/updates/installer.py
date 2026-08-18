"""Offline-testable release validation, activation, health check, and rollback."""

import hashlib
import json
import os
import shutil
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath

from pi_jukebox.updates.service import normalized_version


class ReleaseValidationError(RuntimeError):
    pass


class ReleaseInstaller:
    """Prepare immutable release directories and atomically switch a version pointer."""

    def __init__(
        self,
        release_root: Path,
        *,
        prepare: Callable[[Path], None],
        restart: Callable[[], None],
        healthy: Callable[[], bool],
    ) -> None:
        self.release_root = release_root
        self.prepare = prepare
        self.restart = restart
        self.healthy = healthy

    def install(self, archive: Path, expected_version: str) -> Path:
        version = normalized_version(expected_version)
        if version is None:
            raise ReleaseValidationError("The requested release version is invalid.")
        releases = self.release_root / "releases"
        releases.mkdir(parents=True, exist_ok=True)
        staging = releases / f".{version}.staging"
        final = releases / version
        if staging.exists() or final.exists():
            raise ReleaseValidationError("That release has already been staged.")
        staging.mkdir()
        try:
            self._extract_verified(archive, staging, version)
            self.prepare(staging)
            staging.replace(final)
            self._activate_with_rollback(version)
            return final
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def _activate_with_rollback(self, version: str) -> None:
        pointer = self.release_root / "current-version"
        previous = pointer.read_text(encoding="utf-8").strip() if pointer.exists() else None
        temporary = pointer.with_suffix(".new")
        temporary.write_text(version + "\n", encoding="utf-8")
        os.replace(temporary, pointer)
        try:
            self.restart()
            if not self.healthy():
                raise RuntimeError("The new release failed its health check.")
        except Exception:
            if previous:
                temporary.write_text(previous + "\n", encoding="utf-8")
                os.replace(temporary, pointer)
                self.restart()
            else:
                pointer.unlink(missing_ok=True)
            raise

    @staticmethod
    def _extract_verified(archive: Path, destination: Path, expected_version: str) -> None:
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            if "manifest.json" not in names:
                raise ReleaseValidationError("The release manifest is missing.")
            try:
                manifest = json.loads(package.read("manifest.json"))
                files = manifest["files"]
            except (KeyError, TypeError, json.JSONDecodeError) as exc:
                raise ReleaseValidationError("The release manifest is invalid.") from exc
            if normalized_version(str(manifest.get("version", ""))) != expected_version:
                raise ReleaseValidationError("The release version does not match its manifest.")
            if not isinstance(files, dict) or not files:
                raise ReleaseValidationError("The release manifest contains no files.")
            for name, expected_hash in files.items():
                pure = PurePosixPath(str(name))
                if pure.is_absolute() or ".." in pure.parts or str(name) not in names:
                    raise ReleaseValidationError("The release contains an unsafe path.")
                content = package.read(str(name))
                if hashlib.sha256(content).hexdigest() != expected_hash:
                    raise ReleaseValidationError("A release checksum did not match.")
                target = destination.joinpath(*pure.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
