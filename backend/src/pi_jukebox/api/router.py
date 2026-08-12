"""Top-level API router."""

from fastapi import APIRouter

from pi_jukebox.api.catalogue import router as catalogue_router
from pi_jukebox.api.health import router as health_router
from pi_jukebox.api.media import router as media_router
from pi_jukebox.api.queue import router as queue_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(catalogue_router)
api_router.include_router(media_router)
api_router.include_router(queue_router)
