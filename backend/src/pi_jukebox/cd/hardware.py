"""Safe optical-drive probing and controlled subprocess execution."""

import os
import subprocess
import threading
from dataclasses import dataclass
from typing import Protocol

from pi_jukebox.cd.models import DiscLayout, DriveState
from pi_jukebox.config import Settings


@dataclass(frozen=True, slots=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


class CommandRunner(Protocol):
    def run(self, arguments: list[str], *, timeout: float | None = None) -> CommandResult: ...

    def run_cancellable(
        self,
        arguments: list[str],
        *,
        cancel: threading.Event,
        nice: int | None = None,
    ) -> CommandResult: ...


class SubprocessRunner:
    """Execute explicit argument arrays without a shell."""

    def run(self, arguments: list[str], *, timeout: float | None = None) -> CommandResult:
        completed = subprocess.run(
            arguments,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
        return CommandResult(completed.returncode, completed.stdout, completed.stderr)

    def run_cancellable(
        self,
        arguments: list[str],
        *,
        cancel: threading.Event,
        nice: int | None = None,
    ) -> CommandResult:
        preexec = (lambda: os.nice(nice)) if os.name == "posix" and nice is not None else None
        process = subprocess.Popen(
            arguments,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
            preexec_fn=preexec,
        )
        while process.poll() is None:
            if cancel.wait(0.1):
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                break
        stdout, stderr = process.communicate()
        return CommandResult(int(process.returncode or 0), stdout, stderr)


class CdHardware:
    def __init__(self, settings: Settings, runner: CommandRunner | None = None) -> None:
        self.settings = settings
        self.runner = runner or SubprocessRunner()

    def probe(self) -> DriveState:
        drive = self.settings.optical_drive_path
        if drive is None:
            return DriveState(False, False, False, "No optical drive is configured.")
        if not drive.exists():
            return DriveState(True, False, False, "The configured optical drive is unavailable.")
        try:
            result = self.runner.run([self.settings.cd_discid_executable, str(drive)], timeout=6)
        except (OSError, subprocess.SubprocessError):
            return DriveState(True, True, False, "The drive is ready. Insert an audio CD.")
        if result.returncode != 0:
            return DriveState(True, True, False, "The drive is ready. Insert an audio CD.")
        try:
            disc = parse_cd_discid(result.stdout)
        except ValueError:
            return DriveState(True, True, False, "The inserted disc could not be read.")
        return DriveState(True, True, True, "Audio CD detected.", disc)

    def eject(self) -> bool:
        drive = self.settings.optical_drive_path
        if drive is None or not drive.exists():
            return False
        try:
            return (
                self.runner.run(
                    [self.settings.cd_eject_executable, str(drive)], timeout=8
                ).returncode
                == 0
            )
        except (OSError, subprocess.SubprocessError):
            return False


def parse_cd_discid(output: str) -> DiscLayout:
    fields = output.strip().split()
    if len(fields) < 4:
        raise ValueError("Incomplete disc ID output")
    disc_id = fields[0]
    track_count = int(fields[1])
    offsets = [int(value) for value in fields[2 : 2 + track_count]]
    total_seconds = int(fields[2 + track_count])
    if track_count < 1 or len(offsets) != track_count:
        raise ValueError("Invalid track layout")
    # CDDB offsets include the standard 150-frame lead-in while the final
    # length is reported as playable seconds.
    leadout_frames = total_seconds * 75 + 150
    durations: list[float | None] = []
    for index, offset in enumerate(offsets):
        next_offset = offsets[index + 1] if index + 1 < len(offsets) else leadout_frames
        durations.append(max(0.0, (next_offset - offset) / 75))
    return DiscLayout(disc_id, track_count, tuple(durations))
