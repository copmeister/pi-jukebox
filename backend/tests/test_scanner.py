import os
import wave
from pathlib import Path

import pytest
from conftest import make_scanner, metadata, touch_audio
from mutagen.id3 import APIC, TALB, TIT2, TPE1, TPE2, TPOS, TRCK
from mutagen.wave import WAVE
from pi_jukebox.catalogue.database import count_rows
from pi_jukebox.library.scanner import FORMAT_SUPPORT


def test_empty_library_completes_with_no_albums(tmp_path: Path) -> None:
    library = tmp_path / "music"
    library.mkdir()
    scanner, catalogue, _reader = make_scanner(tmp_path, library, {})

    result = scanner.scan()

    assert result["status"] == "completed"
    assert result["files_discovered"] == 0
    assert catalogue.list_albums() == []


def test_reads_generated_tagged_wav_and_embedded_artwork(tmp_path: Path) -> None:
    library = tmp_path / "music"
    library.mkdir()
    audio_path = library / "tagged.wav"
    with wave.open(str(audio_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\x00\x00" * 800)

    tagged_audio = WAVE(audio_path)
    tagged_audio.add_tags()
    tagged_audio.tags.add(TIT2(encoding=3, text=["Synthetic Song"]))
    tagged_audio.tags.add(TPE1(encoding=3, text=["Synthetic Artist"]))
    tagged_audio.tags.add(TPE2(encoding=3, text=["Synthetic Album Artist"]))
    tagged_audio.tags.add(TALB(encoding=3, text=["Synthetic Album"]))
    tagged_audio.tags.add(TPOS(encoding=3, text=["2/2"]))
    tagged_audio.tags.add(TRCK(encoding=3, text=["4/9"]))
    tagged_audio.tags.add(
        APIC(encoding=3, mime="image/png", type=3, desc="Cover", data=b"synthetic-image")
    )
    tagged_audio.save()
    scanner, catalogue, _reader = make_scanner(tmp_path, library)

    result = scanner.scan()
    album = catalogue.list_albums()[0]
    detail = catalogue.get_album(album["id"])

    assert result["files_added"] == 1
    assert detail is not None
    assert detail["album_artist"] == "Synthetic Album Artist"
    assert detail["title"] == "Synthetic Album"
    assert detail["artwork_id"] is not None
    assert detail["tracks"][0]["title"] == "Synthetic Song"
    assert detail["tracks"][0]["artist"] == "Synthetic Artist"
    assert detail["tracks"][0]["disc_number"] == 2
    assert detail["tracks"][0]["track_number"] == 4
    artwork = catalogue.get_artwork(detail["artwork_id"])
    assert artwork is not None
    artwork_path = scanner.settings.artwork_directory / artwork["cache_filename"]
    assert artwork_path.read_bytes() == b"synthetic-image"


def test_missing_metadata_uses_safe_fallbacks(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "No Tags.mp3", b"not a real mp3")
    scanner, catalogue, _reader = make_scanner(tmp_path, library)

    result = scanner.scan()
    album = catalogue.get_album(catalogue.list_albums()[0]["id"])
    track = album["tracks"][0] if album else None

    assert result["status"] == "completed"
    assert track is not None
    assert track["title"] == "No Tags"
    assert track["artist"] == "Unknown Artist"
    assert track["album_artist"] == "Unknown Artist"
    assert track["album"] == "Unknown Album"


def test_repeat_scan_does_not_duplicate_tracks(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "one.mp3")
    scanner, catalogue, reader = make_scanner(tmp_path, library, {"one.mp3": metadata(title="One")})

    first = scanner.scan()
    second = scanner.scan()

    assert first["files_added"] == 1
    assert second["files_unchanged"] == 1
    assert count_rows(catalogue, "tracks") == 1
    assert reader is not None and reader.calls == ["one.mp3"]


def test_changed_file_updates_existing_track(tmp_path: Path) -> None:
    library = tmp_path / "music"
    audio_path = touch_audio(library, "changing.flac")
    original = metadata(title="Original")
    scanner, catalogue, reader = make_scanner(tmp_path, library, {"changing.flac": original})
    scanner.scan()
    original_track = catalogue.get_album(catalogue.list_albums()[0]["id"])["tracks"][0]

    assert reader is not None
    reader.metadata_by_name["changing.flac"] = metadata(title="Updated")
    previous_mtime = audio_path.stat().st_mtime_ns
    audio_path.write_bytes(b"changed synthetic audio")
    os.utime(audio_path, ns=(previous_mtime + 1_000_000, previous_mtime + 1_000_000))
    result = scanner.scan()
    updated_track = catalogue.get_album(catalogue.list_albums()[0]["id"])["tracks"][0]

    assert result["files_updated"] == 1
    assert count_rows(catalogue, "tracks") == 1
    assert updated_track["id"] == original_track["id"]
    assert updated_track["title"] == "Updated"


def test_removed_file_is_removed_from_catalogue(tmp_path: Path) -> None:
    library = tmp_path / "music"
    audio_path = touch_audio(library, "remove.mp3")
    scanner, catalogue, _reader = make_scanner(
        tmp_path, library, {"remove.mp3": metadata(title="Remove")}
    )
    scanner.scan()

    audio_path.unlink()
    result = scanner.scan()

    assert result["files_removed"] == 1
    assert count_rows(catalogue, "tracks") == 0
    assert count_rows(catalogue, "albums") == 0


def test_album_grouping_uses_album_artist_and_title(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "duet-a.mp3")
    touch_audio(library, "duet-b.mp3")
    scanner, catalogue, _reader = make_scanner(
        tmp_path,
        library,
        {
            "duet-a.mp3": metadata(
                title="Part A", artist="Singer A", album_artist="Various Artists", track=1
            ),
            "duet-b.mp3": metadata(
                title="Part B", artist="Singer B", album_artist="Various Artists", track=2
            ),
        },
    )

    scanner.scan()
    albums = catalogue.list_albums()

    assert len(albums) == 1
    assert albums[0]["album_artist"] == "Various Artists"
    assert albums[0]["track_count"] == 2


def test_album_tracks_are_ordered_by_disc_then_track(tmp_path: Path) -> None:
    library = tmp_path / "music"
    names = ("disc-two.mp3", "second.mp3", "first.mp3", "unknown.mp3")
    for name in names:
        touch_audio(library, name)
    scanner, catalogue, _reader = make_scanner(
        tmp_path,
        library,
        {
            "disc-two.mp3": metadata(title="Disc two", disc=2, track=1),
            "second.mp3": metadata(title="Second", disc=1, track=2),
            "first.mp3": metadata(title="First", disc=1, track=1),
            "unknown.mp3": metadata(title="Unknown order", disc=None, track=None),
        },
    )

    scanner.scan()
    album = catalogue.get_album(catalogue.list_albums()[0]["id"])

    assert album is not None
    assert [track["title"] for track in album["tracks"]] == [
        "First",
        "Second",
        "Disc two",
        "Unknown order",
    ]


def test_duplicate_track_numbers_are_grouped_by_disc_before_track(tmp_path: Path) -> None:
    library = tmp_path / "music"
    tracks = {
        "d2t2.mp3": metadata(title="Disc 2 Track 2", disc=2, track=2),
        "d1t2.mp3": metadata(title="Disc 1 Track 2", disc=1, track=2),
        "d2t1.mp3": metadata(title="Disc 2 Track 1", disc=2, track=1),
        "d1t1.mp3": metadata(title="Disc 1 Track 1", disc=1, track=1),
    }
    for name in tracks:
        touch_audio(library, name)
    scanner, catalogue, _reader = make_scanner(tmp_path, library, tracks)

    scanner.scan()
    album = catalogue.get_album(catalogue.list_albums()[0]["id"])

    assert album is not None
    assert [track["title"] for track in album["tracks"]] == [
        "Disc 1 Track 1",
        "Disc 1 Track 2",
        "Disc 2 Track 1",
        "Disc 2 Track 2",
    ]


def test_single_disc_and_missing_disc_numbers_keep_safe_track_order(tmp_path: Path) -> None:
    library = tmp_path / "music"
    tracks = {
        "third.mp3": metadata(title="Unknown disc", disc=None, track=3),
        "second.mp3": metadata(title="Second", disc=1, track=2),
        "first.mp3": metadata(title="First", disc=1, track=1),
    }
    for name in tracks:
        touch_audio(library, name)
    scanner, catalogue, _reader = make_scanner(tmp_path, library, tracks)

    scanner.scan()
    album = catalogue.get_album(catalogue.list_albums()[0]["id"])

    assert album is not None
    assert [track["title"] for track in album["tracks"]] == [
        "First",
        "Second",
        "Unknown disc",
    ]


@pytest.mark.parametrize("library_kind", ["unconfigured", "missing", "file"])
def test_invalid_library_configuration_fails_gracefully(tmp_path: Path, library_kind: str) -> None:
    if library_kind == "unconfigured":
        library_path = None
    elif library_kind == "missing":
        library_path = tmp_path / "does-not-exist"
    else:
        library_path = tmp_path / "not-a-folder"
        library_path.write_text("not a directory")
    scanner, catalogue, _reader = make_scanner(tmp_path, library_path, {})

    result = scanner.scan()

    assert result["status"] == "failed"
    assert result["error_message"]
    assert count_rows(catalogue, "tracks") == 0


def test_provisional_formats_are_catalogued_as_provisional(tmp_path: Path) -> None:
    library = tmp_path / "music"
    touch_audio(library, "future.m4a")
    scanner, catalogue, _reader = make_scanner(
        tmp_path, library, {"future.m4a": metadata(title="Future")}
    )

    scanner.scan()
    track = catalogue.get_album(catalogue.list_albums()[0]["id"])["tracks"][0]

    assert FORMAT_SUPPORT[".m4a"] == ("m4a", "provisional")
    assert track["playback_support"] == "provisional"
