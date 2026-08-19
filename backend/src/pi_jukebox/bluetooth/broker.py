"""Stateful, race-safe policy for the isolated BlueZ helper."""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from time import monotonic
from typing import Protocol

from pi_jukebox.bluetooth.adapter import BluezDevice, BluezSnapshot, public_device_id
from pi_jukebox.bluetooth.models import (
    BluetoothDevice,
    BluetoothPairingRequest,
    BluetoothPlaybackState,
    BluetoothStatus,
)


class AdapterControl(Protocol):
    def set_authorizer(
        self, authorize: Callable[[str, str, str | None], Awaitable[bool]]
    ) -> None: ...

    async def initialize(self, alias: str, pairing_timeout_seconds: int) -> None: ...

    async def close(self) -> None: ...

    async def set_pairing(self, enabled: bool, timeout_seconds: int) -> None: ...

    async def snapshot(self) -> BluezSnapshot: ...

    async def device_name(self, path: str) -> str: ...

    async def set_trusted(self, path: str, trusted: bool) -> None: ...

    async def connect(self, path: str) -> None: ...

    async def disconnect(self, path: str) -> None: ...

    async def forget(self, path: str) -> None: ...


class BluetoothConflict(RuntimeError):
    """A requested action is unsafe for the broker's current state."""


@dataclass(slots=True)
class PendingAuthorization:
    request: BluetoothPairingRequest
    device_path: str
    decision: asyncio.Future[bool]


class BluetoothBroker:
    def __init__(
        self,
        adapter: AdapterControl,
        *,
        alias: str = "Pi Jukebox",
        pairing_timeout_seconds: int = 120,
    ) -> None:
        self.adapter = adapter
        self.alias = alias
        self.pairing_timeout_seconds = pairing_timeout_seconds
        self.mode_active = False
        self.pairing_deadline = 0.0
        self.pending: PendingAuthorization | None = None
        self.approved_paths: set[str] = set()
        self.active_device_path: str | None = None
        self._pairing_timer: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self.adapter.set_authorizer(self.authorize)

    async def start(self) -> None:
        await self.adapter.initialize(self.alias, self.pairing_timeout_seconds)
        await self._deactivate_locked()

    async def close(self) -> None:
        async with self._lock:
            try:
                await self._deactivate_locked()
            finally:
                await self.adapter.close()

    def _cancel_timer(self) -> None:
        if self._pairing_timer is not None:
            self._pairing_timer.cancel()
            self._pairing_timer = None

    def _reject_pending(self) -> None:
        if self.pending is not None and not self.pending.decision.done():
            self.pending.decision.set_result(False)
        self.pending = None

    async def _pairing_timeout(self) -> None:
        try:
            await asyncio.sleep(self.pairing_timeout_seconds)
            async with self._lock:
                self.pairing_deadline = 0.0
                self._reject_pending()
                await self.adapter.set_pairing(False, self.pairing_timeout_seconds)
        except asyncio.CancelledError:
            return
        finally:
            self._pairing_timer = None

    async def _deactivate_locked(self) -> None:
        self.mode_active = False
        self.active_device_path = None
        self.pairing_deadline = 0.0
        self._cancel_timer()
        self._reject_pending()
        await self.adapter.set_pairing(False, self.pairing_timeout_seconds)
        snapshot = await self.adapter.snapshot()
        for device in snapshot.devices:
            if device.audio_source_capable and device.connected:
                await self.adapter.disconnect(device.path)

    async def authorize(self, device_path: str, kind: str, passkey: str | None) -> bool:
        async with self._lock:
            snapshot = await self.adapter.snapshot()
            existing = next(
                (device for device in snapshot.devices if device.path == device_path), None
            )
            if self.mode_active and (
                device_path in self.approved_paths
                or (existing and existing.trusted and existing.audio_source_capable)
            ):
                return True
            remaining = self._remaining_seconds()
            if not self.mode_active or remaining <= 0:
                return False
            if self.pending is not None:
                if self.pending.device_path == device_path:
                    decision = self.pending.decision
                else:
                    return False
            else:
                request = BluetoothPairingRequest(
                    id=secrets.token_hex(12),
                    device_id=public_device_id(device_path),
                    device_name=(
                        existing.name if existing else await self.adapter.device_name(device_path)
                    ),
                    kind=kind,
                    passkey=passkey,
                )
                decision = asyncio.get_running_loop().create_future()
                self.pending = PendingAuthorization(request, device_path, decision)
        try:
            accepted = await asyncio.wait_for(
                asyncio.shield(decision), timeout=max(1, min(60, remaining))
            )
        except TimeoutError:
            accepted = False
        async with self._lock:
            if self.pending is not None and self.pending.decision is decision:
                self.pending = None
            if accepted:
                self.approved_paths.add(device_path)
                self.pairing_deadline = 0.0
                self._cancel_timer()
                await self.adapter.set_pairing(False, self.pairing_timeout_seconds)
            return accepted

    def _remaining_seconds(self) -> int:
        if self.pairing_deadline <= 0:
            return 0
        return max(
            0, min(self.pairing_timeout_seconds, int(self.pairing_deadline - monotonic() + 0.999))
        )

    async def _snapshot_and_reconcile(self) -> BluezSnapshot:
        snapshot = await self.adapter.snapshot()
        for device in snapshot.devices:
            if (
                device.path in self.approved_paths
                and device.audio_source_capable
                and device.paired
                and not device.trusted
            ):
                await self.adapter.set_trusted(device.path, True)
                snapshot = await self.adapter.snapshot()
                break

        connected = [
            device
            for device in snapshot.devices
            if device.audio_source_capable and device.connected
        ]
        if not self.mode_active:
            self.active_device_path = None
            for device in connected:
                await self.adapter.disconnect(device.path)
            if connected:
                snapshot = await self.adapter.snapshot()
        elif connected:
            winner = next(
                (device for device in connected if device.path == self.active_device_path),
                None,
            )
            if winner is None:
                winner = min(connected, key=lambda item: (not item.audio_playing, item.path))
            self.active_device_path = winner.path
            extras = [device for device in connected if device.path != winner.path]
            for device in extras:
                await self.adapter.disconnect(device.path)
            if extras:
                snapshot = await self.adapter.snapshot()
        else:
            self.active_device_path = None
        return snapshot

    @staticmethod
    def _public_devices(snapshot: BluezSnapshot) -> list[BluetoothDevice]:
        visible = [
            device
            for device in snapshot.devices
            if device.audio_source_capable and (device.paired or device.trusted or device.connected)
        ]
        visible.sort(key=lambda item: (not item.connected, item.name.casefold(), item.id))
        return [
            BluetoothDevice(
                id=device.id,
                name=device.name,
                paired=device.paired,
                trusted=device.trusted,
                connected=device.connected,
                audio_playing=device.audio_playing,
            )
            for device in visible
        ]

    async def status(self) -> BluetoothStatus:
        async with self._lock:
            snapshot = await self._snapshot_and_reconcile()
            devices = self._public_devices(snapshot)
            active_id = next(
                (item.id for item in snapshot.devices if item.path == self.active_device_path),
                None,
            )
            connected = next(
                (device for device in devices if device.connected and device.id == active_id),
                None,
            )
            remaining = self._remaining_seconds()
            if remaining > 0:
                state = BluetoothPlaybackState.PAIRING
                message = f"Pi Jukebox is available for pairing for {remaining} seconds."
            elif not self.mode_active:
                state = BluetoothPlaybackState.INACTIVE
                message = "Bluetooth mode is off. Local jukebox playback remains available."
            elif connected and connected.audio_playing:
                state = BluetoothPlaybackState.AUDIO_PLAYING
                message = f"Playing audio from {connected.name}."
            elif connected:
                state = BluetoothPlaybackState.CONNECTED
                message = f"Connected to {connected.name}. Start audio on the phone."
            else:
                state = BluetoothPlaybackState.NOT_CONNECTED
                message = "Bluetooth mode is ready. Connect a trusted phone or pair a new one."
            return BluetoothStatus(
                available=True,
                mode_active=self.mode_active,
                state=state,
                adapter_alias=snapshot.alias,
                discoverable=snapshot.discoverable,
                pairable=snapshot.pairable,
                pairing_seconds_remaining=remaining,
                connected_device_id=connected.id if connected else None,
                devices=devices,
                pending_pairing=self.pending.request if self.pending else None,
                message=message,
            )

    async def activate(self) -> BluetoothStatus:
        async with self._lock:
            self.mode_active = True
            await self.adapter.set_pairing(False, self.pairing_timeout_seconds)
        return await self.status()

    async def deactivate(self) -> BluetoothStatus:
        async with self._lock:
            await self._deactivate_locked()
        return await self.status()

    async def start_pairing(self) -> BluetoothStatus:
        async with self._lock:
            self.mode_active = True
            self._cancel_timer()
            self._reject_pending()
            self.pairing_deadline = monotonic() + self.pairing_timeout_seconds
            await self.adapter.set_pairing(True, self.pairing_timeout_seconds)
            self._pairing_timer = asyncio.create_task(self._pairing_timeout())
        return await self.status()

    async def cancel_pairing(self) -> BluetoothStatus:
        async with self._lock:
            self.pairing_deadline = 0.0
            self._cancel_timer()
            self._reject_pending()
            await self.adapter.set_pairing(False, self.pairing_timeout_seconds)
        return await self.status()

    async def confirm_pairing(self, request_id: str, accept: bool) -> BluetoothStatus:
        async with self._lock:
            if self.pending is None or self.pending.request.id != request_id:
                raise BluetoothConflict("That pairing request is no longer active.")
            if not self.pending.decision.done():
                self.pending.decision.set_result(accept)
        await asyncio.sleep(0)
        return await self.status()

    async def _device(self, device_id: str) -> BluezDevice:
        snapshot = await self.adapter.snapshot()
        device = next(
            (
                item
                for item in snapshot.devices
                if item.id == device_id
                and item.audio_source_capable
                and (item.paired or item.trusted or item.connected)
            ),
            None,
        )
        if device is None:
            raise BluetoothConflict("That Bluetooth audio-source device is no longer available.")
        return device

    async def connect(self, device_id: str) -> BluetoothStatus:
        async with self._lock:
            self.mode_active = True
            device = await self._device(device_id)
            if not device.paired or not device.trusted:
                raise BluetoothConflict("Only a paired and trusted phone can be connected.")
            snapshot = await self.adapter.snapshot()
            for connected in snapshot.devices:
                if (
                    connected.audio_source_capable
                    and connected.connected
                    and connected.path != device.path
                ):
                    await self.adapter.disconnect(connected.path)
            await self.adapter.connect(device.path)
            self.active_device_path = device.path
        return await self.status()

    async def disconnect(self, device_id: str) -> BluetoothStatus:
        async with self._lock:
            device = await self._device(device_id)
            if device.connected:
                await self.adapter.disconnect(device.path)
            if self.active_device_path == device.path:
                self.active_device_path = None
        return await self.status()

    async def forget(self, device_id: str) -> BluetoothStatus:
        async with self._lock:
            device = await self._device(device_id)
            if device.connected:
                await self.adapter.disconnect(device.path)
            if self.active_device_path == device.path:
                self.active_device_path = None
            self.approved_paths.discard(device.path)
            await self.adapter.forget(device.path)
        return await self.status()

    async def perform(self, action: str, parameters: dict[str, object]) -> BluetoothStatus:
        if action == "status":
            return await self.status()
        if action == "activate":
            return await self.activate()
        if action == "deactivate":
            return await self.deactivate()
        if action == "pairing_start":
            return await self.start_pairing()
        if action == "pairing_cancel":
            return await self.cancel_pairing()
        if action == "pairing_confirm":
            return await self.confirm_pairing(
                str(parameters["request_id"]), bool(parameters["accept"])
            )
        if action == "connect":
            return await self.connect(str(parameters["device_id"]))
        if action == "disconnect":
            return await self.disconnect(str(parameters["device_id"]))
        if action == "forget":
            return await self.forget(str(parameters["device_id"]))
        raise BluetoothConflict("That Bluetooth action is not supported.")
