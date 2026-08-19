"""BlueZ D-Bus adapter used only by the isolated Bluetooth helper."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from dbus_fast import BusType, DBusError, Variant
from dbus_fast.aio import MessageBus
from dbus_fast.annotations import DBusObjectPath, DBusStr, DBusUInt16, DBusUInt32
from dbus_fast.service import ServiceInterface, dbus_method

from pi_jukebox.bluetooth.adapter import (
    BluezDevice,
    BluezSnapshot,
    public_device_id,
    safe_device_name,
    supports_a2dp_source,
)

BLUEZ_SERVICE = "org.bluez"
OBJECT_MANAGER = "org.freedesktop.DBus.ObjectManager"
PROPERTIES = "org.freedesktop.DBus.Properties"
ADAPTER = "org.bluez.Adapter1"
DEVICE = "org.bluez.Device1"
AGENT_MANAGER = "org.bluez.AgentManager1"
MEDIA_TRANSPORT = "org.bluez.MediaTransport1"
AGENT_PATH = "/com/copmeister/PiJukebox/Agent"
A2DP_SERVICE_UUIDS = {
    "0000110a-0000-1000-8000-00805f9b34fb",  # Audio Source
    "0000110b-0000-1000-8000-00805f9b34fb",  # Audio Sink
    "0000110c-0000-1000-8000-00805f9b34fb",  # AVRCP Target
    "0000110e-0000-1000-8000-00805f9b34fb",  # AVRCP
}

PairingAuthorizer = Callable[[str, str, str | None], Awaitable[bool]]


def _value(properties: dict[str, Any], name: str, default: Any = None) -> Any:
    value = properties.get(name)
    return value.value if isinstance(value, Variant) else default


class PiJukeboxAgent(ServiceInterface):
    """Display-capable BlueZ agent whose decisions come from the touchscreen."""

    def __init__(self, authorize: PairingAuthorizer) -> None:
        super().__init__("org.bluez.Agent1")
        self.authorize = authorize

    @dbus_method(name="Release")
    def release(self):
        return None

    @dbus_method(name="RequestPinCode")
    def request_pin_code(self, _device: DBusObjectPath) -> DBusStr:
        raise DBusError(
            "org.bluez.Error.Rejected",
            "Legacy PIN entry is not supported by the touchscreen pairing flow.",
        )

    @dbus_method(name="DisplayPinCode")
    def display_pin_code(self, _device: DBusObjectPath, _pin_code: DBusStr):
        raise DBusError(
            "org.bluez.Error.Rejected",
            "Legacy PIN display is not supported by the touchscreen pairing flow.",
        )

    @dbus_method(name="RequestPasskey")
    def request_passkey(self, _device: DBusObjectPath) -> DBusUInt32:
        raise DBusError(
            "org.bluez.Error.Rejected",
            "Passkey entry is not supported by the touchscreen pairing flow.",
        )

    @dbus_method(name="DisplayPasskey")
    def display_passkey(
        self,
        _device: DBusObjectPath,
        _passkey: DBusUInt32,
        _entered: DBusUInt16,
    ):
        raise DBusError(
            "org.bluez.Error.Rejected",
            "Passkey display is not supported by the touchscreen pairing flow.",
        )

    @dbus_method(name="RequestConfirmation")
    async def request_confirmation(self, device: DBusObjectPath, passkey: DBusUInt32):
        accepted = await self.authorize(str(device), "confirm", f"{int(passkey):06d}")
        if not accepted:
            raise DBusError("org.bluez.Error.Rejected", "Pairing was rejected.")

    @dbus_method(name="RequestAuthorization")
    async def request_authorization(self, device: DBusObjectPath):
        accepted = await self.authorize(str(device), "authorize", None)
        if not accepted:
            raise DBusError("org.bluez.Error.Rejected", "Pairing was rejected.")

    @dbus_method(name="AuthorizeService")
    async def authorize_service(self, device: DBusObjectPath, uuid: DBusStr):
        if str(uuid).lower() not in A2DP_SERVICE_UUIDS:
            raise DBusError("org.bluez.Error.Rejected", "That Bluetooth service is not allowed.")
        accepted = await self.authorize(str(device), "authorize", None)
        if not accepted:
            raise DBusError("org.bluez.Error.Rejected", "Bluetooth audio was rejected.")

    @dbus_method(name="Cancel")
    def cancel(self):
        return None


class BluezAdapter:
    """Minimal high-level BlueZ interface; no shell commands or raw HCI access."""

    def __init__(self) -> None:
        self.bus: MessageBus | None = None
        self.adapter_path: str | None = None
        self.authorize: PairingAuthorizer | None = None
        self.agent: PiJukeboxAgent | None = None

    def set_authorizer(self, authorize: PairingAuthorizer) -> None:
        self.authorize = authorize

    async def _managed_objects(self) -> dict[str, dict[str, dict[str, Variant]]]:
        if self.bus is None:
            raise RuntimeError("The BlueZ system bus is unavailable.")
        root = await self.bus.introspect(BLUEZ_SERVICE, "/")
        proxy = self.bus.get_proxy_object(BLUEZ_SERVICE, "/", root)
        manager = proxy.get_interface(OBJECT_MANAGER)
        return await manager.call_get_managed_objects()

    async def _interface(self, path: str, interface: str) -> Any:
        if self.bus is None:
            raise RuntimeError("The BlueZ system bus is unavailable.")
        introspection = await self.bus.introspect(BLUEZ_SERVICE, path)
        return self.bus.get_proxy_object(BLUEZ_SERVICE, path, introspection).get_interface(
            interface
        )

    async def _set(self, path: str, interface: str, name: str, value: Variant) -> None:
        properties = await self._interface(path, PROPERTIES)
        await properties.call_set(interface, name, value)

    async def initialize(self, alias: str, pairing_timeout_seconds: int) -> None:
        if self.authorize is None:
            raise RuntimeError("The Bluetooth pairing agent is not configured.")
        self.bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        managed = await self._managed_objects()
        adapters = sorted(path for path, values in managed.items() if ADAPTER in values)
        if len(adapters) != 1:
            raise RuntimeError("Exactly one Bluetooth adapter is required.")
        self.adapter_path = adapters[0]
        await self._set(self.adapter_path, ADAPTER, "Alias", Variant("s", alias))
        await self._set(
            self.adapter_path,
            ADAPTER,
            "DiscoverableTimeout",
            Variant("u", pairing_timeout_seconds),
        )
        await self._set(
            self.adapter_path,
            ADAPTER,
            "PairableTimeout",
            Variant("u", pairing_timeout_seconds),
        )
        await self.set_pairing(False, pairing_timeout_seconds)

        self.agent = PiJukeboxAgent(self.authorize)
        self.bus.export(AGENT_PATH, self.agent)
        manager = await self._interface("/org/bluez", AGENT_MANAGER)
        try:
            await manager.call_register_agent(AGENT_PATH, "DisplayYesNo")
        except DBusError as exc:
            if exc.type != "org.bluez.Error.AlreadyExists":
                raise
        await manager.call_request_default_agent(AGENT_PATH)

    async def close(self) -> None:
        if self.bus is not None:
            try:
                manager = await self._interface("/org/bluez", AGENT_MANAGER)
                await manager.call_unregister_agent(AGENT_PATH)
            except (DBusError, RuntimeError):
                pass
            self.bus.disconnect()
        self.bus = None
        self.adapter_path = None

    async def set_pairing(self, enabled: bool, timeout_seconds: int) -> None:
        if self.adapter_path is None:
            raise RuntimeError("The Bluetooth adapter is unavailable.")
        if enabled:
            await self._set(self.adapter_path, ADAPTER, "Powered", Variant("b", True))
            await self._set(
                self.adapter_path, ADAPTER, "PairableTimeout", Variant("u", timeout_seconds)
            )
            await self._set(
                self.adapter_path,
                ADAPTER,
                "DiscoverableTimeout",
                Variant("u", timeout_seconds),
            )
            await self._set(self.adapter_path, ADAPTER, "Pairable", Variant("b", True))
            await self._set(self.adapter_path, ADAPTER, "Discoverable", Variant("b", True))
        else:
            await self._set(self.adapter_path, ADAPTER, "Discoverable", Variant("b", False))
            await self._set(self.adapter_path, ADAPTER, "Pairable", Variant("b", False))

    async def snapshot(self) -> BluezSnapshot:
        if self.adapter_path is None:
            raise RuntimeError("The Bluetooth adapter is unavailable.")
        managed = await self._managed_objects()
        adapter = managed.get(self.adapter_path, {}).get(ADAPTER)
        if adapter is None:
            raise RuntimeError("The Bluetooth adapter disappeared.")

        transport_paths = {
            str(_value(properties, "Device", ""))
            for values in managed.values()
            if (properties := values.get(MEDIA_TRANSPORT)) is not None
        }
        active_paths = {
            str(_value(properties, "Device", ""))
            for values in managed.values()
            if (properties := values.get(MEDIA_TRANSPORT)) is not None
            and _value(properties, "State") == "active"
        }
        devices: list[BluezDevice] = []
        for path, values in managed.items():
            properties = values.get(DEVICE)
            if properties is None:
                continue
            devices.append(
                BluezDevice(
                    path=path,
                    id=public_device_id(path),
                    name=safe_device_name(
                        _value(properties, "Alias") or _value(properties, "Name")
                    ),
                    paired=bool(_value(properties, "Paired", False)),
                    trusted=bool(_value(properties, "Trusted", False)),
                    connected=bool(_value(properties, "Connected", False)),
                    audio_playing=path in active_paths,
                    audio_source_capable=(
                        supports_a2dp_source(_value(properties, "UUIDs", []))
                        or path in transport_paths
                    ),
                )
            )
        return BluezSnapshot(
            alias=safe_device_name(_value(adapter, "Alias", "Pi Jukebox")),
            powered=bool(_value(adapter, "Powered", False)),
            discoverable=bool(_value(adapter, "Discoverable", False)),
            pairable=bool(_value(adapter, "Pairable", False)),
            devices=tuple(devices),
        )

    async def device_name(self, path: str) -> str:
        snapshot = await self.snapshot()
        return next(
            (device.name for device in snapshot.devices if device.path == path),
            "Unknown phone",
        )

    async def set_trusted(self, path: str, trusted: bool) -> None:
        await self._set(path, DEVICE, "Trusted", Variant("b", trusted))

    async def connect(self, path: str) -> None:
        interface = await self._interface(path, DEVICE)
        try:
            await interface.call_connect()
        except DBusError as exc:
            if exc.type != "org.bluez.Error.AlreadyConnected":
                raise

    async def disconnect(self, path: str) -> None:
        interface = await self._interface(path, DEVICE)
        try:
            await interface.call_disconnect()
        except DBusError as exc:
            if exc.type != "org.bluez.Error.NotConnected":
                raise

    async def forget(self, path: str) -> None:
        if self.adapter_path is None:
            raise RuntimeError("The Bluetooth adapter is unavailable.")
        adapter = await self._interface(self.adapter_path, ADAPTER)
        await adapter.call_remove_device(path)
