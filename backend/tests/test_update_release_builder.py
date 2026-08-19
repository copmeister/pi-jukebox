import json
from pathlib import Path

import pytest
from pi_jukebox.updates.installer import ReleaseManifest

from scripts.build_update_release import DEFAULT_PYTHON_VERSION, build


def test_release_builder_creates_reproducible_validated_assets(tmp_path: Path) -> None:
    assert DEFAULT_PYTHON_VERSION == "3.13"

    inputs = tmp_path / "inputs"
    wheelhouse = inputs / "wheelhouse"
    frontend = inputs / "frontend"
    wheelhouse.mkdir(parents=True)
    frontend.mkdir(parents=True)
    app_wheel = inputs / "pi_jukebox-0.6.0-py3-none-any.whl"
    app_wheel.write_bytes(b"app wheel")
    requirements = inputs / "requirements.lock"
    requirements.write_text("dependency==1 --hash=sha256:" + "0" * 64)
    (wheelhouse / "dependency-1-py3-none-any.whl").write_bytes(b"dependency")
    (frontend / "index.html").write_text("<h1>Jukebox 0.6.0</h1>")
    (frontend / "app.js").write_text("console.log('0.6.0')")

    first_archive, first_manifest = build(
        version="0.6.0",
        app_wheel=app_wheel,
        requirements_lock=requirements,
        wheelhouse=wheelhouse,
        frontend_dist=frontend,
        output_directory=tmp_path / "first",
        architecture="aarch64",
        python_version="3.13",
    )
    second_archive, second_manifest = build(
        version="0.6.0",
        app_wheel=app_wheel,
        requirements_lock=requirements,
        wheelhouse=wheelhouse,
        frontend_dist=frontend,
        output_directory=tmp_path / "second",
        architecture="aarch64",
        python_version="3.13",
    )

    assert first_archive.read_bytes() == second_archive.read_bytes()
    assert first_manifest.read_bytes() == second_manifest.read_bytes()
    payload = json.loads(first_manifest.read_text(encoding="utf-8"))
    assert payload["application_version"] == "0.6.0"
    assert payload["compatibility"] == {
        "architecture": "aarch64",
        "python": "3.13",
    }
    assert payload["archive"]["filename"] == "pi-jukebox-v0.6.0.tar.gz"

    manifest = ReleaseManifest.load(first_manifest, "0.6.0")
    assert manifest.architecture == "aarch64"
    assert manifest.python_version == "3.13"
    destination = tmp_path / "extracted"
    destination.mkdir()
    manifest.extract(first_archive, destination)
    assert (destination / "frontend" / "dist" / "index.html").is_file()


@pytest.mark.parametrize(
    ("architecture", "python_version", "message"),
    [
        ("x86_64", "3.13", "64-bit Raspberry Pi OS"),
        ("aarch64", "3.13.5", "major.minor"),
    ],
)
def test_release_builder_rejects_incompatible_manifest_values(
    tmp_path: Path,
    architecture: str,
    python_version: str,
    message: str,
) -> None:
    app_wheel = tmp_path / "pi_jukebox-0.6.0-py3-none-any.whl"
    requirements = tmp_path / "requirements.lock"
    wheelhouse = tmp_path / "wheelhouse"
    frontend = tmp_path / "frontend"
    app_wheel.write_bytes(b"app wheel")
    requirements.write_text("dependency==1 --hash=sha256:" + "0" * 64)
    wheelhouse.mkdir()
    frontend.mkdir()
    (wheelhouse / "dependency-1-py3-none-any.whl").write_bytes(b"dependency")
    (frontend / "index.html").write_text("<h1>Jukebox 0.6.0</h1>")

    with pytest.raises(ValueError, match=message):
        build(
            version="0.6.0",
            app_wheel=app_wheel,
            requirements_lock=requirements,
            wheelhouse=wheelhouse,
            frontend_dist=frontend,
            output_directory=tmp_path / "assets",
            architecture=architecture,
            python_version=python_version,
        )
