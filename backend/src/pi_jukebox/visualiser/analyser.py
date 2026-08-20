"""FFT analysis for the final-output spectrum visualiser."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from pi_jukebox.config import Settings


@dataclass(frozen=True, slots=True)
class SpectrumResult:
    """One bounded set of display targets."""

    band_centres_hz: tuple[float, ...]
    levels: tuple[int, ...]


class SpectrumAnalyser:
    """Reusable window, FFT and logarithmic band mapping."""

    def __init__(self, settings: Settings) -> None:
        if settings.visualiser_bands < 4:
            raise ValueError("The visualiser needs at least four frequency bands.")
        if settings.visualiser_levels < 2:
            raise ValueError("The visualiser needs at least two vertical levels.")
        if settings.visualiser_fft_size < 256 or not _is_power_of_two(settings.visualiser_fft_size):
            raise ValueError("The visualiser FFT size must be a power of two of at least 256.")
        if not 0 < settings.visualiser_hop_size <= settings.visualiser_fft_size:
            raise ValueError("The visualiser hop size must be between one and the FFT size.")
        if not 0 < settings.visualiser_min_frequency < settings.visualiser_max_frequency:
            raise ValueError("The visualiser frequency range is invalid.")
        if settings.visualiser_max_frequency > settings.visualiser_sample_rate / 2:
            raise ValueError("The visualiser maximum frequency exceeds the Nyquist frequency.")
        if settings.visualiser_quiet_threshold_db >= settings.visualiser_headroom_db:
            raise ValueError("The visualiser quiet threshold must be below its headroom.")

        self.fft_size = settings.visualiser_fft_size
        self.hop_size = settings.visualiser_hop_size
        self.max_levels = settings.visualiser_levels
        self._gain = settings.visualiser_gain
        self._quiet_db = settings.visualiser_quiet_threshold_db
        self._headroom_db = settings.visualiser_headroom_db
        self._window = np.hanning(self.fft_size).astype(np.float32)
        self._amplitude_scale = 2.0 / float(np.sum(self._window))
        self._samples: NDArray[np.float32] = np.zeros(self.fft_size, dtype=np.float32)
        self._smoothed: NDArray[np.float64] = np.zeros(settings.visualiser_bands, dtype=np.float64)

        edges = np.geomspace(
            settings.visualiser_min_frequency,
            settings.visualiser_max_frequency,
            settings.visualiser_bands + 1,
        )
        self.band_centres_hz = tuple(float(value) for value in np.sqrt(edges[:-1] * edges[1:]))
        frequencies = np.fft.rfftfreq(self.fft_size, 1.0 / settings.visualiser_sample_rate)
        mapping = np.searchsorted(edges, frequencies, side="right") - 1
        mapping[frequencies == edges[-1]] = settings.visualiser_bands - 1
        valid = (mapping >= 0) & (mapping < settings.visualiser_bands)
        self._fft_bins = np.flatnonzero(valid)
        self._band_mapping = mapping[valid]
        self._tilt = np.power(
            np.asarray(self.band_centres_hz, dtype=np.float64) / 1_000.0,
            settings.visualiser_spectral_tilt,
        )

    def reset(self) -> None:
        """Discard capture history after a monitor reconnect."""

        self._samples.fill(0)
        self._smoothed.fill(0)

    def analyse(self, samples: NDArray[np.float32]) -> SpectrumResult:
        """Analyse one hop and return integer LED targets."""

        if samples.ndim != 1 or len(samples) != self.hop_size:
            raise ValueError(f"Expected exactly {self.hop_size} mono samples.")

        if self.hop_size < self.fft_size:
            self._samples[: -self.hop_size] = self._samples[self.hop_size :]
            self._samples[-self.hop_size :] = samples
        else:
            self._samples[:] = samples

        spectrum = np.fft.rfft(self._samples * self._window)
        magnitudes = np.abs(spectrum) * self._amplitude_scale
        band_power = np.bincount(
            self._band_mapping,
            weights=np.square(magnitudes[self._fft_bins]),
            minlength=len(self.band_centres_hz),
        )
        energy = np.sqrt(band_power) * self._tilt * self._gain
        db = 20.0 * np.log10(np.maximum(energy, 1e-12))
        targets = np.clip(
            (db - self._quiet_db) / (self._headroom_db - self._quiet_db),
            0.0,
            1.0,
        )

        # A quick attack and lighter release remove single-frame sparkle without
        # normalising quiet passages or obscuring musical transients.
        coefficients = np.where(targets >= self._smoothed, 0.72, 0.32)
        self._smoothed += coefficients * (targets - self._smoothed)
        levels = np.rint(self._smoothed * self.max_levels).astype(np.int16)
        np.clip(levels, 0, self.max_levels, out=levels)
        return SpectrumResult(self.band_centres_hz, tuple(int(value) for value in levels))


def _is_power_of_two(value: int) -> bool:
    return value > 0 and value & (value - 1) == 0
