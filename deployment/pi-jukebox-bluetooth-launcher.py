#!/usr/bin/python3
"""Fixed launcher for Bluetooth helper code in the active immutable release."""

import os
import re
from pathlib import Path

RELEASE_ROOT = Path("/home/admin/pi-jukebox-releases")
RELEASES = RELEASE_ROOT / "releases"
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
CONFIG = Path("/etc/pi-jukebox-bluetooth.json")


def main() -> None:
    version = (RELEASE_ROOT / "current-version").read_text(encoding="utf-8").strip()
    if not VERSION_PATTERN.fullmatch(version):
        raise RuntimeError("The active Pi Jukebox version pointer is invalid.")
    release = (RELEASES / version).resolve(strict=True)
    if not release.is_dir() or not release.is_relative_to(RELEASES.resolve(strict=True)):
        raise RuntimeError("The active Pi Jukebox release directory is unsafe.")
    python = release / ".venv" / "bin" / "python"
    if not python.is_file() or not CONFIG.is_file():
        raise RuntimeError("The Bluetooth receiver helper is not installed correctly.")
    os.chdir(release)
    os.execv(
        python,
        [
            str(python),
            "-m",
            "pi_jukebox.bluetooth.helper",
            "--config",
            str(CONFIG),
        ],
    )


if __name__ == "__main__":
    main()
