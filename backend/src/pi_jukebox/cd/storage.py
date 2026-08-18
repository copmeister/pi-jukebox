"""External-storage confinement, mount, capacity, and conflict safeguards."""

import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pi_jukebox.config import LibraryConfigurationError, Settings


class StorageSafetyError(RuntimeError):
    """Raised when ripping could write to unsafe or insufficient storage."""


@dataclass(frozen=True, slots=True)
class StorageStatus:
    configured: bool
    available: bool
    mounted: bool
    writable: bool
    free_bytes: int | None
    message: str

    def to_dict(self) -> dict[str, object]:
        return {
            "configured": self.configured,
            "available": self.available,
            "mounted": self.mounted,
            "writable": self.writable,
            "free_bytes": self.free_bytes,
            "message": self.message,
        }


class StorageGuard:
    def __init__(
        self,
        settings: Settings,
        *,
        mounted: Callable[[Path], bool] | None = None,
        free_bytes: Callable[[Path], int] | None = None,
        writable: Callable[[Path], bool] | None = None,
    ) -> None:
        self.settings = settings
        self._mounted = mounted or self._is_mounted
        self._free_bytes = free_bytes or (lambda path: shutil.disk_usage(path).free)
        self._writable = writable or (lambda path: os.access(path, os.W_OK))

    def status(self) -> StorageStatus:
        mount = self.settings.external_storage_path
        output = self.settings.rip_output_path
        if mount is None or output is None:
            return StorageStatus(False, False, False, False, None, "CD storage is not configured.")
        try:
            mount_root = mount.expanduser().resolve(strict=True)
            output_root = output.expanduser().resolve(strict=True)
            library_root = self.settings.validated_library_root()
        except (OSError, RuntimeError, LibraryConfigurationError):
            return StorageStatus(
                True, False, False, False, None, "External jukebox storage is unavailable."
            )
        if not mount_root.is_dir() or not output_root.is_dir():
            return StorageStatus(
                True, False, False, False, None, "External jukebox storage is unavailable."
            )
        if not output_root.is_relative_to(mount_root) or not output_root.is_relative_to(
            library_root
        ):
            return StorageStatus(
                True,
                False,
                False,
                False,
                None,
                "The rip folder is outside the approved music storage.",
            )
        mounted = self._mounted(mount_root)
        if not mounted:
            return StorageStatus(
                True,
                False,
                False,
                False,
                None,
                "The external drive is not mounted. Ripping is disabled.",
            )
        writable = self._writable(output_root)
        free = self._free_bytes(output_root)
        if not writable:
            return StorageStatus(True, False, True, False, free, "The external drive is read-only.")
        if free < self.settings.cd_minimum_free_bytes:
            return StorageStatus(
                True,
                False,
                True,
                True,
                free,
                "There is not enough free space for a safe CD rip.",
            )
        return StorageStatus(True, True, True, True, free, "External storage is ready.")

    def require_safe_output(self) -> Path:
        status = self.status()
        if not status.available:
            raise StorageSafetyError(status.message)
        return self.settings.rip_output_path.expanduser().resolve(strict=True)  # type: ignore[union-attr]

    def require_safe_staging(self) -> Path:
        """Return staging on the approved mount but outside the scanned library."""

        self.require_safe_output()
        mount = self.settings.external_storage_path
        if mount is None:
            raise StorageSafetyError("External jukebox storage is unavailable.")
        mount_root = mount.expanduser().resolve(strict=True)
        library_root = self.settings.validated_library_root()
        staging = self.settings.rip_staging_directory.expanduser().resolve(strict=False)
        if not staging.is_relative_to(mount_root) or staging.is_relative_to(library_root):
            raise StorageSafetyError(
                "The rip staging folder is outside the approved external storage."
            )
        staging.mkdir(parents=True, exist_ok=True)
        return staging.resolve(strict=True)

    @staticmethod
    def _is_mounted(path: Path) -> bool:
        if os.name == "nt":
            return path.drive != "" and path.anchor == str(path)
        return os.path.ismount(path)
