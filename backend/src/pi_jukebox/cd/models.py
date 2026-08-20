"""Typed CD-domain values independent from HTTP and hardware implementations."""

from dataclasses import asdict, dataclass
from typing import Any, Literal

TrackState = Literal["waiting", "reading", "encoding", "tagging", "ready", "error", "cancelled"]
JobState = Literal[
    "queued", "ripping", "completed", "partial", "cancelled", "failed", "interrupted"
]


@dataclass(frozen=True, slots=True)
class DiscLayout:
    # The short FreeDB/CDDB identifier remains useful as a stable local job key.
    disc_id: str
    track_count: int
    track_durations: tuple[float | None, ...]
    musicbrainz_disc_id: str | None = None
    musicbrainz_toc: str | None = None


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
    disc_number: int | None = None
    disc_total: int | None = None

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
        # MusicBrainz lookup values are backend implementation details. Keep the
        # established touchscreen API response focused on the local identifier.
        disc = None
        if self.disc is not None:
            disc = {
                "disc_id": self.disc.disc_id,
                "track_count": self.disc.track_count,
                "track_durations": self.disc.track_durations,
            }
        return {
            "configured": self.configured,
            "available": self.available,
            "disc_present": self.disc_present,
            "message": self.message,
            "disc": disc,
        }
