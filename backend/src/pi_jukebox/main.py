"""FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pi_jukebox.api.router import api_router
from pi_jukebox.bluetooth.service import BluetoothService
from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.cd.hardware import CdHardware
from pi_jukebox.cd.metadata import CandidateArtworkCache, MusicMetadataClient
from pi_jukebox.cd.ripper import RipService
from pi_jukebox.cd.service import CdService
from pi_jukebox.cd.storage import StorageGuard
from pi_jukebox.cd.store import RipStore
from pi_jukebox.config import Settings as AppSettings
from pi_jukebox.config import get_settings
from pi_jukebox.display.backlight import BacklightService
from pi_jukebox.library.scanner import LibraryScanner, ScanService
from pi_jukebox.queue.database import QueueStore
from pi_jukebox.updates.service import GitHubCliReleaseSource, UpdateService
from pi_jukebox.version import __version__


def create_app(settings: AppSettings | None = None) -> FastAPI:
    """Create and configure the Pi Jukebox API."""

    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        catalogue = Catalogue(settings.database_path)
        catalogue.initialize()
        scanner = LibraryScanner(settings=settings, catalogue=catalogue)
        application.state.catalogue = catalogue
        application.state.queue_store = QueueStore(catalogue)
        scan_service = ScanService(scanner=scanner, catalogue=catalogue)
        application.state.scan_service = scan_service
        rip_store = RipStore(catalogue)
        hardware = CdHardware(settings)
        storage = StorageGuard(settings)
        ripper = RipService(settings, rip_store, storage, hardware, scan_service)
        cd_service = CdService(
            settings,
            hardware,
            MusicMetadataClient(settings),
            CandidateArtworkCache(settings.cd_artwork_directory),
            storage,
            ripper,
            rip_store,
        )
        update_service = UpdateService(settings, GitHubCliReleaseSource(settings))
        bluetooth_service = BluetoothService(settings)
        backlight_service = BacklightService()
        application.state.cd_service = cd_service
        application.state.update_service = update_service
        application.state.bluetooth_service = bluetooth_service
        application.state.backlight_service = backlight_service
        cd_service.start()
        update_service.start()
        try:
            yield
        finally:
            backlight_service.wake()
            cd_service.stop()
            update_service.stop()
            scan_service.wait(timeout=5)

    application = FastAPI(
        title=settings.app_name,
        version=__version__,
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
    if settings.frontend_directory is not None:
        try:
            frontend_directory = settings.frontend_directory.resolve(strict=True)
        except OSError as exc:
            raise RuntimeError("The configured production frontend is unavailable.") from exc
        if not frontend_directory.is_dir():
            raise RuntimeError("The configured production frontend is not a directory.")
        application.mount(
            "/",
            StaticFiles(directory=frontend_directory, html=True),
            name="production-frontend",
        )
    return application


app = create_app()
