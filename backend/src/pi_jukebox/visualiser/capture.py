"""PipeWire default-sink monitor capture."""

from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray

from pi_jukebox.config import Settings


class AudioMonitorError(RuntimeError):
    """Raised when final-output monitoring is unavailable."""


_NODE_NAME = re.compile(r'^\s*\*?\s*node\.name\s*=\s*"([^"\r\n]{1,256})"\s*$', re.MULTILINE)


def pipewire_environment(base: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return an environment that reaches the current service user's graph."""

    environment = dict(os.environ if base is None else base)
    if os.name == "posix" and not environment.get("XDG_RUNTIME_DIR"):
        environment["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
    return environment


class PipeWireMonitorCapture:
    """Capture mono float PCM from the dynamically resolved default sink."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._process: subprocess.Popen[bytes] | None = None
        self._read_buffer = bytearray()
        self.sink_name: str | None = None

    def open(self) -> None:
        if self._process is not None:
            return
        environment = pipewire_environment()
        try:
            inspected = subprocess.run(
                [
                    self._settings.visualiser_wpctl_executable,
                    "inspect",
                    "@DEFAULT_AUDIO_SINK@",
                ],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3,
                env=environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise AudioMonitorError("The default audio output could not be resolved.") from exc

        match = _NODE_NAME.search(inspected.stdout)
        if match is None:
            raise AudioMonitorError("The default audio output did not expose a stable node name.")
        self.sink_name = match.group(1)
        properties = (
            '{"stream.capture.sink":true,"node.passive":true,'
            '"media.role":"Music","node.name":"pi-jukebox-visualiser"}'
        )
        try:
            self._process = subprocess.Popen(
                [
                    self._settings.visualiser_pw_record_executable,
                    "--target",
                    self.sink_name,
                    "--properties",
                    properties,
                    "--rate",
                    str(self._settings.visualiser_sample_rate),
                    "--channels",
                    "1",
                    "--channel-map",
                    "mono",
                    "--format",
                    "f32",
                    "--raw",
                    "-",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=environment,
                shell=False,
            )
        except OSError as exc:
            raise AudioMonitorError("PipeWire recording support is unavailable.") from exc

    def read(self, sample_count: int) -> NDArray[np.float32]:
        process = self._process
        if process is None or process.stdout is None:
            raise AudioMonitorError("The audio monitor is not open.")
        required = sample_count * np.dtype("<f4").itemsize
        if len(self._read_buffer) != required:
            self._read_buffer = bytearray(required)
        view = memoryview(self._read_buffer)
        offset = 0
        while offset < required:
            read = process.stdout.readinto(view[offset:])
            if not read:
                raise AudioMonitorError("The audio output monitor stopped.")
            offset += read
        return np.frombuffer(self._read_buffer, dtype="<f4")

    def close(self) -> None:
        process, self._process = self._process, None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)
        if process.stdout is not None:
            process.stdout.close()
