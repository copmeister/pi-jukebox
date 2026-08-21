"""Lifecycle isolation and small-frame publication for spectrum analysis."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from typing import Protocol

from numpy.typing import NDArray

from pi_jukebox.config import Settings
from pi_jukebox.visualiser.analyser import SpectrumAnalyser
from pi_jukebox.visualiser.capture import PipeWireMonitorCapture
from pi_jukebox.visualiser.traces import FrequencyWaveTraceAnalyser


class MonitorCapture(Protocol):
    sink_name: str | None

    def open(self) -> None: ...

    def read(self, sample_count: int) -> NDArray: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class FrequencyWavePayload:
    band_edges_hz: tuple[float, ...]
    window_seconds: float
    traces: tuple[tuple[int, ...], ...]


@dataclass(frozen=True, slots=True)
class VisualiserFrame:
    sequence: int
    status: str
    message: str
    band_centres_hz: tuple[float, ...]
    levels: tuple[int, ...]
    max_levels: int
    rise_rate: float
    fall_rate: float
    frequency_waves: FrequencyWavePayload | None = None

    def payload(self, include_frequency_waves: bool = False) -> dict[str, object]:
        payload = asdict(self)
        frequency_waves = payload.pop("frequency_waves")
        if include_frequency_waves and frequency_waves is not None:
            payload["frequency_waves"] = frequency_waves
        return payload


class VisualiserService:
    """Run capture only while one or more visualiser clients are present."""

    def __init__(
        self,
        settings: Settings,
        capture_factory: Callable[[], MonitorCapture] | None = None,
    ) -> None:
        self._settings = settings
        self._analyser = SpectrumAnalyser(settings)
        self._trace_analyser = FrequencyWaveTraceAnalyser(settings)
        self._capture_factory = capture_factory or (lambda: PipeWireMonitorCapture(settings))
        self._condition = threading.Condition()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._capture: MonitorCapture | None = None
        self._subscribers = 0
        self._trace_subscribers = 0
        initial_status = "starting" if settings.visualiser_enabled else "unavailable"
        initial_message = (
            "Connecting to the jukebox audio output."
            if settings.visualiser_enabled
            else "The spectrum visualiser is disabled."
        )
        self._frame = VisualiserFrame(
            0,
            initial_status,
            initial_message,
            self._analyser.band_centres_hz,
            (0,) * settings.visualiser_bands,
            settings.visualiser_levels,
            settings.visualiser_rise_rate,
            settings.visualiser_fall_rate,
        )

    @property
    def subscriber_count(self) -> int:
        with self._condition:
            return self._subscribers

    @property
    def running(self) -> bool:
        with self._condition:
            return self._thread is not None and self._thread.is_alive()

    def subscribe(self, include_frequency_waves: bool = False) -> VisualiserFrame:
        with self._condition:
            first_trace_subscriber = include_frequency_waves and self._trace_subscribers == 0
            self._subscribers += 1
            if include_frequency_waves:
                self._trace_subscribers += 1
            if self._settings.visualiser_enabled and (
                self._thread is None or not self._thread.is_alive()
            ):
                self._stop_event.clear()
                self._thread = threading.Thread(
                    target=self._run,
                    name="spectrum-analyser",
                    daemon=True,
                )
                self._thread.start()
            if first_trace_subscriber:
                return replace(self._frame, frequency_waves=None)
            return self._frame

    def unsubscribe(self, include_frequency_waves: bool = False) -> None:
        capture: MonitorCapture | None = None
        thread: threading.Thread | None = None
        with self._condition:
            if self._subscribers == 0:
                return
            self._subscribers -= 1
            if include_frequency_waves and self._trace_subscribers > 0:
                self._trace_subscribers -= 1
            if self._subscribers == 0:
                self._stop_event.set()
                capture = self._capture
                thread = self._thread
        if capture is not None:
            capture.close()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2)

    def stop(self) -> None:
        with self._condition:
            self._subscribers = 0
            self._trace_subscribers = 0
            self._stop_event.set()
            capture = self._capture
            thread = self._thread
        if capture is not None:
            capture.close()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2)

    def snapshot(self) -> VisualiserFrame:
        with self._condition:
            return self._frame

    def wait_for_frame(self, after_sequence: int, timeout: float) -> VisualiserFrame:
        with self._condition:
            self._condition.wait_for(
                lambda: self._frame.sequence != after_sequence,
                timeout=max(0.0, timeout),
            )
            return self._frame

    def _publish(
        self,
        status: str,
        message: str,
        levels: tuple[int, ...],
        frequency_waves: FrequencyWavePayload | None = None,
    ) -> None:
        with self._condition:
            self._frame = VisualiserFrame(
                self._frame.sequence + 1,
                status,
                message,
                self._analyser.band_centres_hz,
                levels,
                self._settings.visualiser_levels,
                self._settings.visualiser_rise_rate,
                self._settings.visualiser_fall_rate,
                frequency_waves,
            )
            self._condition.notify_all()

    def _run(self) -> None:
        blank = (0,) * self._settings.visualiser_bands
        base_frame_interval = 1.0 / max(1.0, self._settings.visualiser_stream_fps)
        try:
            while not self._stop_event.is_set():
                capture: MonitorCapture | None = None
                try:
                    capture = self._capture_factory()
                    with self._condition:
                        self._capture = capture
                    capture.open()
                    self._analyser.reset()
                    self._trace_analyser.reset()
                    self._publish("ready", "Listening to the jukebox audio output.", blank)
                    next_publish = time.monotonic()
                    trace_active = False
                    while not self._stop_event.is_set():
                        samples = capture.read(self._analyser.hop_size)
                        result = self._analyser.analyse(samples)
                        now = time.monotonic()
                        with self._condition:
                            trace_requested = self._trace_subscribers > 0
                        if trace_requested != trace_active:
                            trace_active = trace_requested
                            self._trace_analyser.reset()
                            next_publish = now
                        if trace_active:
                            self._trace_analyser.push(samples)
                        if now >= next_publish:
                            frequency_waves = None
                            if trace_active:
                                trace_result = self._trace_analyser.analyse()
                                frequency_waves = FrequencyWavePayload(
                                    self._trace_analyser.band_edges_hz,
                                    self._trace_analyser.window_seconds,
                                    trace_result.traces,
                                )
                            self._publish(
                                "ready",
                                "Listening to the jukebox audio output.",
                                result.levels,
                                frequency_waves,
                            )
                            if trace_active:
                                trace_interval = 1.0 / max(1.0, self._settings.visualiser_trace_fps)
                                next_publish += trace_interval
                                if next_publish <= now:
                                    next_publish = now + trace_interval
                            else:
                                next_publish = now + base_frame_interval
                except Exception:
                    # This thread is a hard fault boundary: capture and FFT
                    # failures must never escape into playback or app lifespan.
                    if not self._stop_event.is_set():
                        self._publish(
                            "unavailable",
                            "The jukebox audio output monitor is unavailable. "
                            "Playback is unaffected.",
                            blank,
                        )
                        self._stop_event.wait(max(0.1, self._settings.visualiser_retry_seconds))
                finally:
                    if capture is not None:
                        capture.close()
                    with self._condition:
                        if self._capture is capture:
                            self._capture = None
        finally:
            with self._condition:
                self._thread = None
                self._condition.notify_all()
