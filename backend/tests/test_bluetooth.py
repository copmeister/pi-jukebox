import asyncio
import json
from dataclasses import replace
from pathlib import Path

import pytest
from pi_jukebox.bluetooth import helper as helper_module
from pi_jukebox.bluetooth.adapter import (
    BluezDevice,
    BluezSnapshot,
    public_device_id,
    safe_device_name,
    supports_a2dp_source,
)
from pi_jukebox.bluetooth.bluez import PiJukeboxAgent
from pi_jukebox.bluetooth.broker import BluetoothBroker, BluetoothConflict
from pi_jukebox.bluetooth.helper import HelperConfig
from pi_jukebox.bluetooth.models import BluetoothPlaybackState, BluetoothStatus
from pi_jukebox.bluetooth.protocol import (
    BluetoothHelperError,
    BluetoothProtocolError,
    error_response,
    parse_response,
    success_response,
    validate_request,
)


def test_bluez_agent_decorators_load() -> None:
    assert PiJukeboxAgent.__name__ == "PiJukeboxAgent"


def device(
    path: str,
    name: str,
    *,
    paired: bool = True,
    trusted: bool = True,
    connected: bool = False,
    audio_playing: bool = False,
    audio_source_capable: bool = True,
) -> BluezDevice:
    return BluezDevice(
        path=path,
        id=public_device_id(path),
        name=name,
        paired=paired,
        trusted=trusted,
        connected=connected,
        audio_playing=audio_playing,
        audio_source_capable=audio_source_capable,
    )


class FakeAdapter:
    def __init__(self, devices: list[BluezDevice] | None = None) -> None:
        self.devices = devices or []
        self.alias = "Pi Jukebox"
        self.pairable = False
        self.discoverable = False
        self.authorize = None
        self.pairing_changes: list[bool] = []
        self.connected: list[str] = []
        self.transport_waits: list[str] = []
        self.disconnected: list[str] = []
        self.trusted: list[str] = []
        self.forgotten: list[str] = []
        self.closed = False

    def set_authorizer(self, authorize) -> None:
        self.authorize = authorize

    async def initialize(self, alias: str, pairing_timeout_seconds: int) -> None:
        self.alias = alias
        assert pairing_timeout_seconds > 0

    async def close(self) -> None:
        self.closed = True

    async def set_pairing(self, enabled: bool, timeout_seconds: int) -> None:
        assert timeout_seconds > 0
        self.pairable = enabled
        self.discoverable = enabled
        self.pairing_changes.append(enabled)

    async def snapshot(self) -> BluezSnapshot:
        return BluezSnapshot(
            alias=self.alias,
            powered=True,
            discoverable=self.discoverable,
            pairable=self.pairable,
            devices=tuple(self.devices),
        )

    async def device_name(self, path: str) -> str:
        return next((item.name for item in self.devices if item.path == path), "Unknown phone")

    async def set_trusted(self, path: str, trusted: bool) -> None:
        assert trusted
        self.trusted.append(path)
        self.devices = [
            replace(item, trusted=True) if item.path == path else item for item in self.devices
        ]

    async def connect(self, path: str) -> None:
        self.connected.append(path)
        self.devices = [
            replace(item, connected=True) if item.path == path else item for item in self.devices
        ]

    async def wait_for_audio_transport(self, path: str) -> bool:
        self.transport_waits.append(path)
        return True

    async def disconnect(self, path: str) -> None:
        self.disconnected.append(path)
        self.devices = [
            replace(item, connected=False, audio_playing=False) if item.path == path else item
            for item in self.devices
        ]

    async def forget(self, path: str) -> None:
        self.forgotten.append(path)
        self.devices = [item for item in self.devices if item.path != path]


def run(coroutine):
    return asyncio.run(coroutine)


def test_public_identifiers_and_names_do_not_expose_bluez_paths() -> None:
    path = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
    identifier = public_device_id(path)
    assert len(identifier) == 16
    assert path not in identifier
    assert safe_device_name("  Alice\x00\nPhone  ") == "AlicePhone"
    assert safe_device_name("") == "Unknown phone"
    assert supports_a2dp_source(["0000110A-0000-1000-8000-00805F9B34FB"])
    assert not supports_a2dp_source(["0000110b-0000-1000-8000-00805f9b34fb"])
    assert not supports_a2dp_source("0000110a-0000-1000-8000-00805f9b34fb")


def test_helper_protocol_rejects_extra_fields_and_invalid_identifiers() -> None:
    assert validate_request({"protocol": 1, "action": "status"})["action"] == "status"
    with pytest.raises(BluetoothProtocolError):
        validate_request({"protocol": 1, "action": "status", "command": "anything"})
    with pytest.raises(BluetoothProtocolError):
        validate_request({"protocol": 1, "action": "connect", "device_id": "../adapter"})

    status = BluetoothStatus.unavailable("Not configured.")
    assert parse_response(success_response(status)) == status
    with pytest.raises(BluetoothHelperError, match="busy") as rejected:
        parse_response(error_response("The helper is busy.", code="conflict"))
    assert rejected.value.code == "conflict"


def test_helper_configuration_confines_the_socket_and_caller(tmp_path: Path, monkeypatch) -> None:
    runtime = tmp_path / "run" / "pi-jukebox-bluetooth"
    runtime.mkdir(parents=True)
    monkeypatch.setattr(helper_module, "SOCKET_ROOT", runtime)
    config_path = tmp_path / "helper.json"
    valid = {
        "format_version": 1,
        "socket_path": str(runtime / "control.sock"),
        "allowed_uid": 1000,
        "alias": "Pi Jukebox",
        "pairing_timeout_seconds": 120,
    }
    config_path.write_text(json.dumps(valid), encoding="utf-8")
    loaded = HelperConfig.load(config_path)
    assert loaded.allowed_uid == 1000
    assert loaded.socket_path == runtime / "control.sock"

    config_path.write_text(
        json.dumps({**valid, "socket_path": str(tmp_path / "other.sock")}),
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="invalid"):
        HelperConfig.load(config_path)

    config_path.write_text(json.dumps({**valid, "command": "anything"}), encoding="utf-8")
    with pytest.raises(RuntimeError, match="invalid"):
        HelperConfig.load(config_path)


def test_pairing_window_requires_one_touchscreen_confirmation_and_trusts_result() -> None:
    async def scenario() -> None:
        path = "/org/bluez/hci0/dev_01_02_03_04_05_06"
        adapter = FakeAdapter([device(path, "Alice's Phone", paired=False, trusted=False)])
        broker = BluetoothBroker(adapter, pairing_timeout_seconds=120)
        await broker.start()
        assert adapter.pairing_changes[-1] is False

        pairing = await broker.start_pairing()
        assert pairing.state is BluetoothPlaybackState.PAIRING
        assert pairing.discoverable and pairing.pairable

        authorization = asyncio.create_task(broker.authorize(path, "confirm", "123456"))
        await asyncio.sleep(0)
        pending = await broker.status()
        assert pending.pending_pairing is not None
        assert pending.pending_pairing.passkey == "123456"

        await broker.confirm_pairing(pending.pending_pairing.id, True)
        assert await authorization is True
        assert adapter.pairing_changes[-1] is False
        assert await broker.authorize(path, "authorize", None) is True
        adapter.devices = [replace(adapter.devices[0], paired=True)]
        accepted = await broker.status()
        assert accepted.devices[0].trusted is True
        assert adapter.trusted == [path]

        await broker.cancel_pairing()
        assert adapter.pairing_changes[-1] is False
        await broker.connect(public_device_id(path))
        await broker.close()
        assert adapter.closed
        assert path in adapter.disconnected

    run(scenario())


def test_pairing_rejects_stale_requests_and_inactive_connections() -> None:
    async def scenario() -> None:
        path = "/org/bluez/hci0/dev_10_20_30_40_50_60"
        adapter = FakeAdapter([device(path, "Guest Phone", paired=False, trusted=False)])
        broker = BluetoothBroker(adapter)
        await broker.start()
        assert await broker.authorize(path, "authorize", None) is False
        with pytest.raises(BluetoothConflict, match="no longer active"):
            await broker.confirm_pairing("0" * 24, True)
        await broker.close()

    run(scenario())


def test_connect_switches_one_trusted_phone_and_deactivate_disconnects_it() -> None:
    async def scenario() -> None:
        first_path = "/org/bluez/hci0/dev_AA_AA_AA_AA_AA_AA"
        second_path = "/org/bluez/hci0/dev_BB_BB_BB_BB_BB_BB"
        adapter = FakeAdapter(
            [
                device(first_path, "First Phone", connected=True),
                device(second_path, "Second Phone"),
            ]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        assert first_path in adapter.disconnected

        status = await broker.connect(public_device_id(second_path))
        assert status.mode_active
        assert status.connected_device_id == public_device_id(second_path)
        assert adapter.connected == [second_path]
        assert adapter.transport_waits == [second_path]

        stopped = await broker.deactivate()
        assert stopped.state is BluetoothPlaybackState.INACTIVE
        assert second_path in adapter.disconnected
        await broker.close()

    run(scenario())


def test_first_pair_reconnects_profile_and_waits_for_a2dp_transport() -> None:
    async def scenario() -> None:
        path = "/org/bluez/hci0/dev_12_34_56_78_90_AB"
        adapter = FakeAdapter(
            [device(path, "New Phone", paired=False, trusted=False, connected=True)]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        await broker.activate()
        broker.approved_paths.add(path)

        adapter.devices = [replace(adapter.devices[0], paired=True, connected=True)]
        status = await broker.status()

        assert adapter.trusted == [path]
        assert adapter.connected == [path]
        assert adapter.transport_waits == [path]
        assert status.connected_device_id == public_device_id(path)
        await broker.close()

    run(scenario())


def test_untrusted_phone_cannot_connect_and_forget_removes_only_selected_device() -> None:
    async def scenario() -> None:
        trusted_path = "/org/bluez/hci0/dev_11_11_11_11_11_11"
        untrusted_path = "/org/bluez/hci0/dev_22_22_22_22_22_22"
        adapter = FakeAdapter(
            [
                device(trusted_path, "Trusted Phone"),
                device(untrusted_path, "Untrusted Phone", trusted=False),
            ]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        with pytest.raises(BluetoothConflict, match="paired and trusted"):
            await broker.connect(public_device_id(untrusted_path))
        await broker.forget(public_device_id(trusted_path))
        assert adapter.forgotten == [trusted_path]
        assert len(adapter.devices) == 1
        await broker.close()

    run(scenario())


def test_only_a2dp_audio_sources_are_listed_or_manageable() -> None:
    async def scenario() -> None:
        phone_path = "/org/bluez/hci0/dev_31_31_31_31_31_31"
        keyboard_path = "/org/bluez/hci0/dev_32_32_32_32_32_32"
        speaker_path = "/org/bluez/hci0/dev_33_33_33_33_33_33"
        adapter = FakeAdapter(
            [
                device(phone_path, "Audio phone"),
                device(
                    keyboard_path,
                    "Keyboard",
                    connected=True,
                    audio_source_capable=False,
                ),
                device(speaker_path, "Speaker", audio_source_capable=False),
            ]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()

        status = await broker.status()
        assert [item.name for item in status.devices] == ["Audio phone"]
        assert keyboard_path not in adapter.disconnected

        for path in (keyboard_path, speaker_path):
            identifier = public_device_id(path)
            with pytest.raises(BluetoothConflict, match="audio-source"):
                await broker.connect(identifier)
            with pytest.raises(BluetoothConflict, match="audio-source"):
                await broker.disconnect(identifier)
            with pytest.raises(BluetoothConflict, match="audio-source"):
                await broker.forget(identifier)
        assert adapter.forgotten == []
        await broker.close()

    run(scenario())


def test_approved_non_audio_peripheral_is_not_trusted_or_exposed() -> None:
    async def scenario() -> None:
        path = "/org/bluez/hci0/dev_34_34_34_34_34_34"
        adapter = FakeAdapter(
            [
                device(
                    path,
                    "Game controller",
                    paired=False,
                    trusted=False,
                    audio_source_capable=False,
                )
            ]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        await broker.start_pairing()

        authorization = asyncio.create_task(broker.authorize(path, "confirm", "654321"))
        await asyncio.sleep(0)
        pending = await broker.status()
        assert pending.pending_pairing is not None
        await broker.confirm_pairing(pending.pending_pairing.id, True)
        assert await authorization is True

        adapter.devices = [replace(adapter.devices[0], paired=True)]
        status = await broker.status()
        assert status.devices == []
        assert adapter.trusted == []
        await broker.close()

    run(scenario())


def test_unsolicited_reconnects_preserve_selected_phone_and_disconnect_extras() -> None:
    async def scenario() -> None:
        first_path = "/org/bluez/hci0/dev_41_41_41_41_41_41"
        second_path = "/org/bluez/hci0/dev_42_42_42_42_42_42"
        adapter = FakeAdapter(
            [device(first_path, "First phone"), device(second_path, "Second phone")]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        await broker.connect(public_device_id(first_path))

        adapter.devices = [
            replace(item, connected=True) if item.path == second_path else item
            for item in adapter.devices
        ]
        status = await broker.status()
        assert status.connected_device_id == public_device_id(first_path)
        assert adapter.disconnected.count(second_path) == 1

        await broker.status()
        assert adapter.disconnected.count(second_path) == 1
        await broker.close()

    run(scenario())


def test_reconciliation_promotes_remaining_phone_and_resolves_simultaneous_reconnects() -> None:
    async def scenario() -> None:
        first_path = "/org/bluez/hci0/dev_51_51_51_51_51_51"
        second_path = "/org/bluez/hci0/dev_52_52_52_52_52_52"
        adapter = FakeAdapter(
            [device(first_path, "First phone"), device(second_path, "Second phone")]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        await broker.connect(public_device_id(first_path))

        adapter.devices = [
            replace(item, connected=item.path == second_path) for item in adapter.devices
        ]
        promoted = await broker.status()
        assert promoted.connected_device_id == public_device_id(second_path)

        await broker.disconnect(public_device_id(second_path))
        adapter.devices = [
            replace(
                item,
                connected=True,
                audio_playing=item.path == second_path,
            )
            for item in adapter.devices
        ]
        simultaneous = await broker.status()
        assert simultaneous.connected_device_id == public_device_id(second_path)
        assert first_path in adapter.disconnected
        await broker.close()

    run(scenario())


def test_inactive_mode_disconnects_only_audio_sources() -> None:
    async def scenario() -> None:
        phone_path = "/org/bluez/hci0/dev_61_61_61_61_61_61"
        keyboard_path = "/org/bluez/hci0/dev_62_62_62_62_62_62"
        adapter = FakeAdapter(
            [
                device(phone_path, "Phone", connected=True),
                device(
                    keyboard_path,
                    "Keyboard",
                    connected=True,
                    audio_source_capable=False,
                ),
            ]
        )
        broker = BluetoothBroker(adapter)
        await broker.start()
        assert phone_path in adapter.disconnected
        assert keyboard_path not in adapter.disconnected
        assert [item.name for item in (await broker.status()).devices] == ["Phone"]
        await broker.close()

    run(scenario())
