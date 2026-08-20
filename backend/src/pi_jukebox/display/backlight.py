"""Narrow, unprivileged control of dynamically discovered DSI backlights."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_BACKLIGHT_ROOT = Path("/sys/class/backlight")
SLEEP_BRIGHTNESS_RATIO = 0.08


@dataclass(frozen=True, slots=True)
class BacklightResult:
    available: bool
    adjusted: bool
    message: str

    def to_dict(self) -> dict[str, bool | str]:
        return {
            "available": self.available,
            "adjusted": self.adjusted,
            "message": self.message,
        }


class BacklightService:
    """Dim and restore only kernel backlights associated with DSI outputs."""

    def __init__(
        self,
        root: Path = DEFAULT_BACKLIGHT_ROOT,
        writer: Callable[[Path, int], None] | None = None,
    ) -> None:
        self.root = root
        self._writer = writer or self._write
        self._previous: dict[Path, int] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _write(path: Path, brightness: int) -> None:
        path.write_text(str(brightness), encoding="ascii")

    @staticmethod
    def _integer(path: Path) -> int:
        value = int(path.read_text(encoding="ascii").strip())
        if value < 0 or value > 1_000_000:
            raise ValueError("Backlight value is outside the supported range.")
        return value

    def _backlights(self) -> list[Path]:
        try:
            entries = list(self.root.iterdir())
        except OSError:
            return []
        matches: list[Path] = []
        for entry in entries:
            try:
                display_name = (entry / "display_name").read_text(encoding="ascii").strip()
                if not display_name.casefold().startswith("dsi-"):
                    continue
                self._integer(entry / "brightness")
                maximum = self._integer(entry / "max_brightness")
                if maximum > 0:
                    matches.append(entry)
            except (OSError, UnicodeError, ValueError):
                continue
        return sorted(matches)

    def sleep(self) -> BacklightResult:
        with self._lock:
            if self._previous:
                return BacklightResult(True, True, "The touchscreen backlight is already dimmed.")
            backlights = self._backlights()
            if not backlights:
                return BacklightResult(
                    False,
                    False,
                    "No writable Raspberry Pi DSI backlight was discovered.",
                )
            failures = 0
            for entry in backlights:
                brightness_path = entry / "brightness"
                try:
                    previous = self._integer(brightness_path)
                    maximum = self._integer(entry / "max_brightness")
                    target = min(previous, max(1, round(maximum * SLEEP_BRIGHTNESS_RATIO)))
                    self._writer(brightness_path, target)
                    self._previous[brightness_path] = previous
                except (OSError, ValueError):
                    failures += 1
                    logger.warning("The DSI backlight could not be dimmed.")
            if not self._previous:
                return BacklightResult(
                    True,
                    False,
                    "The DSI backlight is present but unavailable to the application user.",
                )
            return BacklightResult(
                True,
                True,
                (
                    "The touchscreen backlight was dimmed."
                    if failures == 0
                    else "The available touchscreen backlight was dimmed."
                ),
            )

    def wake(self) -> BacklightResult:
        with self._lock:
            if not self._previous:
                return BacklightResult(
                    bool(self._backlights()),
                    False,
                    "No dimmed touchscreen backlight needed restoring.",
                )
            failures = 0
            for brightness_path, previous in list(self._previous.items()):
                try:
                    self._writer(brightness_path, previous)
                    del self._previous[brightness_path]
                except OSError:
                    failures += 1
                    logger.warning("The previous DSI backlight brightness could not be restored.")
            return BacklightResult(
                True,
                failures == 0,
                (
                    "The previous touchscreen brightness was restored."
                    if failures == 0
                    else "The previous touchscreen brightness could not be restored."
                ),
            )
