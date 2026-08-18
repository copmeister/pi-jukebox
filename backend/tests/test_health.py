import asyncio
from pathlib import Path

import httpx
from pi_jukebox.config import Settings
from pi_jukebox.main import app, create_app


def test_health_check_reports_ready_service() -> None:
    async def make_request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/api/health")

    response = asyncio.run(make_request())

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["application"]
    assert payload["environment"] in {"development", "test", "production"}
    assert payload["version"] == "0.5.0"


def test_production_frontend_is_served_without_vite(tmp_path: Path) -> None:
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / "index.html").write_text("<h1>Production Jukebox</h1>", encoding="utf-8")
    production = create_app(
        Settings(
            _env_file=None,
            environment="production",
            data_directory=tmp_path / "data",
            frontend_directory=frontend,
        )
    )

    async def make_request() -> httpx.Response:
        transport = httpx.ASGITransport(app=production)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/")

    response = asyncio.run(make_request())
    assert response.status_code == 200
    assert "Production Jukebox" in response.text
