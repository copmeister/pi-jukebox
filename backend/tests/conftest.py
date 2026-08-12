from collections.abc import Mapping
from pathlib import Path

from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.catalogue.models import TrackMetadata
from pi_jukebox.config import Settings
from pi_jukebox.library.scanner import LibraryScanner


class FakeMetadataReader:
    def __init__(self, metadata_by_name: Mapping[str, TrackMetadata]) -> None:
        self.metadata_by_name = dict(metadata_by_name)
        self.calls: list[str] = []

    def read(self, path: Path) -> TrackMetadata:
        self.calls.append(path.name)
        return self.metadata_by_name[path.name]


def make_settings(tmp_path: Path, library_path: Path | None) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        data_directory=tmp_path / "runtime-data",
        music_library_path=library_path,
    )


def make_scanner(
    tmp_path: Path,
    library_path: Path | None,
    metadata_by_name: Mapping[str, TrackMetadata] | None = None,
) -> tuple[LibraryScanner, Catalogue, FakeMetadataReader | None]:
    settings = make_settings(tmp_path, library_path)
    catalogue = Catalogue(settings.database_path)
    catalogue.initialize()
    reader = FakeMetadataReader(metadata_by_name) if metadata_by_name is not None else None
    scanner = LibraryScanner(settings, catalogue, metadata_reader=reader)
    return scanner, catalogue, reader


def touch_audio(library: Path, name: str, content: bytes = b"synthetic audio") -> Path:
    path = library / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def metadata(
    *,
    title: str,
    artist: str = "Track Artist",
    album_artist: str = "Album Artist",
    album: str = "Test Album",
    disc: int | None = 1,
    track: int | None = 1,
    duration: float | None = 123.0,
) -> TrackMetadata:
    return TrackMetadata(
        title=title,
        artist=artist,
        album_artist=album_artist,
        album=album,
        disc_number=disc,
        track_number=track,
        duration_seconds=duration,
    )
