"""Health-check route."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from pi_jukebox.version import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Public service health information."""

    status: str
    application: str
    environment: str
    version: str


@router.get("/health", response_model=HealthResponse)
def health_check(request: Request) -> HealthResponse:
    """Confirm that the API process is ready to accept requests."""

    settings = request.app.state.settings
    return HealthResponse(
        status="ok",
        application=settings.app_name,
        environment=settings.environment,
        version=__version__,
    )
