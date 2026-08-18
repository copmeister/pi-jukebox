import threading
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from conftest import metadata
from pi_jukebox.catalogue.database import Catalogue, count_rows, utc_now
from pi_jukebox.cd.hardware import (
    CdHardware,
    CommandResult,
    DiscReadError,
    LibdiscidReader,
)
from pi_jukebox.cd.metadata import MetadataLookupError, MusicMetadataClient
from pi_jukebox.cd.models import DiscLayout, DriveState, ReleaseCandidate, ReleaseTrack
from pi_jukebox.cd.ripper import (
    MutagenFinalizedTrackVerifier,
    RipAlreadyRunningError,
    RipConflictError,
    RipService,
)
from pi_jukebox.cd.storage import StorageGuard, StorageSafetyError
from pi_jukebox.cd.store import RipStore
from pi_jukebox.config import Settings
from pi_jukebox.library.scanner import LibraryScanner, ScanService


class FakeRunner:
    def __init__(self, *, disc_output: str = "") -> None:
        self.disc_output = disc_output
        self.commands: list[list[str]] = []
        self.block_track: int | None = None
        self.block_stage: str | None = None
        self.fail_track: int | None = None
        self.fail_stage: str | None = None
        self.entered = threading.Event()

    def run(self, arguments: list[str], *, timeout: float | None = None) -> CommandResult:
        self.commands.append(arguments)
        return CommandResult(0 if self.disc_output else 1, self.disc_output, "")

    def run_cancellable(
        self,
        arguments: list[str],
        *,
        cancel: threading.Event,
        nice: int | None = None,
    ) -> CommandResult:
        self.commands.append(arguments)
        stage = "reading" if arguments[0] == "cdparanoia" else "encoding"
        track = (
            int(arguments[3]) if stage == "reading" else int(Path(arguments[-1]).stem.split("-")[1])
        )
        if self.block_track == track and self.block_stage == stage:
            self.entered.set()
            cancel.wait(3)
            return CommandResult(1, "", "cancelled")
        if self.fail_track == track and self.fail_stage == stage:
            return CommandResult(1, "", "scratched")
        if stage == "reading":
            Path(arguments[-1]).write_bytes(b"synthetic wav")
        else:
            output = next(
                value.split("=", 1)[1] for value in arguments if value.startswith("--output-name=")
            )
            Path(output).write_bytes(b"synthetic flac")
        return CommandResult(0, "", "")


class FakeHardware:
    def __init__(self, disc: DiscLayout) -> None:
        self.disc = disc

    def probe(self) -> DriveState:
        return DriveState(True, True, True, "Audio CD detected.", self.disc)


class FakeDiscReader:
    def __init__(self, disc: DiscLayout | None = None) -> None:
        self.disc = disc
        self.devices: list[str] = []

    def read(self, device: str) -> DiscLayout:
        self.devices.append(device)
        if self.disc is None:
            raise DiscReadError("no audio disc")
        return self.disc


class AnyMetadataReader:
    def read(self, path: Path):
        number = int(path.name.split(" ", 1)[0])
        return metadata(title=f"Song {number}", track=number)


class FakeTagger:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def tag(self, path: Path, *, release, track, artwork) -> None:
        self.calls.append(track.number)


class FakeFinalizedTrackVerifier:
    def __init__(self) -> None:
        self.rejected: set[int] = set()
        self.calls: list[int] = []

    def matches(self, path: Path, *, release, track) -> bool:
        self.calls.append(track.number)
        return path.is_file() and track.number not in self.rejected


class BlockingTagger(FakeTagger):
    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()

    def tag(self, path: Path, *, release, track, artwork) -> None:
        super().tag(path, release=release, track=track, artwork=artwork)
        self.entered.set()
        self.release.wait(3)


def wait_until(predicate, timeout: float = 3) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition did not become true")


def rip_fixture(
    tmp_path: Path,
    *,
    free: int = 10_000_000_000,
    track_count: int = 2,
):
    mount = tmp_path / "jukebox"
    library = mount / "Music"
    library.mkdir(parents=True, exist_ok=True)
    settings = Settings(
        _env_file=None,
        environment="test",
        data_directory=tmp_path / "data",
        music_library_path=library,
        optical_drive_path=tmp_path / "sr0",
        external_storage_path=mount,
        rip_output_path=library,
        cd_minimum_free_bytes=1000,
    )
    settings.optical_drive_path.write_bytes(b"")
    catalogue = Catalogue(settings.database_path)
    catalogue.initialize()
    scanner = LibraryScanner(settings, catalogue, metadata_reader=AnyMetadataReader())
    scans = ScanService(scanner, catalogue)
    store = RipStore(catalogue)
    storage = StorageGuard(
        settings,
        mounted=lambda _path: True,
        free_bytes=lambda _path: free,
        writable=lambda _path: True,
    )
    disc = DiscLayout(
        "abc123",
        track_count,
        tuple(60.0 + number for number in range(1, track_count + 1)),
    )
    runner = FakeRunner()
    tagger = FakeTagger()
    verifier = FakeFinalizedTrackVerifier()
    ripper = RipService(
        settings,
        store,
        storage,
        FakeHardware(disc),  # type: ignore[arg-type]
        scans,
        runner=runner,
        tagger=tagger,
        finalized_verifier=verifier,
    )
    titles = [
        "First / Song",
        "Second Song",
        *(f"Track {number}" for number in range(3, track_count + 1)),
    ]
    artists = ["Test Artist", "Guest", *("Test Artist" for _ in range(3, track_count + 1))]
    release = ReleaseCandidate(
        "release-1",
        "Test Album",
        "Test Artist",
        "2026",
        "GB",
        "Album",
        track_count,
        tuple(
            ReleaseTrack(number, titles[number - 1], artists[number - 1], 60.0 + number)
            for number in range(1, track_count + 1)
        ),
    )
    return settings, catalogue, store, ripper, runner, release, disc


def test_drive_absent_empty_and_audio_disc(tmp_path: Path) -> None:
    unconfigured = Settings(_env_file=None, optical_drive_path=None)
    assert CdHardware(unconfigured, FakeRunner()).probe().configured is False

    drive = tmp_path / "sr0"
    drive.write_bytes(b"")
    settings = Settings(_env_file=None, optical_drive_path=drive)
    assert CdHardware(settings, FakeRunner(), FakeDiscReader()).probe().disc_present is False

    layout = DiscLayout(
        "deadbeef",
        2,
        (60.0, 62.0),
        "I5l9cCSFccLKFEKS.7wqSZAorPU-",
        "1 2 9300 150 4650",
    )
    assert layout.track_count == 2
    assert layout.track_durations[0] == 60
    assert layout.track_durations[1] == 62
    reader = FakeDiscReader(layout)
    detected = CdHardware(settings, FakeRunner(), reader)
    assert detected.probe().disc == layout
    assert reader.devices == [str(drive)]


def test_libdiscid_reader_separates_local_and_musicbrainz_identifiers() -> None:
    raw_disc = SimpleNamespace(
        id="I5l9cCSFccLKFEKS.7wqSZAorPU-",
        freedb_id="e310b410",
        toc_string="1 2 9300 150 4650",
        tracks=[SimpleNamespace(sectors=4500), SimpleNamespace(sectors=4650)],
    )
    layout = LibdiscidReader(lambda device: raw_disc).read("/dev/sr0")

    assert layout.disc_id == "e310b410"
    assert layout.musicbrainz_disc_id == "I5l9cCSFccLKFEKS.7wqSZAorPU-"
    assert layout.musicbrainz_toc == "1 2 9300 150 4650"
    assert layout.track_durations == (60.0, 62.0)


class FakeResponse:
    def __init__(self, payload=None, *, status=200, content=b"", content_type="image/jpeg"):
        self.payload = payload
        self.status_code = status
        self.content = content
        self.headers = {"content-type": content_type}

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://musicbrainz.test/discid/example")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("failed", request=request, response=response)


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


MUSICBRAINZ_DISC_ID = "I5l9cCSFccLKFEKS.7wqSZAorPU-"
MUSICBRAINZ_TOC = "1 1 4725 150"


def musicbrainz_payload(release_count: int = 1):
    titles = [
        "Just",
        "Paranoid Android",
        "Karma Police",
        "Creep",
        "No Surprises",
        "High and Dry",
        "My Iron Lung",
        "There There",
        "Lucky",
        "Optimistic",
        "Fake Plastic Trees",
        "Idioteque",
        "2 + 2 = 5",
        "The Bends",
        "Pyramid Song",
        "Street Spirit (Fade Out)",
        "Everything in Its Right Place",
    ]
    releases = []
    for index in range(release_count):
        releases.append(
            {
                "id": f"release-{index}",
                "title": "The Best Of",
                "status": "Official",
                "artist-credit": [
                    {
                        "name": "Radiohead",
                        "artist": {"id": "artist-radiohead", "name": "Radiohead"},
                    }
                ],
                "date": "2008-06-03",
                "country": "US",
                "release-group": {
                    "id": "release-group-best-of",
                    "primary-type": "Album",
                },
                "media": [
                    {
                        "position": 1,
                        "format": "CD",
                        "track-count": len(titles),
                        "discs": [{"id": MUSICBRAINZ_DISC_ID}],
                        "tracks": [
                            {
                                "id": f"track-{track_number}",
                                "position": track_number,
                                "number": str(track_number),
                                "title": title,
                                "length": 240000,
                                "recording": {
                                    "id": f"recording-{track_number}",
                                    "title": title,
                                    "artist-credit": [{"name": "Radiohead"}],
                                },
                            }
                            for track_number, title in enumerate(titles, start=1)
                        ],
                    }
                ],
            }
        )
    return {
        "id": MUSICBRAINZ_DISC_ID,
        "sectors": 342675,
        "offsets": [150],
        "releases": releases,
    }


def test_musicbrainz_single_multiple_timeout_and_artwork() -> None:
    settings = Settings(_env_file=None, metadata_retry_count=0)
    disc = DiscLayout(
        "e310b410",
        1,
        (61.0,),
        MUSICBRAINZ_DISC_ID,
        MUSICBRAINZ_TOC,
    )
    one_http = FakeHttp([FakeResponse(musicbrainz_payload())])
    one = MusicMetadataClient(settings, one_http)
    candidate = one.releases_for_disc(disc)[0]
    assert candidate.title == "The Best Of"
    assert candidate.artist == "Radiohead"
    assert candidate.track_count == 17
    assert candidate.tracks[0].title == "Just"
    assert candidate.tracks[0].artist == "Radiohead"
    url, kwargs = one_http.calls[0]
    assert url.endswith(f"/discid/{MUSICBRAINZ_DISC_ID}")
    assert "e310b410" not in url
    assert kwargs["params"]["inc"] == "artists+recordings+release-groups"
    assert kwargs["params"]["toc"] == MUSICBRAINZ_TOC
    assert kwargs["params"]["cdstubs"] == "no"
    multiple = MusicMetadataClient(settings, FakeHttp([FakeResponse(musicbrainz_payload(2))]))
    assert len(multiple.releases_for_disc(disc)) == 2
    timeout = MusicMetadataClient(settings, FakeHttp([httpx.TimeoutException("offline")]))
    with pytest.raises(MetadataLookupError):
        timeout.releases_for_disc(disc)
    no_art = MusicMetadataClient(settings, FakeHttp([FakeResponse(status=404)]))
    assert no_art.fetch_front_cover("missing") is None
    cover = MusicMetadataClient(settings, FakeHttp([FakeResponse(content=b"jpeg")]))
    assert cover.fetch_front_cover("release") == (b"jpeg", "image/jpeg")


def test_musicbrainz_logs_http_and_parsing_failures_without_response_body(caplog) -> None:
    settings = Settings(_env_file=None, metadata_retry_count=0)
    disc = DiscLayout("e310b410", 1, (61.0,), MUSICBRAINZ_DISC_ID, MUSICBRAINZ_TOC)
    caplog.set_level("INFO", logger="pi_jukebox.cd.metadata")

    malformed = MusicMetadataClient(settings, FakeHttp([FakeResponse(["not", "an", "object"])]))
    with pytest.raises(MetadataLookupError, match="unreadable release information"):
        malformed.releases_for_disc(disc)
    assert "MusicBrainz disc lookup returned HTTP 200" in caplog.text
    assert "MusicBrainz response parsing failed (AttributeError)" in caplog.text

    caplog.clear()
    rejected = MusicMetadataClient(
        settings,
        FakeHttp([FakeResponse(status=400, content=b"response body must not be logged")]),
    )
    with pytest.raises(MetadataLookupError, match="unavailable right now"):
        rejected.releases_for_disc(disc)
    assert "MusicBrainz disc lookup failed with HTTP 400" in caplog.text
    assert "online metadata fallback will be used" in caplog.text
    assert "response body must not be logged" not in caplog.text


def test_short_cddb_id_is_never_sent_as_musicbrainz_disc_id() -> None:
    http = FakeHttp([])
    client = MusicMetadataClient(Settings(_env_file=None), http)
    invalid = DiscLayout("e310b410", 1, (61.0,), "e310b410", MUSICBRAINZ_TOC)

    with pytest.raises(MetadataLookupError, match="valid MusicBrainz Disc ID"):
        client.releases_for_disc(invalid)

    assert http.calls == []


def test_external_storage_mount_space_and_confinement(tmp_path: Path) -> None:
    settings, *_ = rip_fixture(tmp_path)
    assert not StorageGuard(settings, mounted=lambda _path: False).status().available
    low = StorageGuard(
        settings,
        mounted=lambda _path: True,
        free_bytes=lambda _path: 10,
        writable=lambda _path: True,
    )
    with pytest.raises(StorageSafetyError):
        low.require_safe_output()
    settings.rip_output_path = tmp_path
    outside = StorageGuard(settings, mounted=lambda _path: True)
    assert "outside" in outside.status().message


def test_finalized_track_verification_requires_matching_release_tags(
    tmp_path: Path, monkeypatch
) -> None:
    _settings, _catalogue, _store, _ripper, _runner, release, _disc = rip_fixture(tmp_path)
    tags = {
        "tracknumber": ["1"],
        "title": ["First / Song"],
        "artist": ["Test Artist"],
        "album": ["Test Album"],
        "albumartist": ["Test Artist"],
        "musicbrainz_albumid": ["release-1"],
    }
    monkeypatch.setattr("pi_jukebox.cd.ripper.FLAC", lambda _path: tags)

    verifier = MutagenFinalizedTrackVerifier()
    assert verifier.matches(tmp_path / "track.flac", release=release, track=release.tracks[0])
    tags["musicbrainz_albumid"] = ["different-release"]
    assert not verifier.matches(tmp_path / "track.flac", release=release, track=release.tracks[0])


def test_track_is_atomic_and_playable_before_album_finishes(tmp_path: Path) -> None:
    _settings, catalogue, store, ripper, runner, release, disc = rip_fixture(tmp_path)
    runner.block_track = 2
    runner.block_stage = "reading"
    job_id = ripper.start(disc, release, (b"cover", "image/jpeg"))
    wait_until(lambda: runner.entered.is_set())

    job = store.get_job(job_id)
    assert job and job["tracks"][0]["state"] == "ready"
    assert job["tracks"][1]["state"] == "reading"
    assert count_rows(catalogue, "tracks") == 1
    final = tmp_path / "jukebox" / "Music" / "Test Artist" / "Test Album"
    assert (final / "01 - First _ Song.flac").is_file()
    assert (final / "Cover.jpg").read_bytes() == b"cover"
    assert not list(final.glob("*.partial*"))

    assert ripper.cancel(job_id)
    assert ripper.wait()
    job = store.get_job(job_id)
    assert job and job["status"] == "cancelled"
    assert count_rows(catalogue, "tracks") == 1


def test_successful_multi_track_rip_without_artwork(tmp_path: Path) -> None:
    _settings, catalogue, store, ripper, _runner, release, disc = rip_fixture(tmp_path)
    with catalogue.connect() as connection:
        connection.execute(
            """
            INSERT INTO queue_items (
                track_id, album_id, title, artist, album, duration_seconds,
                artwork_id, position, created_at
            ) VALUES (999, 999, 'Existing', 'Artist', 'Album', 60, NULL, 0, ?)
            """,
            (utc_now(),),
        )
    job_id = ripper.start(disc, release, None)
    assert ripper.wait()
    job = store.get_job(job_id)
    assert job and job["status"] == "completed"
    assert [track["state"] for track in job["tracks"]] == ["ready", "ready"]
    assert count_rows(catalogue, "tracks") == 2
    assert count_rows(catalogue, "queue_items") == 1


def test_scratched_track_does_not_expose_partial_or_stop_later_track(tmp_path: Path) -> None:
    settings, catalogue, store, ripper, runner, release, disc = rip_fixture(tmp_path)
    runner.fail_track = 1
    runner.fail_stage = "reading"
    job_id = ripper.start(disc, release, None)
    assert ripper.wait()
    job = store.get_job(job_id)
    assert job and job["status"] == "partial"
    assert [track["state"] for track in job["tracks"]] == ["error", "ready"]
    assert count_rows(catalogue, "tracks") == 1
    assert not list(settings.music_library_path.rglob("*.partial*"))


@pytest.mark.parametrize("stage", ["reading", "encoding"])
def test_cancellation_during_process_stages_is_safe(tmp_path: Path, stage: str) -> None:
    _settings, catalogue, store, ripper, runner, release, disc = rip_fixture(tmp_path)
    runner.block_track = 1
    runner.block_stage = stage
    job_id = ripper.start(disc, release, None)
    assert runner.entered.wait(2)
    assert ripper.cancel(job_id)
    assert ripper.wait()
    job = store.get_job(job_id)
    assert job and job["tracks"][0]["state"] == "cancelled"
    assert count_rows(catalogue, "tracks") == 0


def test_cancellation_during_tagging_prevents_finalisation(tmp_path: Path) -> None:
    settings, catalogue, store, ripper, runner, release, disc = rip_fixture(tmp_path)
    tagger = BlockingTagger()
    ripper.tagger = tagger
    job_id = ripper.start(disc, release, None)
    assert tagger.entered.wait(2)
    assert ripper.cancel(job_id)
    tagger.release.set()
    assert ripper.wait()
    job = store.get_job(job_id)
    assert job and job["tracks"][0]["state"] == "cancelled"
    assert count_rows(catalogue, "tracks") == 0
    assert not list(settings.music_library_path.rglob("*.flac"))


def test_simultaneous_job_and_existing_track_conflicts(tmp_path: Path) -> None:
    settings, _catalogue, _store, ripper, runner, release, disc = rip_fixture(tmp_path)
    runner.block_track = 1
    runner.block_stage = "reading"
    job_id = ripper.start(disc, release, None)
    assert runner.entered.wait(2)
    with pytest.raises(RipAlreadyRunningError):
        ripper.start(disc, release, None)
    ripper.cancel(job_id)
    ripper.wait()

    conflict = settings.rip_output_path / "Test Artist" / "Test Album" / "01 - First _ Song.flac"
    conflict.parent.mkdir(parents=True, exist_ok=True)
    conflict.write_bytes(b"existing")
    verifier = ripper.finalized_verifier
    assert isinstance(verifier, FakeFinalizedTrackVerifier)
    verifier.rejected.add(1)
    with pytest.raises(RipConflictError):
        ripper.start(disc, release, None)
    assert conflict.read_bytes() == b"existing"


def test_interrupted_recovery_and_partial_cleanup(tmp_path: Path) -> None:
    settings, _catalogue, store, _ripper, _runner, release, _disc = rip_fixture(tmp_path)
    job_id = store.create_job("abc123", release)
    store.set_job_state(job_id, "ripping")
    partial = settings.rip_staging_directory / "old" / "track.partial.flac"
    partial.parent.mkdir(parents=True)
    partial.write_bytes(b"partial")

    assert store.recover_interrupted() == 1
    job = store.get_job(job_id)
    assert job and job["status"] == "interrupted"
    _settings, _catalogue, _store, ripper, *_ = rip_fixture(tmp_path)
    ripper.cleanup_staging()
    assert not partial.exists()


def test_cancelled_rip_resumes_without_overwriting_ready_tracks(tmp_path: Path) -> None:
    _settings, catalogue, store, ripper, runner, release, disc = rip_fixture(
        tmp_path, track_count=4
    )
    runner.block_track = 3
    runner.block_stage = "reading"
    cancelled_id = ripper.start(disc, release, None)
    assert runner.entered.wait(2)
    assert ripper.cancel(cancelled_id)
    assert ripper.wait()

    cancelled = store.get_job(cancelled_id)
    assert cancelled and cancelled["status"] == "cancelled"
    assert [track["state"] for track in cancelled["tracks"]] == [
        "ready",
        "ready",
        "cancelled",
        "cancelled",
    ]
    ready_files = {
        path.name: path.read_bytes()
        for path in (tmp_path / "jukebox" / "Music" / "Test Artist" / "Test Album").glob("*.flac")
    }
    assert len(ready_files) == 2

    assessment = ripper.assess(disc, release)
    assert assessment.action == "resume"
    assert assessment.source_job_id == cancelled_id
    assert dict(assessment.ready_paths).keys() == {1, 2}

    runner.block_track = None
    runner.block_stage = None
    runner.entered.clear()
    resumed_id = ripper.start(disc, release, None)
    assert resumed_id != cancelled_id
    assert ripper.wait()

    resumed = store.get_job(resumed_id)
    assert resumed and resumed["status"] == "completed"
    assert [track["state"] for track in resumed["tracks"]] == ["ready"] * 4
    assert resumed["completed_tracks"] == 4
    assert count_rows(catalogue, "tracks") == 4
    album = tmp_path / "jukebox" / "Music" / "Test Artist" / "Test Album"
    assert {name: (album / name).read_bytes() for name in ready_files} == ready_files
    read_tracks = [int(command[3]) for command in runner.commands if command[0] == "cdparanoia"]
    assert read_tracks.count(1) == 1
    assert read_tracks.count(2) == 1
    assert read_tracks.count(3) == 2  # One cancelled attempt, then one resumed read.
    assert read_tracks.count(4) == 1
    assert store.get_job(cancelled_id)["status"] == "cancelled"


def test_resume_survives_backend_restart_and_cleans_staging(tmp_path: Path) -> None:
    settings, _catalogue, store, ripper, runner, release, disc = rip_fixture(
        tmp_path, track_count=4
    )
    runner.block_track = 3
    runner.block_stage = "reading"
    interrupted_id = ripper.start(disc, release, None)
    assert runner.entered.wait(2)
    assert ripper.cancel(interrupted_id)
    assert ripper.wait()
    store.set_job_state(interrupted_id, "ripping")
    disposable = settings.rip_staging_directory / "old-job" / "track-03.partial.flac"
    disposable.parent.mkdir(parents=True)
    disposable.write_bytes(b"disposable")

    restarted_runner = FakeRunner()
    restarted = RipService(
        settings,
        store,
        ripper.storage,
        ripper.hardware,
        ripper.scan_service,
        runner=restarted_runner,
        tagger=FakeTagger(),
        finalized_verifier=FakeFinalizedTrackVerifier(),
    )

    interrupted = store.get_job(interrupted_id)
    assert interrupted and interrupted["status"] == "interrupted"
    assert not disposable.exists()
    assert restarted.assess(disc, release).action == "resume"
    resumed_id = restarted.start(disc, release, None)
    assert restarted.wait()
    assert store.get_job(resumed_id)["status"] == "completed"
    read_tracks = [
        int(command[3]) for command in restarted_runner.commands if command[0] == "cdparanoia"
    ]
    assert read_tracks == [3, 4]


def test_resume_rejects_mismatched_existing_track_without_overwrite(tmp_path: Path) -> None:
    settings, _catalogue, _store, ripper, runner, release, disc = rip_fixture(
        tmp_path, track_count=4
    )
    runner.block_track = 3
    runner.block_stage = "reading"
    job_id = ripper.start(disc, release, None)
    assert runner.entered.wait(2)
    assert ripper.cancel(job_id)
    assert ripper.wait()
    first = settings.rip_output_path / "Test Artist" / "Test Album" / "01 - First _ Song.flac"
    original = first.read_bytes()
    verifier = ripper.finalized_verifier
    assert isinstance(verifier, FakeFinalizedTrackVerifier)
    verifier.rejected.add(1)

    assessment = ripper.assess(disc, release)
    assert assessment.action == "conflict"
    assert "could not be verified" in assessment.message
    with pytest.raises(RipConflictError, match="could not be verified"):
        ripper.start(disc, release, None)
    assert first.read_bytes() == original


def test_completed_album_does_not_offer_resume(tmp_path: Path) -> None:
    _settings, _catalogue, store, ripper, _runner, release, disc = rip_fixture(tmp_path)
    job_id = ripper.start(disc, release, None)
    assert ripper.wait()

    assessment = ripper.assess(disc, release)
    assert assessment.action == "complete"
    assert assessment.source_job_id == job_id
    with pytest.raises(RipConflictError, match="already in the library"):
        ripper.start(disc, release, None)
