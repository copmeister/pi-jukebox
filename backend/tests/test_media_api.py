import asyncio
from pathlib import Path

import httpx
from conftest import make_settings, metadata, touch_audio
from pi_jukebox.catalogue.models import ScannedTrack
from pi_jukebox.main import create_app

AUDIO_BYTES = b"0123456789abcdefghijklmnopqrstuvwxyz"


async def _catalogued_client(
    tmp_path: Path,
) -> tuple[httpx.AsyncClient, object, Path, int]:
    library = tmp_path / "music"
    audio_path = touch_audio(library, "album/track.mp3", AUDIO_BYTES)
    app = create_app(make_settings(tmp_path, library))
    lifespan = app.router.lifespan_context(app)
    await lifespan.__aenter__()
    app.state.scan_service.scanner.metadata_reader = type(
        "Reader", (), {"read": lambda _self, _path: metadata(title="Range Song")}
    )()
    app.state.scan_service.scanner.scan()
    track_id = app.state.catalogue.get_album(1)["tracks"][0]["id"]
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    return client, lifespan, audio_path, track_id


def test_complete_file_and_byte_ranges(tmp_path: Path) -> None:
    async def request_ranges() -> None:
        client, lifespan, _audio_path, track_id = await _catalogued_client(tmp_path)
        try:
            complete = await client.get(f"/api/tracks/{track_id}/media")
            bounded = await client.get(
                f"/api/tracks/{track_id}/media", headers={"Range": "bytes=4-9"}
            )
            open_ended = await client.get(
                f"/api/tracks/{track_id}/media", headers={"Range": "bytes=30-"}
            )
            suffix = await client.get(
                f"/api/tracks/{track_id}/media", headers={"Range": "bytes=-5"}
            )

            assert complete.status_code == 200
            assert complete.content == AUDIO_BYTES
            assert complete.headers["content-type"].startswith("audio/mpeg")
            assert complete.headers["accept-ranges"] == "bytes"
            assert complete.headers["content-length"] == str(len(AUDIO_BYTES))

            assert bounded.status_code == 206
            assert bounded.content == AUDIO_BYTES[4:10]
            assert bounded.headers["content-range"] == f"bytes 4-9/{len(AUDIO_BYTES)}"
            assert bounded.headers["content-length"] == "6"

            assert open_ended.status_code == 206
            assert open_ended.content == AUDIO_BYTES[30:]
            assert open_ended.headers["content-range"] == (
                f"bytes 30-{len(AUDIO_BYTES) - 1}/{len(AUDIO_BYTES)}"
            )

            assert suffix.status_code == 206
            assert suffix.content == AUDIO_BYTES[-5:]
            assert suffix.headers["content-range"] == (
                f"bytes {len(AUDIO_BYTES) - 5}-{len(AUDIO_BYTES) - 1}/{len(AUDIO_BYTES)}"
            )
        finally:
            await client.aclose()
            await lifespan.__aexit__(None, None, None)

    asyncio.run(request_ranges())


def test_invalid_unsatisfiable_and_multi_ranges(tmp_path: Path) -> None:
    async def request_ranges() -> None:
        client, lifespan, _audio_path, track_id = await _catalogued_client(tmp_path)
        try:
            headers = [
                "items=0-2",
                "bytes=abc-def",
                "bytes=10-4",
                f"bytes={len(AUDIO_BYTES)}-",
                "bytes=0-1,4-5",
            ]
            for range_value in headers:
                response = await client.get(
                    f"/api/tracks/{track_id}/media", headers={"Range": range_value}
                )
                assert response.status_code == 416
                assert response.headers["content-range"] == f"bytes */{len(AUDIO_BYTES)}"
                assert response.headers["accept-ranges"] == "bytes"
        finally:
            await client.aclose()
            await lifespan.__aexit__(None, None, None)

    asyncio.run(request_ranges())


def test_unknown_missing_unconfigured_and_escaping_tracks(tmp_path: Path) -> None:
    async def request_failures() -> None:
        client, lifespan, audio_path, track_id = await _catalogued_client(tmp_path)
        try:
            unknown = await client.get("/api/tracks/99999/media")
            audio_path.unlink()
            missing = await client.get(f"/api/tracks/{track_id}/media")
            assert unknown.status_code == 404
            assert missing.status_code == 404
            assert str(tmp_path) not in missing.text
        finally:
            await client.aclose()
            await lifespan.__aexit__(None, None, None)

        outside = touch_audio(tmp_path, "outside.mp3", AUDIO_BYTES)
        library = tmp_path / "configured-library"
        library.mkdir()
        app = create_app(make_settings(tmp_path / "escape", library))
        async with app.router.lifespan_context(app):
            stat = outside.stat()
            app.state.catalogue.upsert_track(
                ScannedTrack(
                    relative_path="../outside.mp3",
                    filename=outside.name,
                    file_size=stat.st_size,
                    modified_time_ns=stat.st_mtime_ns,
                    file_format="mp3",
                    playback_support="required",
                    metadata=metadata(title="Outside"),
                )
            )
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
                escaping = await api.get("/api/tracks/1/media")
                assert escaping.status_code == 404
                assert str(outside) not in escaping.text

        unavailable_app = create_app(make_settings(tmp_path / "unavailable", None))
        async with unavailable_app.router.lifespan_context(unavailable_app):
            unavailable_app.state.catalogue.upsert_track(
                ScannedTrack(
                    relative_path="track.mp3",
                    filename="track.mp3",
                    file_size=1,
                    modified_time_ns=1,
                    file_format="mp3",
                    playback_support="required",
                    metadata=metadata(title="Unavailable"),
                )
            )
            transport = httpx.ASGITransport(app=unavailable_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
                unavailable = await api.get("/api/tracks/1/media")
                assert unavailable.status_code == 503
                assert "PI_JUKEBOX" not in unavailable.text
                assert str(tmp_path) not in unavailable.text

    asyncio.run(request_failures())
