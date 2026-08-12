"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pi_jukebox.api.router import api_router
from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.config import Settings as AppSettings
from pi_jukebox.config import get_settings
from pi_jukebox.library.scanner import LibraryScanner, ScanService


def create_app(settings: AppSettings | None = None) -> FastAPI:
    """Create and configure the Pi Jukebox API."""

    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        catalogue = Catalogue(settings.database_path)
        catalogue.initialize()
        scanner = LibraryScanner(settings=settings, catalogue=catalogue)
        application.state.catalogue = catalogue
        application.state.scan_service = ScanService(scanner=scanner, catalogue=catalogue)
        try:
            yield
        finally:
            application.state.scan_service.wait(timeout=5)

    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Local API for the Pi Jukebox touchscreen application.",
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Accept-Ranges", "Content-Length", "Content-Range"],
    )
    application.include_router(api_router, prefix="/api")
    return application


app = create_app()
