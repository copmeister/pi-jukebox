"""MusicBrainz release lookup and bounded Cover Art Archive retrieval."""

import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Any, Protocol

import httpx

from pi_jukebox.cd.models import DiscLayout, ReleaseCandidate, ReleaseTrack
from pi_jukebox.config import Settings
from pi_jukebox.version import __version__

logger = logging.getLogger(__name__)


class MetadataLookupError(RuntimeError):
    """Raised when online metadata is temporarily unavailable or malformed."""


class HttpClient(Protocol):
    def get(self, url: str, **kwargs: Any) -> Any: ...


MUSICBRAINZ_DISC_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{28}$")


def _artist_credit(value: Any, fallback: str = "Unknown Artist") -> str:
    if not isinstance(value, list):
        return fallback
    parts: list[str] = []
    for credit in value:
        if not isinstance(credit, dict):
            continue
        name = credit.get("name")
        if isinstance(name, str):
            parts.append(name)
        join = credit.get("joinphrase")
        if isinstance(join, str):
            parts.append(join)
    return "".join(parts).strip() or fallback


class MusicMetadataClient:
    def __init__(self, settings: Settings, client: HttpClient | None = None) -> None:
        self.settings = settings
        self.client = client or httpx.Client(follow_redirects=True)
        self.headers = {
            "User-Agent": (f"PiJukebox/{__version__} (https://github.com/copmeister/pi-jukebox)")
        }

    def releases_for_disc(self, disc: DiscLayout) -> list[ReleaseCandidate]:
        musicbrainz_id = disc.musicbrainz_disc_id or ""
        if MUSICBRAINZ_DISC_ID_PATTERN.fullmatch(musicbrainz_id) is None:
            raise MetadataLookupError(
                "The disc reader did not produce a valid MusicBrainz Disc ID."
            )
        url = f"{self.settings.musicbrainz_base_url.rstrip('/')}/discid/{musicbrainz_id}"
        params = {
            "inc": "artists+recordings+release-groups",
            "fmt": "json",
        }
        if disc.musicbrainz_toc:
            # MusicBrainz uses the TOC for fuzzy matching when an exact pressing
            # has not yet had its Disc ID attached. Suppress CD stubs so they do
            # not prevent that fuzzy lookup.
            params["toc"] = disc.musicbrainz_toc
            params["cdstubs"] = "no"
        response = self._get(
            url,
            operation="MusicBrainz disc lookup",
            params=params,
        )
        try:
            payload = response.json()
            releases = payload.get("releases", [])
            if not isinstance(releases, list):
                raise ValueError
            candidates = [self._candidate(release, disc) for release in releases]
        except (AttributeError, TypeError, ValueError) as exc:
            logger.warning(
                "MusicBrainz response parsing failed (%s); response body omitted.",
                type(exc).__name__,
            )
            raise MetadataLookupError(
                "MusicBrainz returned unreadable release information."
            ) from exc
        usable = [candidate for candidate in candidates if candidate is not None]
        logger.info(
            "MusicBrainz response parsed: %d release(s), %d usable candidate(s).",
            len(releases),
            len(usable),
        )
        return usable

    def fetch_front_cover(self, release_id: str) -> tuple[bytes, str] | None:
        url = f"{self.settings.cover_art_base_url.rstrip('/')}/release/{release_id}/front-500"
        try:
            response = self._get(url, operation="Cover Art Archive front-cover lookup")
        except MetadataLookupError:
            return None
        if response.status_code == 404:
            return None
        content = bytes(response.content)
        if len(content) > 8 * 1024 * 1024:
            return None
        mime_type = str(response.headers.get("content-type", "image/jpeg")).split(";")[0]
        if not mime_type.startswith("image/"):
            return None
        return content, mime_type

    def _get(self, url: str, *, operation: str, **kwargs: Any) -> Any:
        last_error: Exception | None = None
        total_attempts = self.settings.metadata_retry_count + 1
        for attempt in range(total_attempts):
            try:
                response = self.client.get(
                    url,
                    headers=self.headers,
                    timeout=self.settings.metadata_timeout_seconds,
                    **kwargs,
                )
                if response.status_code == 404:
                    logger.info(
                        "%s returned HTTP 404 (attempt %d/%d).",
                        operation,
                        attempt + 1,
                        total_attempts,
                    )
                    return response
                response.raise_for_status()
                logger.info(
                    "%s returned HTTP %d (attempt %d/%d).",
                    operation,
                    response.status_code,
                    attempt + 1,
                    total_attempts,
                )
                return response
            except (httpx.HTTPError, OSError) as exc:
                last_error = exc
                status = (
                    exc.response.status_code
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None
                    else None
                )
                if status is None:
                    logger.warning(
                        "%s failed on attempt %d/%d (%s).",
                        operation,
                        attempt + 1,
                        total_attempts,
                        type(exc).__name__,
                    )
                else:
                    logger.warning(
                        "%s failed with HTTP %d on attempt %d/%d.",
                        operation,
                        status,
                        attempt + 1,
                        total_attempts,
                    )
                if attempt < self.settings.metadata_retry_count:
                    time.sleep(0.15 * (attempt + 1))
        logger.warning(
            "%s exhausted %d attempt(s); online metadata fallback will be used.",
            operation,
            total_attempts,
        )
        raise MetadataLookupError(
            "Online disc information is unavailable right now."
        ) from last_error

    @staticmethod
    def _candidate(release: Any, disc: DiscLayout) -> ReleaseCandidate | None:
        if not isinstance(release, dict) or not isinstance(release.get("id"), str):
            return None
        matching_medium: dict[str, Any] | None = None
        for medium in release.get("media", []):
            if not isinstance(medium, dict):
                continue
            discs = medium.get("discs", [])
            if any(
                isinstance(item, dict) and item.get("id") == disc.musicbrainz_disc_id
                for item in discs
            ):
                matching_medium = medium
                break
        if matching_medium is None:
            media = release.get("media", [])
            matching_medium = media[0] if isinstance(media, list) and media else None
        if not isinstance(matching_medium, dict):
            return None

        album_artist = _artist_credit(release.get("artist-credit"))
        tracks: list[ReleaseTrack] = []
        for index, raw_track in enumerate(matching_medium.get("tracks", []), start=1):
            if not isinstance(raw_track, dict):
                continue
            recording = raw_track.get("recording")
            recording = recording if isinstance(recording, dict) else {}
            raw_position = raw_track.get("position", index)
            try:
                position = int(raw_position)
            except (TypeError, ValueError):
                position = index
            length_ms = raw_track.get("length", recording.get("length"))
            duration = float(length_ms) / 1000 if isinstance(length_ms, (int, float)) else None
            tracks.append(
                ReleaseTrack(
                    number=position,
                    title=str(raw_track.get("title") or recording.get("title") or f"Track {index}"),
                    artist=_artist_credit(
                        recording.get("artist-credit") or raw_track.get("artist-credit"),
                        album_artist,
                    ),
                    duration_seconds=duration,
                )
            )
        if not tracks:
            tracks = [
                ReleaseTrack(index, f"Track {index}", album_artist, duration)
                for index, duration in enumerate(disc.track_durations, start=1)
            ]
        release_group = release.get("release-group")
        release_group = release_group if isinstance(release_group, dict) else {}
        return ReleaseCandidate(
            release_id=release["id"],
            title=str(release.get("title") or "Unknown Album"),
            artist=album_artist,
            year=(str(release.get("date"))[:4] or None) if release.get("date") else None,
            country=str(release["country"]) if release.get("country") else None,
            edition=str(release.get("status") or release_group.get("primary-type") or "") or None,
            track_count=len(tracks),
            tracks=tuple(tracks),
        )


class CandidateArtworkCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def store(self, release_id: str, content: bytes) -> Path:
        self.directory.mkdir(parents=True, exist_ok=True)
        safe_name = hashlib.sha256(release_id.encode()).hexdigest() + ".jpg"
        target = self.directory / safe_name
        temporary = target.with_suffix(".tmp")
        temporary.write_bytes(content)
        temporary.replace(target)
        return target

    def get(self, release_id: str) -> Path | None:
        path = self.directory / (hashlib.sha256(release_id.encode()).hexdigest() + ".jpg")
        return path if path.is_file() else None


def fallback_release(disc: DiscLayout) -> ReleaseCandidate:
    """Provide a safe no-keyboard fallback when metadata is unavailable."""

    return ReleaseCandidate(
        release_id=f"disc-{disc.disc_id}",
        title=f"Unknown Album {disc.disc_id[:8]}",
        artist="Unknown Artist",
        year=None,
        country=None,
        edition="Audio CD",
        track_count=disc.track_count,
        tracks=tuple(
            ReleaseTrack(number, f"Track {number}", "Unknown Artist", duration)
            for number, duration in enumerate(disc.track_durations, start=1)
        ),
    )
