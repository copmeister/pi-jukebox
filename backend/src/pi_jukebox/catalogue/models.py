"""Domain records shared by the scanner and catalogue."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ArtworkData:
    """Embedded artwork extracted from a source audio file."""

    content: bytes
    mime_type: str


@dataclass(frozen=True, slots=True)
class TrackMetadata:
    """Normalized metadata for one source audio file."""

    title: str
    artist: str
    album_artist: str
    album: str
    disc_number: int | None
    track_number: int | None
    duration_seconds: float | None
    artwork: ArtworkData | None = None


@dataclass(frozen=True, slots=True)
class ScannedTrack:
    """File identity and metadata ready to persist."""

    relative_path: str
    filename: str
    file_size: int
    modified_time_ns: int
    file_format: str
    playback_support: str
    metadata: TrackMetadata
    artwork_id: int | None = None


@dataclass(frozen=True, slots=True)
class FileState:
    """Stored fields used to detect unchanged files."""

    id: int
    file_size: int
    modified_time_ns: int
