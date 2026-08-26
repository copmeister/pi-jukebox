"""Internet-radio now-playing metadata."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from pi_jukebox.radio.metadata import MetadataKind, RadioMetadataService

router = APIRouter(prefix="/radio", tags=["radio"])


class RadioNowPlayingResponse(BaseModel):
    station_id: str
    available: bool
    kind: MetadataKind
    text: str | None
    artist: str | None
    title: str | None


def _service(request: Request) -> RadioMetadataService:
    return request.app.state.radio_metadata_service


@router.get(
    "/stations/{station_id}/now-playing",
    response_model=RadioNowPlayingResponse,
)
async def radio_now_playing(
    station_id: str,
    request: Request,
) -> RadioNowPlayingResponse:
    try:
        metadata = await asyncio.to_thread(_service(request).fetch, station_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown radio station.") from exc
    return RadioNowPlayingResponse(
        station_id=metadata.station_id,
        available=metadata.available,
        kind=metadata.kind,
        text=metadata.text,
        artist=metadata.artist,
        title=metadata.title,
    )
