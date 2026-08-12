import asyncio

import httpx
from pi_jukebox.main import app


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
