"""Bounded client for the fixed local Bluetooth helper socket."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any

from pi_jukebox.bluetooth.models import BluetoothStatus
from pi_jukebox.bluetooth.protocol import (
    MAX_PROTOCOL_BYTES,
    PROTOCOL_VERSION,
    BluetoothHelperError,
    BluetoothProtocolError,
    parse_response,
    validate_request,
)


class BluetoothHelperClient:
    def __init__(self, socket_path: Path | None, timeout_seconds: float) -> None:
        self.socket_path = socket_path
        self.timeout_seconds = timeout_seconds

    def request(self, action: str, **parameters: Any) -> BluetoothStatus:
        request = validate_request({"protocol": PROTOCOL_VERSION, "action": action, **parameters})
        if self.socket_path is None:
            raise BluetoothHelperError(
                "Bluetooth receiver control is not configured on this device."
            )
        encoded = json.dumps(request, separators=(",", ":")).encode("utf-8") + b"\n"
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(self.timeout_seconds)
                connection.connect(str(self.socket_path))
                connection.sendall(encoded)
                received = bytearray()
                while len(received) <= MAX_PROTOCOL_BYTES:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    received.extend(chunk)
                    if b"\n" in chunk:
                        break
        except (OSError, TimeoutError) as exc:
            raise BluetoothHelperError(
                "Bluetooth receiver control is not responding right now."
            ) from exc
        if len(received) > MAX_PROTOCOL_BYTES:
            raise BluetoothProtocolError("The Bluetooth helper response was too large.")
        try:
            payload = json.loads(bytes(received).split(b"\n", 1)[0].decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise BluetoothProtocolError(
                "The Bluetooth helper returned an invalid response."
            ) from exc
        return parse_response(payload)
