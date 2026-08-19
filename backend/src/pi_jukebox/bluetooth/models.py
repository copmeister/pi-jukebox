"""Strict Bluetooth state shared by the API and local helper protocol."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class BluetoothPlaybackState(StrEnum):
    """User-facing receiver states; transport details stay inside the helper."""

    UNAVAILABLE = "unavailable"
    INACTIVE = "inactive"
    NOT_CONNECTED = "not_connected"
    PAIRING = "pairing"
    CONNECTED = "connected"
    AUDIO_PLAYING = "audio_playing"
    ERROR = "error"


class BluetoothDevice(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[0-9a-f]{16}$")
    name: str = Field(min_length=1, max_length=80)
    paired: bool
    trusted: bool
    connected: bool
    audio_playing: bool


class BluetoothPairingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[0-9a-f]{24}$")
    device_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    device_name: str = Field(min_length=1, max_length=80)
    kind: str = Field(pattern=r"^(confirm|authorize)$")
    passkey: str | None = Field(default=None, pattern=r"^\d{6}$")


class BluetoothStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    available: bool
    mode_active: bool
    state: BluetoothPlaybackState
    adapter_alias: str | None = Field(default=None, max_length=80)
    discoverable: bool
    pairable: bool
    pairing_seconds_remaining: int = Field(ge=0, le=600)
    connected_device_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{16}$")
    devices: list[BluetoothDevice]
    pending_pairing: BluetoothPairingRequest | None
    message: str = Field(min_length=1, max_length=240)

    @classmethod
    def unavailable(cls, message: str) -> "BluetoothStatus":
        return cls(
            available=False,
            mode_active=False,
            state=BluetoothPlaybackState.UNAVAILABLE,
            adapter_alias=None,
            discoverable=False,
            pairable=False,
            pairing_seconds_remaining=0,
            connected_device_id=None,
            devices=[],
            pending_pairing=None,
            message=message,
        )
