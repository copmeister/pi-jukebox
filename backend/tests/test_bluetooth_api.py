from pathlib import Path

from fastapi.testclient import TestClient
from pi_jukebox.bluetooth.models import (
    BluetoothDevice,
    BluetoothPlaybackState,
    BluetoothStatus,
)
from pi_jukebox.bluetooth.protocol import BluetoothHelperError
from pi_jukebox.bluetooth.service import BluetoothService
from pi_jukebox.config import Settings
from pi_jukebox.main import create_app


def ready_status() -> BluetoothStatus:
    phone = BluetoothDevice(
        id="a" * 16,
        name="Test Phone",
        paired=True,
        trusted=True,
        connected=False,
        audio_playing=False,
    )
    return BluetoothStatus(
        available=True,
        mode_active=True,
        state=BluetoothPlaybackState.NOT_CONNECTED,
        adapter_alias="Pi Jukebox",
        discoverable=False,
        pairable=False,
        pairing_seconds_remaining=0,
        connected_device_id=None,
        devices=[phone],
        pending_pairing=None,
        message="Bluetooth mode is ready.",
    )


class FakeClient:
    def __init__(self) -> None:
        self.calls = []
        self.failure: BluetoothHelperError | None = None

    def request(self, action: str, **parameters):
        self.calls.append((action, parameters))
        if self.failure:
            raise self.failure
        return ready_status()


def make_client(tmp_path: Path, helper: FakeClient, *, enabled: bool = True) -> TestClient:
    settings = Settings(
        _env_file=None,
        environment="test",
        data_directory=tmp_path / "data",
        bluetooth_enabled=enabled,
        update_check_enabled=False,
    )
    application = create_app(settings)
    client = TestClient(application)
    client.__enter__()
    application.state.bluetooth_service = BluetoothService(settings, helper)
    return client


def test_bluetooth_status_and_validated_device_actions(tmp_path: Path) -> None:
    helper = FakeClient()
    client = make_client(tmp_path, helper)
    try:
        status = client.get("/api/bluetooth/status")
        assert status.status_code == 200
        assert status.json()["state"] == "not_connected"

        forbidden = client.post(f"/api/bluetooth/devices/{'a' * 16}/connect")
        assert forbidden.status_code == 403
        accepted = client.post(
            f"/api/bluetooth/devices/{'a' * 16}/connect",
            headers={"X-Pi-Jukebox-Action": "bluetooth-control"},
        )
        assert accepted.status_code == 200
        assert helper.calls[-1] == ("connect", {"device_id": "a" * 16})

        invalid = client.post(
            "/api/bluetooth/devices/not-a-device/connect",
            headers={"X-Pi-Jukebox-Action": "bluetooth-control"},
        )
        assert invalid.status_code == 422
    finally:
        client.__exit__(None, None, None)


def test_disabled_or_failed_helper_is_graceful(tmp_path: Path) -> None:
    disabled_helper = FakeClient()
    disabled = make_client(tmp_path, disabled_helper, enabled=False)
    try:
        response = disabled.get("/api/bluetooth/status")
        assert response.status_code == 200
        assert response.json()["available"] is False
        mutation = disabled.post(
            "/api/bluetooth/activate",
            headers={"X-Pi-Jukebox-Action": "bluetooth-control"},
        )
        assert mutation.status_code == 503
    finally:
        disabled.__exit__(None, None, None)

    failing_helper = FakeClient()
    failing_helper.failure = BluetoothHelperError("The adapter is busy.", code="conflict")
    failing = make_client(tmp_path / "second", failing_helper)
    try:
        response = failing.post(
            "/api/bluetooth/activate",
            headers={"X-Pi-Jukebox-Action": "bluetooth-control"},
        )
        assert response.status_code == 409
        assert "adapter is busy" in response.json()["detail"]
    finally:
        failing.__exit__(None, None, None)
