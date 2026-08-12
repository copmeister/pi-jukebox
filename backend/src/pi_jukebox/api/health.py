"""Health-check route."""

from fastapi import APIRouter
from pydantic import BaseModel

from pi_jukebox.config import get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Public service health information."""

    status: str
    application: str
    environment: str


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    """Confirm that the API process is ready to accept requests."""

    settings = get_settings()
    return HealthResponse(
        status="ok",
        application=settings.app_name,
        environment=settings.environment,
    )
