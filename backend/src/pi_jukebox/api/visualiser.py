"""Real-time spectrum event stream."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from pi_jukebox.visualiser.service import VisualiserService

router = APIRouter(prefix="/visualiser", tags=["visualiser"])


def _service(request: Request) -> VisualiserService:
    return request.app.state.visualiser_service


@router.get("/stream")
async def stream_visualiser(request: Request) -> StreamingResponse:
    service = _service(request)

    async def events() -> AsyncIterator[str]:
        frame = service.subscribe()
        try:
            yield _event(frame.payload())
            sequence = frame.sequence
            while not await request.is_disconnected():
                frame = await asyncio.to_thread(service.wait_for_frame, sequence, 10.0)
                if frame.sequence == sequence:
                    yield ": keep-alive\n\n"
                    continue
                sequence = frame.sequence
                yield _event(frame.payload())
        finally:
            await asyncio.to_thread(service.unsubscribe)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


def _event(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"
