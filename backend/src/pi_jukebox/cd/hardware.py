"""Safe optical-drive probing and controlled subprocess execution."""

import importlib
import os
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

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


class DiscReader(Protocol):
    def read(self, device: str) -> DiscLayout: ...


class DiscReadError(RuntimeError):
    """Raised when libdiscid cannot read a usable audio-disc TOC."""


class LibdiscidReader:
    """Read the physical TOC through python-discid and MusicBrainz libdiscid."""

    def __init__(self, read: Callable[[str], Any] | None = None) -> None:
        self._read = read

    def read(self, device: str) -> DiscLayout:
        try:
            read = self._read
            if read is None:
                # Import lazily so Windows development remains usable without a
                # native libdiscid DLL when no optical drive is configured.
                read = importlib.import_module("discid").read
            raw_disc = read(device)
            tracks = tuple(raw_disc.tracks)
            musicbrainz_id = str(raw_disc.id)
            toc = str(raw_disc.toc_string or "").strip()
            freedb_id = str(raw_disc.freedb_id)
            durations = tuple(max(0.0, float(track.sectors) / 75) for track in tracks)
        except (ImportError, OSError, RuntimeError, TypeError, ValueError) as exc:
            raise DiscReadError("libdiscid could not read the audio disc.") from exc

        if not tracks or not musicbrainz_id or not toc or not freedb_id:
            raise DiscReadError("libdiscid returned an incomplete audio-disc TOC.")
        return DiscLayout(
            disc_id=freedb_id,
            track_count=len(tracks),
            track_durations=durations,
            musicbrainz_disc_id=musicbrainz_id,
            musicbrainz_toc=toc,
        )


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
    def __init__(
        self,
        settings: Settings,
        runner: CommandRunner | None = None,
        disc_reader: DiscReader | None = None,
    ) -> None:
        self.settings = settings
        self.runner = runner or SubprocessRunner()
        self.disc_reader = disc_reader or LibdiscidReader()

    def probe(self) -> DriveState:
        drive = self.settings.optical_drive_path
        if drive is None:
            return DriveState(False, False, False, "No optical drive is configured.")
        if not drive.exists():
            return DriveState(True, False, False, "The configured optical drive is unavailable.")
        try:
            disc = self.disc_reader.read(str(drive))
        except DiscReadError:
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
