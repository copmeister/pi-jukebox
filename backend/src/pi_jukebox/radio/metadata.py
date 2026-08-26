"""Read small ICY metadata blocks without proxying radio audio."""

from __future__ import annotations

import html
import re
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Literal

import httpx

from pi_jukebox.config import Settings
from pi_jukebox.version import __version__

MetadataKind = Literal["track", "programme", "text", "none"]


@dataclass(frozen=True)
class RadioStationMetadataSource:
    """One curated stream and the semantics of its title field."""

    stream_url: str
    content_kind: Literal["music", "programme"]


@dataclass(frozen=True)
class RadioNowPlaying:
    """Sanitised metadata suitable for direct UI presentation."""

    station_id: str
    kind: MetadataKind
    text: str | None = None
    artist: str | None = None
    title: str | None = None

    @property
    def available(self) -> bool:
        return self.text is not None


RADIO_METADATA_SOURCES: dict[str, RadioStationMetadataSource] = {
    "classic-fm": RadioStationMetadataSource(
        "https://media-ice.musicradio.com/ClassicFMMP3", "music"
    ),
    "classic-fm-movies": RadioStationMetadataSource(
        "https://media-ice.musicradio.com/ClassicFMMoviesMP3", "music"
    ),
    "smooth-radio": RadioStationMetadataSource(
        "https://media-ice.musicradio.com/SmoothUKMP3", "music"
    ),
    "heart": RadioStationMetadataSource("https://media-ice.musicradio.com/HeartUKMP3", "music"),
    "capital": RadioStationMetadataSource("https://media-ice.musicradio.com/CapitalUKMP3", "music"),
    "lbc": RadioStationMetadataSource("https://media-ice.musicradio.com/LBCUKMP3", "programme"),
}

_STREAM_TITLE = re.compile(r"(?:^|;)StreamTitle='([^\r\n]*?)';")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]+")
_MAX_META_INTERVAL = 1_000_000
_MAX_TITLE_LENGTH = 512


class _ChunkReader:
    def __init__(self, chunks: Iterator[bytes]) -> None:
        self._chunks = chunks
        self._buffer = bytearray()

    def read_exact(self, size: int) -> bytes:
        while len(self._buffer) < size:
            self._buffer.extend(next(self._chunks))
        result = bytes(self._buffer[:size])
        del self._buffer[:size]
        return result


class RadioMetadataService:
    """Fetch and briefly cache one ICY title block for active stations."""

    def __init__(
        self,
        settings: Settings,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client or httpx.Client(
            follow_redirects=True,
            timeout=settings.radio_metadata_timeout_seconds,
            headers={"User-Agent": f"Pi-Jukebox/{__version__}"},
        )
        self._owns_client = client is None
        self._cache_seconds = settings.radio_metadata_cache_seconds
        self._clock = clock
        self._cache: dict[str, tuple[float, RadioNowPlaying]] = {}
        self._lock = threading.Lock()

    def fetch(self, station_id: str) -> RadioNowPlaying:
        source = RADIO_METADATA_SOURCES.get(station_id)
        if source is None:
            raise KeyError(station_id)
        now = self._clock()
        with self._lock:
            cached = self._cache.get(station_id)
            if cached and now - cached[0] < self._cache_seconds:
                return cached[1]
        try:
            result = self._read_stream(station_id, source)
        except (httpx.HTTPError, OSError, StopIteration, UnicodeError, ValueError):
            result = RadioNowPlaying(station_id=station_id, kind="none")
        with self._lock:
            self._cache[station_id] = (now, result)
        return result

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def _read_stream(
        self,
        station_id: str,
        source: RadioStationMetadataSource,
    ) -> RadioNowPlaying:
        with self._client.stream(
            "GET", source.stream_url, headers={"Icy-MetaData": "1"}
        ) as response:
            response.raise_for_status()
            interval = int(response.headers.get("icy-metaint", "0"))
            if interval <= 0 or interval > _MAX_META_INTERVAL:
                return RadioNowPlaying(station_id=station_id, kind="none")
            reader = _ChunkReader(response.iter_raw())
            reader.read_exact(interval)
            metadata_size = reader.read_exact(1)[0] * 16
            if metadata_size <= 0:
                return RadioNowPlaying(station_id=station_id, kind="none")
            payload = (
                reader.read_exact(metadata_size).rstrip(b"\x00").decode("utf-8", errors="replace")
            )
        title_match = _STREAM_TITLE.search(payload)
        stream_title = _clean_text(title_match.group(1) if title_match else "")
        return _interpret_title(station_id, stream_title, source.content_kind)


def _clean_text(value: str) -> str:
    cleaned = _CONTROL_CHARACTERS.sub(" ", html.unescape(value)).strip()
    return " ".join(cleaned.split())[:_MAX_TITLE_LENGTH]


def _interpret_title(
    station_id: str,
    stream_title: str,
    content_kind: Literal["music", "programme"],
) -> RadioNowPlaying:
    if not stream_title:
        return RadioNowPlaying(station_id=station_id, kind="none")
    if content_kind == "programme":
        return RadioNowPlaying(
            station_id=station_id,
            kind="programme",
            text=stream_title,
        )
    artist, separator, title = stream_title.partition(" - ")
    if separator and artist.strip() and title.strip():
        artist = artist.strip()
        title = title.strip()
        return RadioNowPlaying(
            station_id=station_id,
            kind="track",
            text=f"{artist} — {title}",
            artist=artist,
            title=title,
        )
    return RadioNowPlaying(station_id=station_id, kind="text", text=stream_title)
