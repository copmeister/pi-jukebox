from pathlib import Path

from conftest import make_settings
from fastapi.testclient import TestClient
from pi_jukebox.display.backlight import BacklightResult, BacklightService
from pi_jukebox.main import create_app


def backlight(root: Path, name: str, display: str, brightness: int, maximum: int) -> Path:
    entry = root / name
    entry.mkdir(parents=True)
    (entry / "display_name").write_text(display)
    (entry / "brightness").write_text(str(brightness))
    (entry / "max_brightness").write_text(str(maximum))
    return entry


def test_dsi_backlight_dims_repeats_and_restores_exact_previous_level(tmp_path: Path) -> None:
    root = tmp_path / "backlight"
    dsi = backlight(root, "unknown-kernel-name", "DSI-1", 173, 255)
    hdmi = backlight(root, "other", "HDMI-A-1", 200, 255)
    service = BacklightService(root)

    first = service.sleep()
    assert first.adjusted
    assert (dsi / "brightness").read_text() == "20"
    assert (hdmi / "brightness").read_text() == "200"

    assert service.sleep().adjusted
    assert (dsi / "brightness").read_text() == "20"
    assert service.wake().adjusted
    assert (dsi / "brightness").read_text() == "173"

    (dsi / "brightness").write_text("91")
    assert service.sleep().adjusted
    assert service.wake().adjusted
    assert (dsi / "brightness").read_text() == "91"


def test_backlight_permission_failure_degrades_without_losing_sleep(tmp_path: Path) -> None:
    root = tmp_path / "backlight"
    dsi = backlight(root, "dynamic-name", "DSI-1", 180, 255)

    def denied(_path: Path, _brightness: int) -> None:
        raise PermissionError("not permitted")

    result = BacklightService(root, denied).sleep()
    assert result.available
    assert not result.adjusted
    assert "unavailable" in result.message
    assert (dsi / "brightness").read_text() == "180"


class FakeBacklight:
    def __init__(self) -> None:
        self.actions: list[str] = []

    def sleep(self) -> BacklightResult:
        self.actions.append("sleep")
        return BacklightResult(True, False, "Hardware dimming unavailable.")

    def wake(self) -> BacklightResult:
        self.actions.append("wake")
        return BacklightResult(True, True, "Brightness restored.")


def test_display_api_accepts_only_fixed_actions_and_reports_failure_safely(
    tmp_path: Path,
) -> None:
    app = create_app(make_settings(tmp_path, None))
    fake = FakeBacklight()
    with TestClient(app) as client:
        app.state.backlight_service = fake
        rejected = client.post("/api/system/display/sleep")
        slept = client.post(
            "/api/system/display/sleep",
            headers={"X-Pi-Jukebox-Action": "display-sleep"},
        )
        woke = client.post(
            "/api/system/display/wake",
            headers={"X-Pi-Jukebox-Action": "display-wake"},
        )

    assert rejected.status_code == 403
    assert slept.status_code == 200
    assert slept.json()["adjusted"] is False
    assert woke.status_code == 200
    assert fake.actions == ["sleep", "wake"]
