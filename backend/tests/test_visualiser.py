import time
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from pi_jukebox.config import Settings
from pi_jukebox.main import create_app
from pi_jukebox.visualiser.analyser import SpectrumAnalyser
from pi_jukebox.visualiser.capture import AudioMonitorError, PipeWireMonitorCapture
from pi_jukebox.visualiser.service import VisualiserService
from pi_jukebox.visualiser.traces import (
    SHARED_SIX_BAND_EDGES_HZ,
    FrequencyWaveTraceAnalyser,
)


def visualiser_settings(tmp_path: Path, **values: object) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        data_directory=tmp_path / "data",
        update_check_enabled=False,
        visualiser_retry_seconds=0.01,
        **values,
    )


def test_log_bands_are_bounded_and_quiet_audio_stays_short(tmp_path: Path) -> None:
    settings = visualiser_settings(tmp_path)
    analyser = SpectrumAnalyser(settings)
    assert len(analyser.band_centres_hz) == settings.visualiser_bands
    assert list(analyser.band_centres_hz) == sorted(analyser.band_centres_hz)
    assert analyser.band_centres_hz[0] >= settings.visualiser_min_frequency
    assert analyser.band_centres_hz[-1] <= settings.visualiser_max_frequency

    quiet = np.zeros(settings.visualiser_hop_size, dtype=np.float32)
    for _ in range(4):
        quiet_result = analyser.analyse(quiet)
    assert max(quiet_result.levels) == 0

    offset = np.arange(settings.visualiser_hop_size, dtype=np.float32)
    tone = (0.7 * np.sin(2 * np.pi * 1_000 * offset / settings.visualiser_sample_rate)).astype(
        np.float32
    )
    for _ in range(4):
        loud_result = analyser.analyse(tone)
    assert max(loud_result.levels) > max(quiet_result.levels)
    assert all(0 <= level <= settings.visualiser_levels for level in loud_result.levels)


def trace_tone(settings: Settings, frequency: float) -> tuple[FrequencyWaveTraceAnalyser, object]:
    analyser = FrequencyWaveTraceAnalyser(settings)
    sample_count = round(settings.visualiser_sample_rate * settings.visualiser_trace_window_seconds)
    time_axis = np.arange(sample_count, dtype=np.float32) / settings.visualiser_sample_rate
    tone = (0.5 * np.sin(2 * np.pi * frequency * time_axis)).astype(np.float32)
    analyser.push(tone)
    return analyser, analyser.analyse()


def test_frequency_wave_traces_are_bounded_flat_in_silence_and_use_shared_bands(
    tmp_path: Path,
) -> None:
    settings = visualiser_settings(tmp_path)
    analyser = FrequencyWaveTraceAnalyser(settings)
    result = analyser.analyse()

    assert analyser.window_seconds == 0.5
    assert analyser.point_count == 192
    assert analyser.band_edges_hz == SHARED_SIX_BAND_EDGES_HZ
    assert len(result.traces) == 6
    assert all(len(trace) == 192 for trace in result.traces)
    assert all(set(trace) == {0} for trace in result.traces)


def test_frequency_wave_filtering_separates_bass_and_treble_and_preserves_peaks(
    tmp_path: Path,
) -> None:
    settings = visualiser_settings(tmp_path)
    _, bass = trace_tone(settings, 70)
    _, treble = trace_tone(settings, 8_000)

    assert int(np.argmax(bass.band_rms)) == 0
    assert int(np.argmax(treble.band_rms)) == 5
    assert bass.band_rms[0] > bass.band_rms[1] * 10
    assert treble.band_rms[5] > treble.band_rms[4] * 100
    assert max(abs(point) for point in bass.traces[0]) == 127
    assert max(abs(point) for point in treble.traces[5]) == 127
    assert all(-127 <= point <= 127 for trace in treble.traces for point in trace)
    assert all(
        min(treble.traces[5][offset : offset + 2]) < 0
        and max(treble.traces[5][offset : offset + 2]) > 0
        for offset in range(0, settings.visualiser_trace_points, 2)
    )


def test_frequency_wave_trace_reforms_with_new_temporal_audio(tmp_path: Path) -> None:
    settings = visualiser_settings(tmp_path)
    analyser = FrequencyWaveTraceAnalyser(settings)
    sample_count = round(settings.visualiser_sample_rate * settings.visualiser_trace_window_seconds)
    time_axis = np.arange(sample_count, dtype=np.float32) / settings.visualiser_sample_rate
    first = (0.45 * np.sin(2 * np.pi * 400 * time_axis)).astype(np.float32)
    second = (
        0.32 * np.sin(2 * np.pi * 360 * time_axis)
        + 0.24 * np.sin(2 * np.pi * 480 * time_axis + 0.7)
    ).astype(np.float32)

    analyser.push(first)
    first_trace = analyser.analyse().traces[2]
    analyser.push(second)
    second_trace = analyser.analyse().traces[2]

    assert first_trace != second_trace


def test_pipewire_capture_targets_resolved_sink_monitor_not_numeric_id(tmp_path: Path) -> None:
    settings = visualiser_settings(tmp_path)
    completed = Mock(stdout='  * node.name = "alsa_output.platform-dac.stereo"\n')
    process = Mock(stdout=Mock())
    with (
        patch("pi_jukebox.visualiser.capture.subprocess.run", return_value=completed) as run,
        patch("pi_jukebox.visualiser.capture.subprocess.Popen", return_value=process) as popen,
    ):
        capture = PipeWireMonitorCapture(settings)
        capture.open()

    assert run.call_args.args[0][-1] == "@DEFAULT_AUDIO_SINK@"
    command = popen.call_args.args[0]
    assert command[command.index("--target") + 1] == "alsa_output.platform-dac.stereo"
    properties = command[command.index("--properties") + 1]
    assert '"stream.capture.sink":true' in properties
    assert command[command.index("--target") + 1].isdigit() is False


class FakeCapture:
    def __init__(self, hop_size: int, *, fail: bool = False) -> None:
        self.sink_name = "test-output"
        self.hop_size = hop_size
        self.fail = fail
        self.opened = False
        self.closed = False

    def open(self) -> None:
        if self.fail:
            raise AudioMonitorError("missing monitor")
        self.opened = True

    def read(self, sample_count: int) -> NDArray[np.float32]:
        if self.closed:
            raise AudioMonitorError("closed")
        time.sleep(0.002)
        return np.zeros(sample_count, dtype=np.float32)

    def close(self) -> None:
        self.closed = True


def wait_until(predicate, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("Timed out waiting for visualiser state")


def test_analysis_starts_and_stops_independently(tmp_path: Path) -> None:
    settings = visualiser_settings(tmp_path, visualiser_stream_fps=120)
    captures: list[FakeCapture] = []

    def factory() -> FakeCapture:
        capture = FakeCapture(settings.visualiser_hop_size)
        captures.append(capture)
        return capture

    service = VisualiserService(settings, factory)
    initial = service.subscribe()
    assert initial.status == "starting"
    wait_until(lambda: service.snapshot().status == "ready")
    assert service.running
    assert service.subscriber_count == 1

    service.unsubscribe()
    wait_until(lambda: not service.running)
    assert service.subscriber_count == 0
    assert captures[0].closed


def test_frequency_wave_traces_are_demand_driven_on_the_existing_capture(
    tmp_path: Path,
) -> None:
    settings = visualiser_settings(
        tmp_path,
        visualiser_stream_fps=120,
        visualiser_trace_fps=120,
    )
    captures: list[FakeCapture] = []

    def factory() -> FakeCapture:
        capture = FakeCapture(settings.visualiser_hop_size)
        captures.append(capture)
        return capture

    service = VisualiserService(settings, factory)
    service.subscribe()
    service.subscribe(include_frequency_waves=True)
    try:
        wait_until(lambda: service.snapshot().frequency_waves is not None)
        frame = service.snapshot()
        assert len(captures) == 1
        assert "frequency_waves" not in frame.payload()
        assert frame.payload(include_frequency_waves=True)["frequency_waves"] is not None
        assert service.subscriber_count == 2
    finally:
        service.unsubscribe(include_frequency_waves=True)
        service.unsubscribe()
    wait_until(lambda: not service.running)


def test_missing_monitor_is_contained_and_other_services_remain_constructible(
    tmp_path: Path,
) -> None:
    settings = visualiser_settings(tmp_path)
    service = VisualiserService(
        settings,
        lambda: FakeCapture(settings.visualiser_hop_size, fail=True),
    )
    service.subscribe()
    try:
        wait_until(lambda: service.snapshot().status == "unavailable")
        assert "Playback is unaffected" in service.snapshot().message
        # Existing playback coordination APIs remain independently usable.
        existing_settings = visualiser_settings(
            tmp_path / "existing",
            visualiser_enabled=False,
        )
        application = create_app(existing_settings)
        with TestClient(application) as client:
            assert client.get("/api/queue").status_code == 200
            bluetooth = client.get("/api/bluetooth/status")
            assert bluetooth.status_code == 200
            assert bluetooth.json()["available"] is False
    finally:
        service.unsubscribe()
