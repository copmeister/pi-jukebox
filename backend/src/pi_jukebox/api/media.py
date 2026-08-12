"""Safe, seekable audio-file responses for catalogue tracks."""

from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.config import LibraryConfigurationError, Settings

router = APIRouter(tags=["media"])

MIME_TYPES = {
    "mp3": "audio/mpeg",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
}
CHUNK_SIZE = 64 * 1024


class InvalidRangeError(ValueError):
    """Raised when a Range header cannot identify one satisfiable byte range."""


def _parse_range(value: str, file_size: int) -> tuple[int, int]:
    """Parse one HTTP bytes range and return its inclusive bounds."""

    if not value.startswith("bytes=") or "," in value or file_size <= 0:
        raise InvalidRangeError
    range_value = value.removeprefix("bytes=").strip()
    if "-" not in range_value:
        raise InvalidRangeError
    start_text, end_text = range_value.split("-", maxsplit=1)
    if not start_text:
        try:
            suffix_length = int(end_text)
        except ValueError as exc:
            raise InvalidRangeError from exc
        if suffix_length <= 0:
            raise InvalidRangeError
        start = max(0, file_size - suffix_length)
        return start, file_size - 1

    try:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    except ValueError as exc:
        raise InvalidRangeError from exc
    if start < 0 or start >= file_size or end < start:
        raise InvalidRangeError
    return start, min(end, file_size - 1)


def _file_chunks(path: Path, start: int, length: int) -> Iterator[bytes]:
    """Read only the requested portion of a file in bounded chunks."""

    remaining = length
    with path.open("rb") as audio_file:
        audio_file.seek(start)
        while remaining > 0:
            chunk = audio_file.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _safe_track_path(settings: Settings, relative_path: str) -> Path:
    """Resolve a catalogue path beneath the configured library without leaking it."""

    try:
        library_root = settings.validated_library_root()
    except LibraryConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The music library is unavailable.",
        ) from exc

    candidate = library_root / relative_path
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The audio file is unavailable.",
        ) from exc
    if not resolved.is_relative_to(library_root) or not resolved.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The audio file is unavailable.",
        )
    return resolved


@router.get("/tracks/{track_id}/media")
def get_track_media(track_id: int, request: Request) -> Response:
    """Stream one catalogue track, including one browser byte range when requested."""

    catalogue: Catalogue = request.app.state.catalogue
    track = catalogue.get_track(track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found.")

    path = _safe_track_path(request.app.state.settings, str(track["relative_path"]))
    try:
        file_size = path.stat().st_size
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The audio file is unavailable.",
        ) from exc
    media_type = MIME_TYPES.get(str(track["file_format"]), "application/octet-stream")
    range_header = request.headers.get("range")
    base_headers = {"Accept-Ranges": "bytes"}

    if range_header is None:
        base_headers["Content-Length"] = str(file_size)
        return StreamingResponse(
            _file_chunks(path, 0, file_size),
            status_code=status.HTTP_200_OK,
            media_type=media_type,
            headers=base_headers,
        )

    try:
        start, end = _parse_range(range_header, file_size)
    except InvalidRangeError:
        return Response(
            status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
            headers={**base_headers, "Content-Range": f"bytes */{file_size}"},
        )

    length = end - start + 1
    return StreamingResponse(
        _file_chunks(path, start, length),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type=media_type,
        headers={
            **base_headers,
            "Content-Length": str(length),
            "Content-Range": f"bytes {start}-{end}/{file_size}",
        },
    )
