from __future__ import annotations

from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from pi_jukebox.config import Settings
from pi_jukebox.main import create_app
from pi_jukebox.radio.metadata import RadioMetadataService, RadioNowPlaying


def _icy_stream(title: str, interval: int = 8) -> bytes:
    metadata = f"StreamTitle='{title}';".encode()
    blocks = max(1, (len(metadata) + 15) // 16)
    return b"a" * interval + bytes([blocks]) + metadata.ljust(blocks * 16, b"\0")


def _service(
    title: str,
    *,
    station_url: str = "https://media-ice.musicradio.com/ClassicFMMP3",
) -> RadioMetadataService:
    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == station_url
        assert request.headers["Icy-MetaData"] == "1"
        return httpx.Response(
            200,
            headers={"icy-metaint": "8"},
            stream=httpx.ByteStream(_icy_stream(title)),
        )

    return RadioMetadataService(
        Settings(_env_file=None, radio_metadata_cache_seconds=0),
        httpx.Client(transport=httpx.MockTransport(respond)),
    )


def test_reads_and_sanitises_music_track_metadata() -> None:
    metadata = _service("Edward Elgar - Nimrod").fetch("classic-fm")

    assert metadata.available is True
    assert metadata.kind == "track"
    assert metadata.artist == "Edward Elgar"
    assert metadata.title == "Nimrod"
    assert metadata.text == "Edward Elgar — Nimrod"


def test_preserves_programme_metadata_without_inventing_track_fields() -> None:
    metadata = _service(
        "Leading Britain's Conversation - James O'Brien",
        station_url="https://media-ice.musicradio.com/LBCUKMP3",
    ).fetch("lbc")

    assert metadata.kind == "programme"
    assert metadata.text == "Leading Britain's Conversation - James O'Brien"
    assert metadata.artist is None
    assert metadata.title is None


def test_blank_or_unavailable_metadata_has_an_honest_fallback() -> None:
    blank = _service("").fetch("classic-fm")

    def fail(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline")

    unavailable = RadioMetadataService(
        Settings(_env_file=None, radio_metadata_cache_seconds=0),
        httpx.Client(transport=httpx.MockTransport(fail)),
    ).fetch("classic-fm")

    assert blank == RadioNowPlaying(station_id="classic-fm", kind="none")
    assert unavailable == RadioNowPlaying(station_id="classic-fm", kind="none")


class _FakeMetadataService:
    def fetch(self, station_id: str) -> RadioNowPlaying:
        if station_id != "classic-fm":
            raise KeyError(station_id)
        return RadioNowPlaying(
            station_id=station_id,
            kind="track",
            text="Gustav Holst — Jupiter",
            artist="Gustav Holst",
            title="Jupiter",
        )

    def close(self) -> None:
        pass


def test_radio_metadata_api_returns_metadata_and_rejects_unknown_station(
    tmp_path: Path,
) -> None:
    app = create_app(
        Settings(
            _env_file=None,
            environment="test",
            data_directory=tmp_path,
            update_check_enabled=False,
        )
    )
    with TestClient(app) as client:
        app.state.radio_metadata_service = _FakeMetadataService()

        response = client.get("/api/radio/stations/classic-fm/now-playing")
        unknown = client.get("/api/radio/stations/not-a-station/now-playing")

    assert response.status_code == 200
    assert response.json() == {
        "station_id": "classic-fm",
        "available": True,
        "kind": "track",
        "text": "Gustav Holst — Jupiter",
        "artist": "Gustav Holst",
        "title": "Jupiter",
    }
    assert unknown.status_code == 404
