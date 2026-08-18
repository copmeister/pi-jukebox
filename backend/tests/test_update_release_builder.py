from pathlib import Path

from pi_jukebox.updates.installer import ReleaseManifest

from scripts.build_update_release import build


def test_release_builder_creates_reproducible_validated_assets(tmp_path: Path) -> None:
    inputs = tmp_path / "inputs"
    wheelhouse = inputs / "wheelhouse"
    frontend = inputs / "frontend"
    wheelhouse.mkdir(parents=True)
    frontend.mkdir(parents=True)
    app_wheel = inputs / "pi_jukebox-0.5.1-py3-none-any.whl"
    app_wheel.write_bytes(b"app wheel")
    requirements = inputs / "requirements.lock"
    requirements.write_text("dependency==1 --hash=sha256:" + "0" * 64)
    (wheelhouse / "dependency-1-py3-none-any.whl").write_bytes(b"dependency")
    (frontend / "index.html").write_text("<h1>Jukebox 0.5.1</h1>")
    (frontend / "app.js").write_text("console.log('0.5.1')")

    first_archive, first_manifest = build(
        version="0.5.1",
        app_wheel=app_wheel,
        requirements_lock=requirements,
        wheelhouse=wheelhouse,
        frontend_dist=frontend,
        output_directory=tmp_path / "first",
        architecture="aarch64",
        python_version="3.11",
    )
    second_archive, second_manifest = build(
        version="0.5.1",
        app_wheel=app_wheel,
        requirements_lock=requirements,
        wheelhouse=wheelhouse,
        frontend_dist=frontend,
        output_directory=tmp_path / "second",
        architecture="aarch64",
        python_version="3.11",
    )

    assert first_archive.read_bytes() == second_archive.read_bytes()
    assert first_manifest.read_bytes() == second_manifest.read_bytes()
    manifest = ReleaseManifest.load(first_manifest, "0.5.1")
    destination = tmp_path / "extracted"
    destination.mkdir()
    manifest.extract(first_archive, destination)
    assert (destination / "frontend" / "dist" / "index.html").is_file()
