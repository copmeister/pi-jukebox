import asyncio
import threading
from pathlib import Path

import httpx
import pytest
from conftest import FakeMetadataReader, make_settings, metadata, touch_audio
from pi_jukebox.catalogue.models import ArtworkData, TrackMetadata
from pi_jukebox.library.scanner import LibraryScanner, ScanAlreadyRunningError, ScanService
from pi_jukebox.main import create_app


async def _request_catalogue(app) -> tuple[dict, dict, bytes]:
    async with app.router.lifespan_context(app):
        track_metadata = metadata(title="API Track", artist="API Artist", track=3)
        reader = FakeMetadataReader(
            {
                "api.mp3": TrackMetadata(
                    title=track_metadata.title,
                    artist=track_metadata.artist,
                    album_artist=track_metadata.album_artist,
                    album=track_metadata.album,
                    disc_number=track_metadata.disc_number,
                    track_number=track_metadata.track_number,
                    duration_seconds=track_metadata.duration_seconds,
                    artwork=ArtworkData(b"api-artwork", "image/png"),
                )
            }
        )
        app.state.scan_service.scanner.metadata_reader = reader
        app.state.scan_service.scanner.scan()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            albums_response = await client.get("/api/albums")
            album_id = albums_response.json()[0]["id"]
            album_response = await client.get(f"/api/albums/{album_id}")
            track_id = album_response.json()["tracks"][0]["id"]
            track_response = await client.get(f"/api/tracks/{track_id}")
            artwork_id = album_response.json()["artwork_id"]
            artwork_response = await client.get(f"/api/artwork/{artwork_id}")
            assert artwork_response.headers["content-type"] == "image/png"
            assert (await client.get("/api/albums/99999")).status_code == 404
            assert (await client.get("/api/tracks/99999")).status_code == 404
            assert (await client.get("/api/artwork/99999")).status_code == 404
            return album_response.json(), track_response.json(), artwork_response.content


def test_album_and_track_api_responses(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "api.mp3")
    app = create_app(make_settings(tmp_path, library))

    album, track, artwork = asyncio.run(_request_catalogue(app))

    assert album["title"] == "Test Album"
    assert album["album_artist"] == "Album Artist"
    assert album["track_count"] == 1
    assert track["title"] == "API Track"
    assert track["artist"] == "API Artist"
    assert track["relative_path"] == "api.mp3"
    assert artwork == b"api-artwork"


def test_search_api_matches_album_and_track_fields(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "first.mp3")
    touch_audio(library, "second.mp3")
    app = create_app(make_settings(tmp_path, library))

    async def search() -> None:
        async with app.router.lifespan_context(app):
            app.state.scan_service.scanner.metadata_reader = FakeMetadataReader(
                {
                    "first.mp3": metadata(
                        title="Northern Lights",
                        artist="Guest Vocalist",
                        album_artist="The House Band",
                        album="Night Drive",
                    ),
                    "second.mp3": metadata(
                        title="Morning Sun",
                        artist="Resident Singer",
                        album_artist="The House Band",
                        album="Daybreak",
                    ),
                }
            )
            app.state.scan_service.scanner.scan()
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                album_title = await client.get("/api/search", params={"q": "night drive"})
                album_artist = await client.get("/api/search", params={"q": "HOUSE BAND"})
                track_title = await client.get("/api/search", params={"q": "northern"})
                track_artist = await client.get("/api/search", params={"q": "guest vocalist"})
                literal_wildcard = await client.get("/api/search", params={"q": "%"})

                assert album_title.status_code == 200
                assert [album["title"] for album in album_title.json()["albums"]] == ["Night Drive"]
                assert len(album_artist.json()["albums"]) == 2
                assert track_title.json()["tracks"][0]["title"] == "Northern Lights"
                assert track_artist.json()["albums"][0]["title"] == "Night Drive"
                assert track_artist.json()["tracks"][0]["artist"] == "Guest Vocalist"
                assert literal_wildcard.json()["albums"] == []
                assert literal_wildcard.json()["tracks"] == []

    asyncio.run(search())


def test_scan_status_reports_unconfigured_library(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, None))

    async def get_status() -> dict:
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                initial_response = await client.get("/api/library/scan/status")
                assert initial_response.status_code == 200
                initial = initial_response.json()
                assert initial["latest_scan"] is None
                assert (await client.post("/api/library/scan")).status_code == 202
                assert app.state.scan_service.wait(timeout=2)
                completed_response = await client.get("/api/library/scan/status")
                assert completed_response.status_code == 200
                return completed_response.json()

    payload = asyncio.run(get_status())

    assert payload["configured"] is False
    assert payload["available"] is False
    assert "not configured" in payload["configuration_error"]
    assert payload["running"] is False
    assert payload["latest_scan"]["status"] == "failed"
    assert "not configured" in payload["latest_scan"]["error_message"]


class BlockingReader:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def read(self, _path: Path) -> TrackMetadata:
        self.started.set()
        if not self.release.wait(timeout=5):
            raise RuntimeError("Test scan timed out")
        return metadata(title="Blocked")


def test_concurrent_scan_protection(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "blocked.mp3")
    settings = make_settings(tmp_path, library)
    app = create_app(settings)

    async def exercise_api() -> None:
        async with app.router.lifespan_context(app):
            blocking_reader = BlockingReader()
            scanner = LibraryScanner(settings, app.state.catalogue, blocking_reader)
            service = ScanService(scanner, app.state.catalogue)
            app.state.scan_service = service
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                first = await client.post("/api/library/scan")
                assert first.status_code == 202
                assert blocking_reader.started.wait(timeout=2)
                second = await client.post("/api/library/scan")
                assert second.status_code == 409
                health = await client.get("/api/health")
                assert health.status_code == 200
                status_response = await client.get("/api/library/scan/status")
                assert status_response.json()["running"] is True
                blocking_reader.release.set()
                assert service.wait(timeout=2)

    asyncio.run(exercise_api())


def test_scan_service_rejects_second_direct_start(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "blocked.mp3")
    settings = make_settings(tmp_path, library)
    app = create_app(settings)

    async def exercise_service() -> None:
        async with app.router.lifespan_context(app):
            reader = BlockingReader()
            service = ScanService(
                LibraryScanner(settings, app.state.catalogue, reader), app.state.catalogue
            )
            service.start()
            assert reader.started.wait(timeout=2)
            with pytest.raises(ScanAlreadyRunningError):
                service.start()
            reader.release.set()
            assert service.wait(timeout=2)

    asyncio.run(exercise_service())
