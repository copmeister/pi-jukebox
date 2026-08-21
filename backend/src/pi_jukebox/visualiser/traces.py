"""Compact time-domain traces derived from the existing monitor capture."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from pi_jukebox.config import Settings

SHARED_SIX_BAND_EDGES_HZ = (
    45.0,
    100.0,
    232.99861015014258,
    542.8835233189812,
    1_264.9110640673518,
    2_947.2251989123088,
    16_000.0,
)


@dataclass(frozen=True, slots=True)
class FrequencyWaveTraceResult:
    """One bounded six-band snapshot for the browser canvas."""

    traces: tuple[tuple[int, ...], ...]
    band_rms: tuple[float, ...]


class FrequencyWaveTraceAnalyser:
    """Reconstruct six filtered bands and reduce them to signed peak pairs."""

    def __init__(self, settings: Settings) -> None:
        if not 0.25 <= settings.visualiser_trace_window_seconds <= 1.0:
            raise ValueError("The frequency-wave trace window must be 0.25 to 1 second.")
        if settings.visualiser_trace_points < 64 or settings.visualiser_trace_points % 2:
            raise ValueError("Frequency-wave trace points must be an even value of at least 64.")
        if settings.visualiser_trace_fps <= 0:
            raise ValueError("The frequency-wave trace rate must be positive.")

        self.sample_rate = settings.visualiser_sample_rate
        self.window_seconds = settings.visualiser_trace_window_seconds
        self.point_count = settings.visualiser_trace_points
        self.band_edges_hz = SHARED_SIX_BAND_EDGES_HZ
        self._window_samples = round(self.sample_rate * self.window_seconds)
        self._bucket_count = self.point_count // 2
        if self._window_samples < self._bucket_count:
            raise ValueError("The frequency-wave trace window is too short for its point count.")

        self._samples: NDArray[np.float32] = np.zeros(self._window_samples, dtype=np.float32)
        self._padding = min(2_048, max(1, self._window_samples - 1))
        padded_samples = self._window_samples + self._padding * 2
        self._fft_size = 1 << (padded_samples - 1).bit_length()
        self._padded: NDArray[np.float32] = np.zeros(self._fft_size, dtype=np.float32)
        self._spectrum: NDArray[np.complex64] = np.zeros(
            self._fft_size // 2 + 1, dtype=np.complex64
        )
        self._masked_spectrum: NDArray[np.complex64] = np.zeros_like(self._spectrum)
        self._reconstructed: NDArray[np.float32] = np.zeros(self._fft_size, dtype=np.float32)
        frequencies = np.fft.rfftfreq(self._fft_size, 1.0 / self.sample_rate)
        self._masks: NDArray[np.float32] = np.stack(
            [_band_mask(frequencies, low, high) for low, high in _pairwise(self.band_edges_hz)]
        )
        self._bucket_edges = np.linspace(
            0,
            self._window_samples,
            self._bucket_count + 1,
            dtype=np.int32,
        )
        quiet_amplitude = 10.0 ** (settings.visualiser_quiet_threshold_db / 20.0)
        self._silence_threshold = quiet_amplitude / max(1.0, settings.visualiser_gain) * 0.5

    def reset(self) -> None:
        """Discard rolling audio after a monitor reconnect or trace activation."""

        self._samples.fill(0)
        self._padded.fill(0)
        self._spectrum.fill(0)
        self._masked_spectrum.fill(0)
        self._reconstructed.fill(0)

    def push(self, samples: NDArray[np.float32]) -> None:
        """Append captured mono PCM without opening another capture path."""

        if samples.ndim != 1:
            raise ValueError("Frequency-wave trace input must be mono.")
        count = min(len(samples), self._window_samples)
        if count == 0:
            return
        if count == self._window_samples:
            self._samples[:] = samples[-count:]
            return
        self._samples[:-count] = self._samples[count:]
        self._samples[-count:] = samples[-count:]

    def analyse(self) -> FrequencyWaveTraceResult:
        """Return six real temporal shapes compacted to signed int8-range points."""

        start = self._padding
        end = start + self._window_samples
        self._padded.fill(0)
        self._padded[start:end] = self._samples
        self._padded[:start] = self._samples[1 : start + 1][::-1]
        self._padded[end : end + self._padding] = self._samples[-self._padding - 1 : -1][::-1]
        np.fft.rfft(self._padded, out=self._spectrum)

        traces: list[tuple[int, ...]] = []
        rms_values: list[float] = []
        for mask in self._masks:
            np.multiply(self._spectrum, mask, out=self._masked_spectrum)
            np.fft.irfft(self._masked_spectrum, n=self._fft_size, out=self._reconstructed)
            signal = self._reconstructed[start:end]
            rms = float(np.sqrt(np.mean(np.square(signal, dtype=np.float64))))
            rms_values.append(rms)
            traces.append(self._compact(signal, rms))
        return FrequencyWaveTraceResult(tuple(traces), tuple(rms_values))

    def _compact(self, signal: NDArray[np.float32], rms: float) -> tuple[int, ...]:
        if rms < self._silence_threshold:
            return (0,) * self.point_count

        compact = np.empty(self.point_count, dtype=np.float32)
        for bucket in range(self._bucket_count):
            left = int(self._bucket_edges[bucket])
            right = int(self._bucket_edges[bucket + 1])
            segment = signal[left:right]
            minimum_index = int(np.argmin(segment))
            maximum_index = int(np.argmax(segment))
            minimum = float(segment[minimum_index])
            maximum = float(segment[maximum_index])
            output = bucket * 2
            if minimum_index <= maximum_index:
                compact[output] = minimum
                compact[output + 1] = maximum
            else:
                compact[output] = maximum
                compact[output + 1] = minimum

        peak = float(np.max(np.abs(compact)))
        if peak < self._silence_threshold:
            return (0,) * self.point_count
        quantised = np.rint(np.clip(compact / peak, -1.0, 1.0) * 127.0).astype(np.int16)
        return tuple(int(value) for value in quantised)


def _band_mask(frequencies: NDArray[np.float64], low: float, high: float) -> NDArray[np.float32]:
    """Return a compact raised-cosine band-pass mask with soft edges."""

    span = high - low
    low_transition = max(8.0, min(span * 0.15, low * 0.15))
    high_transition = max(8.0, min(span * 0.15, high * 0.12))
    mask = np.ones_like(frequencies, dtype=np.float64)
    low_start = max(0.0, low - low_transition)
    low_end = low + low_transition
    high_start = high - high_transition
    high_end = high + high_transition
    mask[frequencies <= low_start] = 0
    low_ramp = (frequencies > low_start) & (frequencies < low_end)
    low_position = (frequencies[low_ramp] - low_start) / (low_end - low_start)
    mask[low_ramp] = 0.5 - 0.5 * np.cos(np.pi * low_position)
    mask[frequencies >= high_end] = 0
    high_ramp = (frequencies > high_start) & (frequencies < high_end)
    high_position = (frequencies[high_ramp] - high_start) / (high_end - high_start)
    mask[high_ramp] *= 0.5 + 0.5 * np.cos(np.pi * high_position)
    mask[0] = 0
    return mask.astype(np.float32)


def _pairwise(values: tuple[float, ...]):
    return zip(values[:-1], values[1:], strict=True)
