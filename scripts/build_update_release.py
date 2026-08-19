"""Build deterministic Pi Jukebox update assets from prebuilt ARM64 inputs."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import tarfile
from pathlib import Path, PurePosixPath

VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
DEFAULT_PYTHON_VERSION = "3.13"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_tree(root: Path, prefix: str) -> dict[str, Path]:
    if not root.is_dir():
        raise ValueError(f"Required directory is missing: {root}")
    collected: dict[str, Path] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Release inputs cannot contain symbolic links: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        archive_path = PurePosixPath(prefix, *relative.parts).as_posix()
        collected[archive_path] = path
    return collected


def build(
    *,
    version: str,
    app_wheel: Path,
    requirements_lock: Path,
    wheelhouse: Path,
    frontend_dist: Path,
    output_directory: Path,
    architecture: str,
    python_version: str,
) -> tuple[Path, Path]:
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("Version must be a stable semantic version such as 0.6.0.")
    if architecture not in {"aarch64", "arm64"}:
        raise ValueError("Update packages must target 64-bit Raspberry Pi OS.")
    if not re.fullmatch(r"3\.\d+", python_version):
        raise ValueError("Python compatibility must be a major.minor value.")
    if (
        not app_wheel.is_file()
        or app_wheel.is_symlink()
        or f"-{version}-" not in app_wheel.name
        or not requirements_lock.is_file()
        or requirements_lock.is_symlink()
    ):
        raise ValueError("The application wheel or hashed requirements lock is invalid.")

    files = {
        f"app/{app_wheel.name}": app_wheel,
        "requirements.lock": requirements_lock,
        **collect_tree(wheelhouse, "wheelhouse"),
        **collect_tree(frontend_dist, "frontend/dist"),
    }
    if "frontend/dist/index.html" not in files:
        raise ValueError("The production frontend build is missing index.html.")
    if not any(name.startswith("wheelhouse/") and name.endswith(".whl") for name in files):
        raise ValueError("The ARM64 dependency wheelhouse is empty.")

    output_directory.mkdir(parents=True, exist_ok=True)
    archive = output_directory / f"pi-jukebox-v{version}.tar.gz"
    manifest = output_directory / f"pi-jukebox-v{version}-manifest.json"
    if archive.exists() or manifest.exists():
        raise FileExistsError("Release assets already exist; remove them deliberately first.")

    with (
        archive.open("xb") as raw,
        gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as package,
    ):
        for archive_name, source in sorted(files.items()):
            info = tarfile.TarInfo(archive_name)
            info.size = source.stat().st_size
            info.mtime = 0
            info.mode = 0o644
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            with source.open("rb") as content:
                package.addfile(info, content)

    payload = {
        "format_version": 1,
        "application_version": version,
        "archive": {"filename": archive.name, "sha256": sha256(archive)},
        "compatibility": {"architecture": architecture, "python": python_version},
        "files": {name: sha256(source) for name, source in sorted(files.items())},
    }
    manifest.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return archive, manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--app-wheel", required=True, type=Path)
    parser.add_argument("--requirements-lock", required=True, type=Path)
    parser.add_argument("--wheelhouse", required=True, type=Path)
    parser.add_argument("--frontend-dist", required=True, type=Path)
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--architecture", default="aarch64")
    parser.add_argument("--python-version", default=DEFAULT_PYTHON_VERSION)
    args = parser.parse_args()
    archive, manifest = build(
        version=args.version,
        app_wheel=args.app_wheel,
        requirements_lock=args.requirements_lock,
        wheelhouse=args.wheelhouse,
        frontend_dist=args.frontend_dist,
        output_directory=args.output_directory,
        architecture=args.architecture,
        python_version=args.python_version,
    )
    print(archive)
    print(manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
