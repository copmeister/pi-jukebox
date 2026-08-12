"""Library scanning and read-only catalogue endpoints."""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.config import LibraryConfigurationError, Settings
from pi_jukebox.library.scanner import ScanAlreadyRunningError, ScanService

router = APIRouter(tags=["library"])


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ScanRunResponse(ApiModel):
    id: int
    status: str
    library_root: str | None
    started_at: str
    finished_at: str | None
    files_discovered: int
    files_added: int
    files_updated: int
    files_unchanged: int
    files_removed: int
    files_with_errors: int
    error_message: str | None


class ScanStartResponse(ApiModel):
    scan_id: int
    status: str


class ScanStatusResponse(ApiModel):
    configured: bool
    available: bool
    configuration_error: str | None
    running: bool
    latest_scan: ScanRunResponse | None


class TrackResponse(ApiModel):
    id: int
    album_id: int
    relative_path: str
    filename: str
    title: str
    artist: str
    album_artist: str
    album: str
    disc_number: int | None
    track_number: int | None
    duration_seconds: float | None
    file_format: str
    playback_support: str
    artwork_id: int | None


class AlbumSummaryResponse(ApiModel):
    id: int
    title: str
    album_artist: str
    artwork_id: int | None
    track_count: int
    duration_seconds: float


class AlbumDetailResponse(AlbumSummaryResponse):
    tracks: list[TrackResponse]


class SearchResponse(ApiModel):
    query: str
    albums: list[AlbumSummaryResponse]
    tracks: list[TrackResponse]


def _catalogue(request: Request) -> Catalogue:
    return request.app.state.catalogue


def _scan_service(request: Request) -> ScanService:
    return request.app.state.scan_service


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.post(
    "/library/scan",
    response_model=ScanStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_library_scan(request: Request) -> ScanStartResponse:
    """Start one background scan, or reject an overlapping request."""

    try:
        scan_id = _scan_service(request).start()
    except ScanAlreadyRunningError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ScanStartResponse(scan_id=scan_id, status="running")


@router.get("/library/scan/status", response_model=ScanStatusResponse)
def library_scan_status(request: Request) -> ScanStatusResponse:
    """Return configuration state, activity, and the latest persisted result."""

    settings = _settings(request)
    try:
        settings.validated_library_root()
        available = True
        configuration_error = None
    except LibraryConfigurationError as exc:
        available = False
        configuration_error = str(exc)
    latest = _catalogue(request).latest_scan()
    return ScanStatusResponse(
        configured=settings.music_library_path is not None,
        available=available,
        configuration_error=configuration_error,
        running=_scan_service(request).is_running,
        latest_scan=ScanRunResponse.model_validate(latest) if latest else None,
    )


@router.get("/albums", response_model=list[AlbumSummaryResponse])
def list_albums(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    """List album groups ordered by Album Artist and album title."""

    return _catalogue(request).list_albums(limit=limit, offset=offset)


@router.get("/albums/{album_id}", response_model=AlbumDetailResponse)
def get_album(album_id: int, request: Request) -> dict[str, Any]:
    """Return one album and its disc/track-ordered tracks."""

    album = _catalogue(request).get_album(album_id)
    if album is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found.")
    return album


@router.get("/tracks/{track_id}", response_model=TrackResponse)
def get_track(track_id: int, request: Request) -> dict[str, Any]:
    """Return one catalogue track."""

    track = _catalogue(request).get_track(track_id)
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found.")
    return track


@router.get("/tracks", response_model=list[TrackResponse])
def list_tracks(request: Request) -> list[dict[str, Any]]:
    """Return every catalogue track for the randomized jukebox selector."""

    return _catalogue(request).list_tracks()


@router.get("/search", response_model=SearchResponse)
def search_catalogue(
    request: Request,
    q: Annotated[str, Query(min_length=1, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, Any]:
    """Search albums, Album Artists, track artists, and track titles."""

    query = " ".join(q.split())
    results = _catalogue(request).search(query, limit=limit)
    return {"query": query, **results}


@router.get("/artwork/{artwork_id}", response_class=FileResponse)
def get_artwork(artwork_id: int, request: Request) -> Response:
    """Return one content-addressed cached artwork file."""

    artwork = _catalogue(request).get_artwork(artwork_id)
    if artwork is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork not found.")

    artwork_root = _settings(request).artwork_directory.resolve()
    cache_path = (artwork_root / artwork["cache_filename"]).resolve()
    if cache_path.parent != artwork_root or not cache_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Artwork cache file not found."
        )
    return FileResponse(path=cache_path, media_type=artwork["mime_type"])
