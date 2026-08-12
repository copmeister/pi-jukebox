"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pi_jukebox.api.router import api_router
from pi_jukebox.config import get_settings


def create_app() -> FastAPI:
    """Create and configure the Pi Jukebox API."""

    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Local API for the Pi Jukebox touchscreen application.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router, prefix="/api")
    return application


app = create_app()
