from dataclasses import replace
from pathlib import Path

import pytest
from conftest import FakeMetadataReader, make_settings, metadata, touch_audio
from pi_jukebox.catalogue.models import ArtworkData
from pi_jukebox.cd.metadata import CandidateArtworkCache
from pi_jukebox.cd.models import ReleaseCandidate, ReleaseTrack
from pi_jukebox.cd.store import RipStore
from pi_jukebox.library.deletion import (
    AlbumDeletionBusyError,
    AlbumDeletionService,
    UnsafeAlbumPathError,
)
from pi_jukebox.library.scanner import LibraryScanner
from pi_jukebox.queue.database import QueueStore


def prepared_library(tmp_path: Path):
    library = tmp_path / "music"
    target_one = touch_audio(library, "Target Album/target-one.flac")
    touch_audio(library, "Target Album/target-two.flac")
    touch_audio(library, "Other Album/unrelated.flac")
    (target_one.parent / "Cover.jpg").write_bytes(b"album-local-cover")
    settings = make_settings(tmp_path, library)
    reader = FakeMetadataReader(
        {
            "target-one.flac": replace(
                metadata(
                    title="Target One",
                    artist="Target Artist",
                    album_artist="Target Artist",
                    album="Target Album",
                    track=1,
                ),
                artwork=ArtworkData(b"target-artwork", "image/jpeg"),
            ),
            "target-two.flac": replace(
                metadata(
                    title="Target Two",
                    artist="Target Artist",
                    album_artist="Target Artist",
                    album="Target Album",
                    track=2,
                ),
                artwork=ArtworkData(b"target-artwork", "image/jpeg"),
            ),
            "unrelated.flac": replace(
                metadata(
                    title="Unrelated",
                    artist="Other Artist",
                    album_artist="Other Artist",
                    album="Other Album",
                ),
                artwork=ArtworkData(b"other-artwork", "image/png"),
            ),
        }
    )
    from pi_jukebox.catalogue.database import Catalogue

    catalogue = Catalogue(settings.database_path)
    catalogue.initialize()
    scanner = LibraryScanner(settings, catalogue, reader)
    scanner.scan()
    albums = {album["title"]: album for album in catalogue.list_albums()}
    target = catalogue.get_album(albums["Target Album"]["id"])
    other = catalogue.get_album(albums["Other Album"]["id"])
    assert target is not None and other is not None
    candidate_cache = CandidateArtworkCache(settings.cd_artwork_directory)
    service = AlbumDeletionService(
        settings,
        catalogue,
        candidate_cache,
        scan_active=lambda: False,
        rip_active=lambda: False,
    )
    return settings, catalogue, candidate_cache, service, target, other


def test_delete_album_removes_files_artwork_state_and_preserves_unrelated_album(
    tmp_path: Path,
) -> None:
    settings, catalogue, candidate_cache, service, target, other = prepared_library(tmp_path)
    queue = QueueStore(catalogue)
    queue.play_album(target["tracks"])
    queue.add_track(other["tracks"][0])

    release = ReleaseCandidate(
        release_id="release-target",
        title="Target Album",
        artist="Target Artist",
        year="2026",
        country="GB",
        edition="Album",
        track_count=2,
        tracks=(
            ReleaseTrack(1, "Target One", "Target Artist", 123),
            ReleaseTrack(2, "Target Two", "Target Artist", 123),
        ),
    )
    rip_store = RipStore(catalogue)
    ready_paths = {
        int(track["track_number"]): str(track["relative_path"]) for track in target["tracks"]
    }
    job_id = rip_store.create_job("disc-target", release, ready_paths=ready_paths)
    rip_store.set_job_state(job_id, "completed", finished=True)
    candidate_path = candidate_cache.store(release.release_id, b"candidate-cover")
    target_artwork = catalogue.get_artwork(int(target["artwork_id"]))
    assert target_artwork is not None
    runtime_artwork_path = settings.artwork_directory / target_artwork["cache_filename"]

    result = service.delete(int(target["id"]))

    assert result["files_removed"] == 2
    assert result["album_artwork_removed"] == 1
    assert result["runtime_artwork_removed"] is True
    assert result["cd_artwork_removed"] == 1
    assert result["rip_jobs_removed"] == 1
    assert result["queue_items_removed"] == 2
    assert result["current_queue_item_removed"] is True
    assert catalogue.get_album(int(target["id"])) is None
    assert catalogue.get_album(int(other["id"])) is not None
    assert not (settings.validated_library_root() / "Target Album").exists()
    assert not runtime_artwork_path.exists()
    assert not candidate_path.exists()
    assert rip_store.latest_for_disc_release("disc-target", "release-target") is None
    snapshot = queue.snapshot()
    assert snapshot["current"]["album_id"] == other["id"]
    assert snapshot["upcoming"] == []


def test_delete_album_handles_already_missing_music_file(tmp_path: Path) -> None:
    settings, catalogue, _cache, service, target, _other = prepared_library(tmp_path)
    first = settings.validated_library_root() / target["tracks"][0]["relative_path"]
    first.unlink()

    result = service.delete(int(target["id"]))

    assert result["missing_files"] == 1
    assert result["files_removed"] == 1
    assert catalogue.get_album(int(target["id"])) is None


@pytest.mark.parametrize("unsafe_path", ["../outside.flac", ".", "ABSOLUTE"])
def test_delete_album_rejects_traversal_root_and_outside_paths(
    tmp_path: Path, unsafe_path: str
) -> None:
    settings, catalogue, _cache, service, target, other = prepared_library(tmp_path)
    outside = tmp_path / "outside.flac"
    outside.write_bytes(b"outside")
    original = settings.validated_library_root() / target["tracks"][0]["relative_path"]
    stored_path = str(outside.resolve()) if unsafe_path == "ABSOLUTE" else unsafe_path
    with catalogue.connect() as connection:
        connection.execute(
            "UPDATE tracks SET relative_path = ? WHERE id = ?",
            (stored_path, target["tracks"][0]["id"]),
        )

    with pytest.raises(UnsafeAlbumPathError):
        service.delete(int(target["id"]))

    assert original.exists()
    assert outside.exists()
    assert catalogue.get_album(int(target["id"])) is not None
    assert catalogue.get_album(int(other["id"])) is not None


@pytest.mark.parametrize("busy_source", ["scan", "rip"])
def test_delete_album_rejects_active_scan_or_rip(tmp_path: Path, busy_source: str) -> None:
    settings, catalogue, cache, _service, target, _other = prepared_library(tmp_path)
    service = AlbumDeletionService(
        settings,
        catalogue,
        cache,
        scan_active=lambda: busy_source == "scan",
        rip_active=lambda: busy_source == "rip",
    )

    with pytest.raises(AlbumDeletionBusyError):
        service.delete(int(target["id"]))

    assert catalogue.get_album(int(target["id"])) is not None
