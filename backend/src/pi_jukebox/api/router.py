"""Top-level API router."""

from fastapi import APIRouter

from pi_jukebox.api.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
