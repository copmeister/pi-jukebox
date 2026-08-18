"""Typed CD-domain values independent from HTTP and hardware implementations."""

from dataclasses import asdict, dataclass
from typing import Any, Literal

TrackState = Literal["waiting", "reading", "encoding", "tagging", "ready", "error", "cancelled"]
JobState = Literal[
    "queued", "ripping", "completed", "partial", "cancelled", "failed", "interrupted"
]


@dataclass(frozen=True, slots=True)
class DiscLayout:
    disc_id: str
    track_count: int
    track_durations: tuple[float | None, ...]


@dataclass(frozen=True, slots=True)
class ReleaseTrack:
    number: int
    title: str
    artist: str
    duration_seconds: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ReleaseCandidate:
    release_id: str
    title: str
    artist: str
    year: str | None
    country: str | None
    edition: str | None
    track_count: int
    tracks: tuple[ReleaseTrack, ...]
    artwork_available: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "tracks": [track.to_dict() for track in self.tracks]}


@dataclass(frozen=True, slots=True)
class DriveState:
    configured: bool
    available: bool
    disc_present: bool
    message: str
    disc: DiscLayout | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
