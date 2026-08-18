"""Application version and controlled software-update API."""

from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict

from pi_jukebox.updates.service import UpdateService

router = APIRouter(prefix="/system", tags=["system"])


class UpdateStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    installed_version: str
    latest_version: str | None
    checking: bool
    installing: bool
    update_available: bool
    install_available: bool
    stage: str
    outcome: str | None
    requested_version: str | None
    previous_version: str | None
    message: str | None
    last_error: str | None
    source: str


class UpdateActionResponse(BaseModel):
    accepted: bool
    message: str


def _updates(request: Request) -> UpdateService:
    return request.app.state.update_service


@router.get("/updates", response_model=UpdateStatusResponse)
def update_status(request: Request) -> dict[str, Any]:
    return _updates(request).status()


@router.post("/updates/check", response_model=UpdateActionResponse, status_code=202)
def check_updates(request: Request) -> UpdateActionResponse:
    accepted = _updates(request).check()
    return UpdateActionResponse(
        accepted=accepted,
        message=(
            "Checking for a stable release." if accepted else "An update check is already active."
        ),
    )


@router.post("/updates/install", response_model=UpdateActionResponse, status_code=202)
def install_update(
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> UpdateActionResponse:
    if action != "install-stable-release":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This update action must originate from the jukebox interface.",
        )
    if not _updates(request).request_install():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A safe update helper is not configured or no update is available.",
        )
    return UpdateActionResponse(accepted=True, message="The update is being prepared safely.")
