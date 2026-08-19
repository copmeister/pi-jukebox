"""Small validated JSON protocol for FastAPI-to-helper communication."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pi_jukebox.bluetooth.models import BluetoothStatus

PROTOCOL_VERSION = 1
MAX_PROTOCOL_BYTES = 16 * 1024
DEVICE_ID_PATTERN = r"^[0-9a-f]{16}$"
REQUEST_ID_PATTERN = r"^[0-9a-f]{24}$"

ACTION_FIELDS: dict[str, frozenset[str]] = {
    "status": frozenset(),
    "activate": frozenset(),
    "deactivate": frozenset(),
    "pairing_start": frozenset(),
    "pairing_cancel": frozenset(),
    "pairing_confirm": frozenset({"request_id", "accept"}),
    "connect": frozenset({"device_id"}),
    "disconnect": frozenset({"device_id"}),
    "forget": frozenset({"device_id"}),
}


class BluetoothProtocolError(ValueError):
    """The local helper message did not match the fixed protocol."""


class BluetoothHelperError(RuntimeError):
    """The helper rejected or could not perform a safe operation."""

    def __init__(self, message: str, *, code: str = "unavailable") -> None:
        self.code = code
        super().__init__(message)


def validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BluetoothProtocolError("The Bluetooth helper request is malformed.")
    if value.get("protocol") != PROTOCOL_VERSION or not isinstance(value.get("action"), str):
        raise BluetoothProtocolError("The Bluetooth helper protocol is unsupported.")
    action = value["action"]
    expected = ACTION_FIELDS.get(action)
    if expected is None or set(value) != {"protocol", "action", *expected}:
        raise BluetoothProtocolError("The Bluetooth helper request is not permitted.")
    if "device_id" in expected:
        device_id = value.get("device_id")
        if (
            not isinstance(device_id, str)
            or len(device_id) != 16
            or any(character not in "0123456789abcdef" for character in device_id)
        ):
            raise BluetoothProtocolError("The Bluetooth device identifier is invalid.")
    if "request_id" in expected:
        request_id = value.get("request_id")
        if (
            not isinstance(request_id, str)
            or len(request_id) != 24
            or any(character not in "0123456789abcdef" for character in request_id)
            or not isinstance(value.get("accept"), bool)
        ):
            raise BluetoothProtocolError("The Bluetooth pairing response is invalid.")
    return value


def success_response(status: BluetoothStatus) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "ok": True,
        "status": status.model_dump(mode="json"),
    }


def error_response(message: str, *, code: str = "unavailable") -> dict[str, Any]:
    safe_code = code if code in {"invalid", "conflict", "unavailable"} else "unavailable"
    safe_message = " ".join(message.split())[:240] or "Bluetooth control is unavailable."
    return {
        "protocol": PROTOCOL_VERSION,
        "ok": False,
        "error": {"code": safe_code, "message": safe_message},
    }


def parse_response(value: Any) -> BluetoothStatus:
    if not isinstance(value, Mapping) or value.get("protocol") != PROTOCOL_VERSION:
        raise BluetoothProtocolError("The Bluetooth helper returned an invalid response.")
    if value.get("ok") is True and set(value) == {"protocol", "ok", "status"}:
        return BluetoothStatus.model_validate(value.get("status"))
    if value.get("ok") is False and set(value) == {"protocol", "ok", "error"}:
        error = value.get("error")
        if isinstance(error, Mapping):
            code = error.get("code")
            message = error.get("message")
            if code in {"invalid", "conflict", "unavailable"} and isinstance(message, str):
                raise BluetoothHelperError(message, code=code)
    raise BluetoothProtocolError("The Bluetooth helper returned an invalid response.")
