#!/usr/bin/python3
"""Fixed launcher for the root-owned active-version pointer."""

import os
import re
from pathlib import Path

RELEASE_ROOT = Path("/home/admin/pi-jukebox-releases")
RELEASES = RELEASE_ROOT / "releases"
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def active_release() -> Path:
    version = (RELEASE_ROOT / "current-version").read_text(encoding="utf-8").strip()
    if not VERSION_PATTERN.fullmatch(version):
        raise RuntimeError("The active Pi Jukebox version pointer is invalid.")
    release = (RELEASES / version).resolve(strict=True)
    if not release.is_dir() or not release.is_relative_to(RELEASES.resolve(strict=True)):
        raise RuntimeError("The active Pi Jukebox release directory is unsafe.")
    return release


def main() -> None:
    release = active_release()
    python = release / ".venv" / "bin" / "python"
    if not python.is_file():
        raise RuntimeError("The active Pi Jukebox virtual environment is unavailable.")
    os.chdir(release)
    os.execv(
        python,
        [
            str(python),
            "-m",
            "uvicorn",
            "pi_jukebox.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "5173",
        ],
    )


if __name__ == "__main__":
    main()
