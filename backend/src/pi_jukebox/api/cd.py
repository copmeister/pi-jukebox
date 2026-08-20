"""Touchscreen-safe CD detection, metadata, artwork, ripping, cancel, and eject API."""

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from pi_jukebox.cd.ripper import RipAction, RipAlreadyRunningError, RipConflictError
from pi_jukebox.cd.service import CdService
from pi_jukebox.cd.storage import StorageSafetyError

router = APIRouter(prefix="/cd", tags=["cd"])


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DiscResponse(ApiModel):
    disc_id: str
    track_count: int
    track_durations: list[float | None]


class DriveResponse(ApiModel):
    configured: bool
    available: bool
    disc_present: bool
    message: str
    disc: DiscResponse | None


class StorageResponse(ApiModel):
    configured: bool
    available: bool
    mounted: bool
    writable: bool
    free_bytes: int | None
    message: str


class ReleaseTrackResponse(ApiModel):
    number: int
    title: str
    artist: str
    duration_seconds: float | None


class ReleaseResponse(ApiModel):
    release_id: str
    title: str
    artist: str
    year: str | None
    country: str | None
    edition: str | None
    track_count: int
    tracks: list[ReleaseTrackResponse]
    artwork_available: bool
    disc_number: int | None
    disc_total: int | None


class RipTrackResponse(ApiModel):
    track_number: int
    title: str
    artist: str
    duration_seconds: float | None
    state: str
    final_relative_path: str | None
    error_message: str | None
    updated_at: str


class RipJobResponse(ApiModel):
    id: int
    status: str
    disc_id: str
    release_id: str | None
    album_title: str
    album_artist: str
    total_tracks: int
    completed_tracks: int
    failed_tracks: int
    message: str | None
    error_message: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    cancel_requested: bool
    tracks: list[RipTrackResponse]


class RipActionResponse(ApiModel):
    action: RipAction
    message: str
    source_job_id: int | None


class CdStatusResponse(ApiModel):
    drive: DriveResponse
    storage: StorageResponse
    metadata_state: str
    metadata_message: str | None
    release_candidates: list[ReleaseResponse]
    selected_release_id: str | None
    active: bool
    latest_job: RipJobResponse | None
    rip_action: RipActionResponse


class RipStartRequest(ApiModel):
    release_id: str


class ActionResponse(ApiModel):
    accepted: bool
    message: str
    job_id: int | None = None


def _service(request: Request) -> CdService:
    return request.app.state.cd_service


@router.get("/status", response_model=CdStatusResponse)
def cd_status(request: Request) -> dict[str, Any]:
    return _service(request).status()


@router.post("/metadata/retry", response_model=ActionResponse, status_code=202)
def retry_metadata(request: Request) -> ActionResponse:
    accepted = _service(request).lookup()
    return ActionResponse(
        accepted=accepted,
        message="Looking up this disc." if accepted else "A metadata lookup is already active.",
    )


@router.post("/releases/{release_id}/select", response_model=ActionResponse)
def select_release(release_id: str, request: Request) -> ActionResponse:
    if not _service(request).select_release(release_id):
        raise HTTPException(status_code=404, detail="That release is no longer available.")
    return ActionResponse(accepted=True, message="Release selected.")


@router.get("/releases/{release_id}/artwork", response_class=FileResponse)
def cd_artwork(release_id: str, request: Request) -> FileResponse:
    path = _service(request).artwork_path(release_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Cover artwork is not available.")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/rips", response_model=ActionResponse, status_code=202)
def start_rip(payload: RipStartRequest, request: Request) -> ActionResponse:
    try:
        job_id = _service(request).start_rip(payload.release_id)
    except RipAlreadyRunningError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except (RipConflictError, StorageSafetyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return ActionResponse(accepted=True, message="CD rip started.", job_id=job_id)


@router.post("/rips/{job_id}/cancel", response_model=ActionResponse, status_code=202)
def cancel_rip(job_id: int, request: Request) -> ActionResponse:
    if not _service(request).cancel(job_id):
        raise HTTPException(status_code=409, detail="That rip is no longer active.")
    return ActionResponse(accepted=True, message="Cancellation requested.", job_id=job_id)


@router.post("/eject", response_model=ActionResponse)
def eject_disc(request: Request) -> ActionResponse:
    if not _service(request).eject():
        raise HTTPException(status_code=409, detail="The disc cannot be ejected while ripping.")
    return ActionResponse(accepted=True, message="Disc ejected.")
