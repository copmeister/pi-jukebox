"""Application configuration loaded from environment variables or a local .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class LibraryConfigurationError(ValueError):
    """Raised when the configured music library cannot be scanned safely."""


class Settings(BaseSettings):
    """Runtime settings with safe, machine-independent defaults."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="PI_JUKEBOX_",
        extra="ignore",
    )

    app_name: str = "Pi Jukebox"
    environment: Literal["development", "test", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = 8000
    data_directory: Path = Path("data")
    music_library_path: Path | None = None
    frontend_origin: str = "http://127.0.0.1:5173"
    optical_drive_path: Path | None = None
    external_storage_path: Path | None = None
    rip_output_path: Path | None = None
    rip_staging_path: Path | None = None
    cd_minimum_free_bytes: int = 2_000_000_000
    cd_poll_interval_seconds: float = 3.0
    cd_process_nice: int | None = 10
    cd_discid_executable: str = "cd-discid"
    cd_eject_executable: str = "eject"
    cdparanoia_executable: str = "cdparanoia"
    flac_executable: str = "flac"
    musicbrainz_base_url: str = "https://musicbrainz.org/ws/2"
    cover_art_base_url: str = "https://coverartarchive.org"
    metadata_timeout_seconds: float = 8.0
    metadata_retry_count: int = 2
    update_repository: str = "copmeister/pi-jukebox"
    update_check_enabled: bool = True
    update_install_enabled: bool = False
    update_check_delay_seconds: float = 5.0
    update_timeout_seconds: float = 8.0
    update_helper_path: Path | None = None
    update_release_root: Path | None = None
    update_health_url: str = "http://127.0.0.1:8000/api/health"

    @property
    def database_path(self) -> Path:
        """Return the runtime SQLite path without creating it."""

        return self.data_directory / "catalogue.sqlite3"

    @property
    def artwork_directory(self) -> Path:
        """Return the runtime artwork-cache directory."""

        return self.data_directory / "artwork"

    @property
    def cd_artwork_directory(self) -> Path:
        """Return the runtime cache used for candidate cover art."""

        return self.data_directory / "cd-artwork"

    @property
    def rip_staging_directory(self) -> Path:
        """Return same-filesystem staging when external storage is configured."""

        if self.rip_staging_path is not None:
            return self.rip_staging_path
        if self.external_storage_path is not None:
            return self.external_storage_path / ".pi-jukebox-rip-staging"
        return self.data_directory / "rip-staging"

    def validated_library_root(self) -> Path:
        """Resolve and validate the configured music-library root."""

        if self.music_library_path is None:
            raise LibraryConfigurationError(
                "The music library is not configured. Set PI_JUKEBOX_MUSIC_LIBRARY_PATH."
            )

        try:
            root = self.music_library_path.expanduser().resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise LibraryConfigurationError(
                f"The configured music library is unavailable: {self.music_library_path}"
            ) from exc

        if not root.is_dir():
            raise LibraryConfigurationError(
                f"The configured music library is not a directory: {self.music_library_path}"
            )
        return root


@lru_cache
def get_settings() -> Settings:
    """Return one shared settings object for the process."""

    return Settings()
