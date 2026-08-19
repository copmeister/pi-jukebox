"""Application-facing Bluetooth service with graceful unavailable behavior."""

from __future__ import annotations

from threading import Lock

from pi_jukebox.bluetooth.client import BluetoothHelperClient
from pi_jukebox.bluetooth.models import BluetoothStatus
from pi_jukebox.bluetooth.protocol import BluetoothHelperError, BluetoothProtocolError
from pi_jukebox.config import Settings


class BluetoothService:
    def __init__(
        self,
        settings: Settings,
        client: BluetoothHelperClient | None = None,
    ) -> None:
        self.enabled = settings.bluetooth_enabled
        self.client = client or BluetoothHelperClient(
            settings.bluetooth_socket_path,
            settings.bluetooth_timeout_seconds,
        )
        self._mutation_lock = Lock()

    def status(self) -> BluetoothStatus:
        if not self.enabled:
            return BluetoothStatus.unavailable(
                "Bluetooth receiver mode is not enabled on this installation."
            )
        try:
            return self.client.request("status")
        except (BluetoothHelperError, BluetoothProtocolError):
            return BluetoothStatus.unavailable(
                "Bluetooth receiver control is not responding right now."
            )

    def perform(self, action: str, **parameters: object) -> BluetoothStatus:
        if not self.enabled:
            raise BluetoothHelperError(
                "Bluetooth receiver mode is not enabled on this installation."
            )
        if not self._mutation_lock.acquire(blocking=False):
            raise BluetoothHelperError(
                "Another Bluetooth action is still in progress.", code="conflict"
            )
        try:
            return self.client.request(action, **parameters)
        finally:
            self._mutation_lock.release()
