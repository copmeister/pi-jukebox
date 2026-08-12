"""Application configuration loaded from environment variables or a local .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


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


@lru_cache
def get_settings() -> Settings:
    """Return one shared settings object for the process."""

    return Settings()
