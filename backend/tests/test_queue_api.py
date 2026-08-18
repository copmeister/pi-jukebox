import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from conftest import FakeMetadataReader, make_settings, metadata, touch_audio
from pi_jukebox.catalogue.database import count_rows
from pi_jukebox.main import create_app


@asynccontextmanager
async def seeded_api(
    tmp_path: Path,
) -> AsyncIterator[tuple[httpx.AsyncClient, Any, Path, list[dict], list[dict]]]:
    library = tmp_path / "music"
    touch_audio(library, "alpha/01-one.mp3")
    touch_audio(library, "alpha/02-two.flac")
    touch_audio(library, "beta/01-three.mp3")
    settings = make_settings(tmp_path, library)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        app.state.scan_service.scanner.metadata_reader = FakeMetadataReader(
            {
                "01-one.mp3": metadata(
                    title="One", album="Alpha", album_artist="Artist A", track=1
                ),
                "02-two.flac": metadata(
                    title="Two", album="Alpha", album_artist="Artist A", track=2
                ),
                "01-three.mp3": metadata(
                    title="Three", album="Beta", album_artist="Artist B", track=1
                ),
            }
        )
        app.state.scan_service.scanner.scan()
        albums = app.state.catalogue.list_albums()
        tracks = [
            track
            for album in albums
            for track in app.state.catalogue.get_album(album["id"])["tracks"]
        ]
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, app, library, tracks, albums


def assert_positions(snapshot: dict) -> None:
    if snapshot["current"]:
        assert snapshot["current"]["position"] == 0
    assert [item["position"] for item in snapshot["upcoming"]] == list(
        range(1, snapshot["upcoming_count"] + 1)
    )


def test_empty_add_duplicates_play_next_and_play_now(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, _app, _library, tracks, _albums):
            empty = (await client.get("/api/queue")).json()
            assert empty["current"] is None
            assert empty["upcoming"] == []

            first = (await client.post(f"/api/queue/tracks/{tracks[1]['id']}")).json()
            duplicate = (await client.post(f"/api/queue/tracks/{tracks[1]['id']}")).json()
            assert [item["track_id"] for item in duplicate["upcoming"]] == [
                tracks[1]["id"],
                tracks[1]["id"],
            ]
            assert duplicate["upcoming"][0]["id"] != duplicate["upcoming"][1]["id"]
            assert first["current"] is None

            next_snapshot = (await client.post(f"/api/queue/tracks/{tracks[2]['id']}/next")).json()
            assert [item["track_id"] for item in next_snapshot["upcoming"]] == [
                tracks[2]["id"],
                tracks[1]["id"],
                tracks[1]["id"],
            ]

            playing = (await client.post(f"/api/queue/tracks/{tracks[0]['id']}/play-now")).json()
            replaced = (await client.post(f"/api/queue/tracks/{tracks[1]['id']}/play-now")).json()
            assert playing["current"]["track_id"] == tracks[0]["id"]
            assert replaced["current"]["track_id"] == tracks[1]["id"]
            assert [item["track_id"] for item in replaced["upcoming"]] == [
                tracks[2]["id"],
                tracks[1]["id"],
                tracks[1]["id"],
            ]
            assert_positions(replaced)

    asyncio.run(exercise())


def test_add_album_order_and_play_album_replaces_queue(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, _app, _library, tracks, albums):
            added = (await client.post(f"/api/queue/albums/{albums[0]['id']}")).json()
            assert [item["title"] for item in added["upcoming"]] == ["One", "Two"]
            await client.post(f"/api/queue/tracks/{tracks[2]['id']}")

            played = (await client.post(f"/api/queue/albums/{albums[0]['id']}/play")).json()
            assert played["current"]["title"] == "One"
            assert [item["title"] for item in played["upcoming"]] == ["Two"]
            assert_positions(played)

    asyncio.run(exercise())


def test_remove_move_clear_and_position_consistency(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, app, _library, tracks, albums):
            snapshot = (await client.post(f"/api/queue/albums/{albums[0]['id']}/play")).json()
            snapshot = (await client.post(f"/api/queue/tracks/{tracks[2]['id']}")).json()
            current_id = snapshot["current"]["id"]
            first_id, second_id = [item["id"] for item in snapshot["upcoming"]]

            assert (await client.delete(f"/api/queue/items/{current_id}")).status_code == 409
            assert (
                await client.post(f"/api/queue/items/{current_id}/move", json={"direction": "down"})
            ).status_code == 409
            assert (
                await client.post(f"/api/queue/items/{first_id}/move", json={"direction": "up"})
            ).status_code == 409

            moved = (
                await client.post(f"/api/queue/items/{second_id}/move", json={"direction": "up"})
            ).json()
            assert [item["id"] for item in moved["upcoming"]] == [second_id, first_id]
            removed = (await client.delete(f"/api/queue/items/{second_id}")).json()
            assert [item["id"] for item in removed["upcoming"]] == [first_id]
            cleared = (await client.delete("/api/queue/upcoming")).json()
            assert cleared["current"]["id"] == current_id
            assert cleared["upcoming"] == []
            assert_positions(cleared)
            with app.state.catalogue.connect() as connection:
                positions = [
                    row["position"]
                    for row in connection.execute(
                        "SELECT position FROM queue_items ORDER BY position"
                    )
                ]
            assert positions == [0]

    asyncio.run(exercise())


def test_stop_and_clear_removes_complete_queue_and_increments_revision(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, app, _library, tracks, albums):
            snapshot = (await client.post(f"/api/queue/albums/{albums[0]['id']}/play")).json()
            snapshot = (await client.post(f"/api/queue/tracks/{tracks[2]['id']}")).json()
            revision = snapshot["revision"]
            catalogue_counts = {
                "albums": count_rows(app.state.catalogue, "albums"),
                "tracks": count_rows(app.state.catalogue, "tracks"),
            }

            cleared = (await client.delete("/api/queue")).json()

            assert cleared["revision"] == revision + 1
            assert cleared["current"] is None
            assert cleared["upcoming"] == []
            assert count_rows(app.state.catalogue, "queue_items") == 0
            assert count_rows(app.state.catalogue, "albums") == catalogue_counts["albums"]
            assert count_rows(app.state.catalogue, "tracks") == catalogue_counts["tracks"]

            recreated = create_app(app.state.settings)
            async with recreated.router.lifespan_context(recreated):
                assert recreated.state.queue_store.snapshot()["current"] is None
                assert recreated.state.queue_store.snapshot()["upcoming"] == []

    asyncio.run(exercise())


def test_advance_end_of_queue_and_duplicate_event_protection(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, _app, _library, _tracks, albums):
            started = (await client.post(f"/api/queue/albums/{albums[0]['id']}/play")).json()
            first_id = started["current"]["id"]
            advanced = (
                await client.post("/api/queue/advance", json={"current_item_id": first_id})
            ).json()
            assert advanced["current"]["title"] == "Two"
            assert advanced["upcoming"] == []

            repeated = await client.post("/api/queue/advance", json={"current_item_id": first_id})
            assert repeated.status_code == 409
            assert (await client.get("/api/queue")).json()["current"]["title"] == "Two"

            ended = (
                await client.post(
                    "/api/queue/advance",
                    json={"current_item_id": advanced["current"]["id"]},
                )
            ).json()
            assert ended["current"] is None
            assert ended["upcoming"] == []

    asyncio.run(exercise())


def test_queue_persists_after_application_recreation(tmp_path: Path) -> None:
    async def exercise() -> None:
        settings = None
        expected_ids: list[int] = []
        async with seeded_api(tmp_path) as (client, app, _library, tracks, albums):
            settings = app.state.settings
            snapshot = (await client.post(f"/api/queue/albums/{albums[0]['id']}/play")).json()
            snapshot = (await client.post(f"/api/queue/tracks/{tracks[2]['id']}")).json()
            expected_ids = [snapshot["current"]["id"], *[x["id"] for x in snapshot["upcoming"]]]

        recreated = create_app(settings)
        async with recreated.router.lifespan_context(recreated):
            transport = httpx.ASGITransport(app=recreated)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                restored = (await client.get("/api/queue")).json()
                restored_ids = [
                    restored["current"]["id"],
                    *[item["id"] for item in restored["upcoming"]],
                ]
                assert restored_ids == expected_ids

    asyncio.run(exercise())


def test_existing_database_upgrade_preserves_catalogue(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (_client, app, _library, _tracks, _albums):
            catalogue = app.state.catalogue
            assert count_rows(catalogue, "tracks") == 3
            with catalogue.connect() as connection:
                connection.execute("DROP TABLE queue_items")
                connection.execute("DROP TABLE queue_state")
                connection.execute("PRAGMA user_version = 1")
            catalogue.initialize()
            assert count_rows(catalogue, "tracks") == 3
            assert count_rows(catalogue, "queue_items") == 0
            with catalogue.connect() as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
            assert version == 3

    asyncio.run(exercise())


def test_removed_and_missing_tracks_are_skipped_safely(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, app, library, tracks, _albums):
            current = (await client.post(f"/api/queue/tracks/{tracks[0]['id']}/play-now")).json()
            await client.post(f"/api/queue/tracks/{tracks[1]['id']}")
            await client.post(f"/api/queue/tracks/{tracks[2]['id']}")
            (library / "alpha/02-two.flac").unlink()
            app.state.scan_service.scanner.scan()
            (library / "beta/01-three.mp3").unlink()

            before = (await client.get("/api/queue")).json()
            assert before["upcoming"][0]["available"] is False
            advanced = (
                await client.post(
                    "/api/queue/advance", json={"current_item_id": current["current"]["id"]}
                )
            ).json()
            assert advanced["current"] is None
            assert advanced["upcoming"] == []
            assert advanced["warning"] == "Skipped 2 unavailable queued tracks."

    asyncio.run(exercise())


def test_unknown_and_invalid_ids_return_safe_errors(tmp_path: Path) -> None:
    async def exercise() -> None:
        async with seeded_api(tmp_path) as (client, _app, _library, _tracks, _albums):
            assert (await client.post("/api/queue/tracks/99999")).status_code == 404
            assert (await client.post("/api/queue/albums/99999")).status_code == 404
            assert (await client.delete("/api/queue/items/99999")).status_code == 404
            assert (await client.post("/api/queue/tracks/0")).status_code == 422
            assert (
                await client.post("/api/queue/items/1/move", json={"direction": "sideways"})
            ).status_code == 422
            assert (
                await client.post("/api/queue/advance", json={"current_item_id": 0})
            ).status_code == 422

    asyncio.run(exercise())
