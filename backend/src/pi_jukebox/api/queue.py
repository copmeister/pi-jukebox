"""Persistent queue API and safe advancement rules."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path, Request, status
from pydantic import BaseModel, ConfigDict, Field

from pi_jukebox.api.media import resolve_track_path
from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.queue.database import (
    InvalidQueueOperationError,
    QueueItemNotFoundError,
    QueueStore,
)

router = APIRouter(prefix="/queue", tags=["queue"])
PositiveId = Annotated[int, Path(gt=0)]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class QueueItemResponse(ApiModel):
    id: int
    track_id: int
    album_id: int
    title: str
    artist: str
    album: str
    duration_seconds: float | None
    artwork_id: int | None
    position: int
    status: Literal["current", "upcoming"]
    available: bool


class QueueSnapshotResponse(ApiModel):
    revision: int
    current: QueueItemResponse | None
    upcoming: list[QueueItemResponse]
    upcoming_count: int
    upcoming_duration_seconds: float
    warning: str | None


class MoveRequest(ApiModel):
    direction: Literal["up", "down"]


class AdvanceRequest(ApiModel):
    current_item_id: int = Field(gt=0)


def _catalogue(request: Request) -> Catalogue:
    return request.app.state.catalogue


def _queue(request: Request) -> QueueStore:
    return request.app.state.queue_store


def _track_or_404(request: Request, track_id: int) -> dict[str, Any]:
    track = _catalogue(request).get_track(track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found.")
    return track


def _album_tracks_or_404(request: Request, album_id: int) -> list[dict[str, Any]]:
    album = _catalogue(request).get_album(album_id)
    if album is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found.")
    return list(album["tracks"])


def _mutation_error(exc: Exception) -> HTTPException:
    if isinstance(exc, QueueItemNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get("", response_model=QueueSnapshotResponse)
def get_queue(request: Request) -> dict[str, Any]:
    """Return the complete authoritative queue snapshot."""

    return _queue(request).snapshot()


@router.post("/tracks/{track_id}", response_model=QueueSnapshotResponse)
def add_track(track_id: PositiveId, request: Request) -> dict[str, Any]:
    """Append one catalogue track to the upcoming queue."""

    return _queue(request).add_track(_track_or_404(request, track_id))


@router.post("/tracks/{track_id}/next", response_model=QueueSnapshotResponse)
def play_track_next(track_id: PositiveId, request: Request) -> dict[str, Any]:
    """Insert one track first among upcoming items without starting it."""

    return _queue(request).play_next(_track_or_404(request, track_id))


@router.post("/tracks/{track_id}/play-now", response_model=QueueSnapshotResponse)
def play_track_now(track_id: PositiveId, request: Request) -> dict[str, Any]:
    """Replace the current item with one track while preserving upcoming items."""

    return _queue(request).play_now(_track_or_404(request, track_id))


@router.post("/albums/{album_id}", response_model=QueueSnapshotResponse)
def add_album(album_id: PositiveId, request: Request) -> dict[str, Any]:
    """Append an album's ordered tracks to the upcoming queue."""

    return _queue(request).add_album(_album_tracks_or_404(request, album_id))


@router.post("/albums/{album_id}/play", response_model=QueueSnapshotResponse)
def play_album(album_id: PositiveId, request: Request) -> dict[str, Any]:
    """Replace the complete queue with an album in catalogue order."""

    return _queue(request).play_album(_album_tracks_or_404(request, album_id))


@router.delete("/items/{item_id}", response_model=QueueSnapshotResponse)
def remove_queue_item(item_id: PositiveId, request: Request) -> dict[str, Any]:
    """Remove one upcoming item; the current item is protected."""

    try:
        return _queue(request).remove_upcoming(item_id)
    except (QueueItemNotFoundError, InvalidQueueOperationError) as exc:
        raise _mutation_error(exc) from exc


@router.delete("/upcoming", response_model=QueueSnapshotResponse)
def clear_upcoming(request: Request) -> dict[str, Any]:
    """Clear upcoming items without changing the current item."""

    return _queue(request).clear_upcoming()


@router.post("/items/{item_id}/move", response_model=QueueSnapshotResponse)
def move_queue_item(item_id: PositiveId, payload: MoveRequest, request: Request) -> dict[str, Any]:
    """Move one upcoming item one deterministic position up or down."""

    try:
        return _queue(request).move_upcoming(item_id, payload.direction)
    except (QueueItemNotFoundError, InvalidQueueOperationError) as exc:
        raise _mutation_error(exc) from exc


@router.post("/advance", response_model=QueueSnapshotResponse)
def advance_queue(payload: AdvanceRequest, request: Request) -> dict[str, Any]:
    """Atomically complete the expected current item and promote the next playable one."""

    snapshot = _queue(request).snapshot()
    unavailable_ids: set[int] = set()
    for item in snapshot["upcoming"]:
        track = _catalogue(request).get_track(int(item["track_id"]))
        if track is None:
            unavailable_ids.add(int(item["id"]))
            continue
        try:
            resolve_track_path(request.app.state.settings, str(track["relative_path"]))
        except HTTPException:
            unavailable_ids.add(int(item["id"]))
    try:
        return _queue(request).advance(payload.current_item_id, unavailable_ids)
    except InvalidQueueOperationError as exc:
        raise _mutation_error(exc) from exc
