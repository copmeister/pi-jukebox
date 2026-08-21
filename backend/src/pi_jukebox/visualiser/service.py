"""Lifecycle isolation and small-frame publication for spectrum analysis."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Protocol

from numpy.typing import NDArray

from pi_jukebox.config import Settings
from pi_jukebox.visualiser.analyser import SpectrumAnalyser
from pi_jukebox.visualiser.capture import PipeWireMonitorCapture


class MonitorCapture(Protocol):
    sink_name: str | None

    def open(self) -> None: ...

    def read(self, sample_count: int) -> NDArray: ...

    def close(self) -> None: ...


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

    def payload(self) -> dict[str, object]:
        return asdict(self)


class VisualiserService:
    """Run capture only while one or more visualiser clients are present."""

    def __init__(
        self,
        settings: Settings,
        capture_factory: Callable[[], MonitorCapture] | None = None,
    ) -> None:
        self._settings = settings
        self._analyser = SpectrumAnalyser(settings)
        self._capture_factory = capture_factory or (lambda: PipeWireMonitorCapture(settings))
        self._condition = threading.Condition()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._capture: MonitorCapture | None = None
        self._subscribers = 0
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

    def subscribe(self) -> VisualiserFrame:
        with self._condition:
            self._subscribers += 1
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
            return self._frame

    def unsubscribe(self) -> None:
        capture: MonitorCapture | None = None
        thread: threading.Thread | None = None
        with self._condition:
            if self._subscribers == 0:
                return
            self._subscribers -= 1
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

    def _publish(self, status: str, message: str, levels: tuple[int, ...]) -> None:
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
            )
            self._condition.notify_all()

    def _run(self) -> None:
        blank = (0,) * self._settings.visualiser_bands
        frame_interval = 1.0 / max(1.0, self._settings.visualiser_stream_fps)
        try:
            while not self._stop_event.is_set():
                capture: MonitorCapture | None = None
                try:
                    capture = self._capture_factory()
                    with self._condition:
                        self._capture = capture
                    capture.open()
                    self._analyser.reset()
                    self._publish("ready", "Listening to the jukebox audio output.", blank)
                    next_publish = time.monotonic()
                    while not self._stop_event.is_set():
                        samples = capture.read(self._analyser.hop_size)
                        result = self._analyser.analyse(samples)
                        now = time.monotonic()
                        if now >= next_publish:
                            self._publish(
                                "ready",
                                "Listening to the jukebox audio output.",
                                result.levels,
                            )
                            next_publish = now + frame_interval
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
