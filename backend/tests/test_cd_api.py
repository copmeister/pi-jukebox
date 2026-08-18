import asyncio
from pathlib import Path

import httpx
from conftest import make_settings
from pi_jukebox.main import create_app


class FakeCdService:
    def __init__(self) -> None:
        self.selected = None
        self.cancelled = None

    def status(self):
        return {
            "drive": {
                "configured": True,
                "available": True,
                "disc_present": True,
                "message": "Audio CD detected.",
                "disc": {
                    "disc_id": "abc",
                    "track_count": 1,
                    "track_durations": [61.0],
                },
            },
            "storage": {
                "configured": True,
                "available": True,
                "mounted": True,
                "writable": True,
                "free_bytes": 10000000000,
                "message": "External storage is ready.",
            },
            "metadata_state": "ready",
            "metadata_message": None,
            "release_candidates": [
                {
                    "release_id": "release-1",
                    "title": "Album",
                    "artist": "Artist",
                    "year": "2026",
                    "country": "GB",
                    "edition": "Album",
                    "track_count": 1,
                    "tracks": [
                        {
                            "number": 1,
                            "title": "Song",
                            "artist": "Artist",
                            "duration_seconds": 61.0,
                        }
                    ],
                    "artwork_available": False,
                }
            ],
            "selected_release_id": "release-1",
            "active": False,
            "latest_job": None,
            "rip_action": {
                "action": "start",
                "message": "This release is ready to rip.",
                "source_job_id": None,
            },
        }

    def lookup(self):
        return True

    def select_release(self, release_id):
        self.selected = release_id
        return release_id == "release-1"

    def start_rip(self, release_id):
        assert release_id == "release-1"
        return 7

    def cancel(self, job_id):
        self.cancelled = job_id
        return job_id == 7

    def eject(self):
        return True

    def artwork_path(self, release_id):
        return None


def test_cd_status_and_touch_actions(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, None))
    fake = FakeCdService()

    async def exercise() -> None:
        async with app.router.lifespan_context(app):
            app.state.cd_service = fake
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/cd/status")
                assert response.status_code == 200
                assert response.json()["release_candidates"][0]["title"] == "Album"
                assert response.json()["rip_action"]["action"] == "start"
                assert (await client.post("/api/cd/releases/release-1/select")).status_code == 200
                started = await client.post("/api/cd/rips", json={"release_id": "release-1"})
                assert started.status_code == 202
                assert started.json()["job_id"] == 7
                assert (await client.post("/api/cd/rips/7/cancel")).status_code == 202
                assert (await client.post("/api/cd/eject")).status_code == 200
                assert (await client.get("/api/cd/releases/unknown/artwork")).status_code == 404

    asyncio.run(exercise())
    assert fake.selected == "release-1"
    assert fake.cancelled == 7
