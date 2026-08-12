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

    @property
    def database_path(self) -> Path:
        """Return the runtime SQLite path without creating it."""

        return self.data_directory / "catalogue.sqlite3"

    @property
    def artwork_directory(self) -> Path:
        """Return the runtime artwork-cache directory."""

        return self.data_directory / "artwork"

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
