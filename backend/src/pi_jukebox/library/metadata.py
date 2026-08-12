"""Fault-tolerant metadata extraction using Mutagen."""

from pathlib import Path
from typing import Any

from mutagen import File as MutagenFile

from pi_jukebox.catalogue.models import ArtworkData, TrackMetadata

UNKNOWN_ARTIST = "Unknown Artist"
UNKNOWN_ALBUM = "Unknown Album"


class MutagenMetadataReader:
    """Read common tags while falling back safely for incomplete files."""

    def read(self, path: Path) -> TrackMetadata:
        fallback_title = path.stem.strip() or "Untitled Track"
        try:
            audio = MutagenFile(path, easy=False)
        except Exception:  # Mutagen raises several format-specific parsing exceptions.
            audio = None

        if audio is None:
            return TrackMetadata(
                title=fallback_title,
                artist=UNKNOWN_ARTIST,
                album_artist=UNKNOWN_ARTIST,
                album=UNKNOWN_ALBUM,
                disc_number=None,
                track_number=None,
                duration_seconds=None,
            )

        tags = getattr(audio, "tags", None)
        title = _text_tag(tags, ("title", "TIT2", "©nam")) or fallback_title
        artist = _text_tag(tags, ("artist", "TPE1", "©ART")) or UNKNOWN_ARTIST
        album_artist = _text_tag(tags, ("albumartist", "album artist", "TPE2", "aART")) or artist
        album = _text_tag(tags, ("album", "TALB", "©alb")) or UNKNOWN_ALBUM
        disc_number = _number_tag(tags, ("discnumber", "disc", "TPOS", "disk"))
        track_number = _number_tag(tags, ("tracknumber", "track", "TRCK", "trkn"))
        duration = _duration(audio)
        artwork = _artwork(audio, tags)

        return TrackMetadata(
            title=title,
            artist=artist,
            album_artist=album_artist,
            album=album,
            disc_number=disc_number,
            track_number=track_number,
            duration_seconds=duration,
            artwork=artwork,
        )


def _tag_value(tags: Any, keys: tuple[str, ...]) -> Any:
    if tags is None:
        return None
    for key in keys:
        try:
            value = tags.get(key)
        except (AttributeError, KeyError, TypeError):
            value = None
        if value is not None:
            return value
    try:
        lowered = {str(key).casefold(): value for key, value in tags.items()}
    except (AttributeError, TypeError):
        return None
    return next((lowered[key.casefold()] for key in keys if key.casefold() in lowered), None)


def _first_value(value: Any) -> Any:
    if hasattr(value, "text"):
        value = value.text
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


def _text_tag(tags: Any, keys: tuple[str, ...]) -> str | None:
    value = _first_value(_tag_value(tags, keys))
    if value is None:
        return None
    if isinstance(value, tuple):
        value = value[0] if value else None
    if value is None:
        return None
    text = str(value).strip()
    return " ".join(text.split()) if text else None


def _number_tag(tags: Any, keys: tuple[str, ...]) -> int | None:
    value = _first_value(_tag_value(tags, keys))
    if isinstance(value, tuple):
        value = value[0] if value else None
    if value is None:
        return None
    try:
        number_text = str(value).strip().split("/", maxsplit=1)[0]
        number = int(number_text)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _duration(audio: Any) -> float | None:
    try:
        duration = float(audio.info.length)
    except (AttributeError, TypeError, ValueError):
        return None
    return max(duration, 0.0)


def _artwork(audio: Any, tags: Any) -> ArtworkData | None:
    pictures = getattr(audio, "pictures", None)
    if pictures:
        picture = pictures[0]
        content = bytes(picture.data)
        if content:
            return ArtworkData(
                content=content, mime_type=picture.mime or "application/octet-stream"
            )

    if tags is None:
        return None
    try:
        values = list(tags.values())
    except (AttributeError, TypeError):
        values = []
    for value in values:
        if value.__class__.__name__ == "APIC" and getattr(value, "data", None):
            return ArtworkData(content=bytes(value.data), mime_type=value.mime or "image/jpeg")

    cover = _tag_value(tags, ("covr",))
    if cover:
        cover_value = cover[0] if isinstance(cover, (list, tuple)) else cover
        content = bytes(cover_value)
        if content:
            image_format = getattr(cover_value, "imageformat", None)
            mime_type = "image/png" if image_format == 14 else "image/jpeg"
            return ArtworkData(content=content, mime_type=mime_type)
    return None
