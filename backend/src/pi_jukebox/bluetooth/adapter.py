"""Platform-neutral Bluetooth adapter records and safe public identifiers."""

import hashlib
import unicodedata
from dataclasses import dataclass

A2DP_SOURCE_UUID = "0000110a-0000-1000-8000-00805f9b34fb"


def public_device_id(path: str) -> str:
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]


def safe_device_name(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    cleaned = "".join(character for character in text if unicodedata.category(character)[0] != "C")
    return " ".join(cleaned.split())[:80] or "Unknown phone"


def supports_a2dp_source(value: object) -> bool:
    """Return whether BlueZ reports the remote A2DP Audio Source service."""
    if not isinstance(value, (list, tuple)):
        return False
    return any(str(item).casefold() == A2DP_SOURCE_UUID for item in value)


@dataclass(frozen=True, slots=True)
class BluezDevice:
    path: str
    id: str
    name: str
    paired: bool
    trusted: bool
    connected: bool
    audio_playing: bool
    audio_source_capable: bool


@dataclass(frozen=True, slots=True)
class BluezSnapshot:
    alias: str
    powered: bool
    discoverable: bool
    pairable: bool
    devices: tuple[BluezDevice, ...]
