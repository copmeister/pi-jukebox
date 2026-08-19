"""Dedicated unprivileged Bluetooth broker launched by a fixed systemd unit."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import socket
import stat
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pi_jukebox.bluetooth.adapter import safe_device_name
from pi_jukebox.bluetooth.broker import BluetoothBroker, BluetoothConflict
from pi_jukebox.bluetooth.protocol import (
    MAX_PROTOCOL_BYTES,
    BluetoothProtocolError,
    error_response,
    success_response,
    validate_request,
)

LOGGER = logging.getLogger("pi_jukebox.bluetooth.helper")
SOCKET_ROOT = Path("/run/pi-jukebox-bluetooth")


@dataclass(frozen=True, slots=True)
class HelperConfig:
    socket_path: Path
    allowed_uid: int
    alias: str
    pairing_timeout_seconds: int

    @classmethod
    def load(cls, path: Path) -> HelperConfig:
        try:
            raw: Any = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("The Bluetooth helper configuration is unreadable.") from exc
        if not isinstance(raw, dict) or set(raw) != {
            "format_version",
            "socket_path",
            "allowed_uid",
            "alias",
            "pairing_timeout_seconds",
        }:
            raise RuntimeError("The Bluetooth helper configuration is invalid.")
        socket_path = Path(str(raw.get("socket_path", "")))
        try:
            parent = socket_path.parent.resolve(strict=True)
            root = SOCKET_ROOT.resolve(strict=True)
        except OSError as exc:
            raise RuntimeError("The Bluetooth helper runtime directory is unavailable.") from exc
        allowed_uid = raw.get("allowed_uid")
        timeout = raw.get("pairing_timeout_seconds")
        alias = safe_device_name(raw.get("alias"))
        if (
            raw.get("format_version") != 1
            or not socket_path.is_absolute()
            or parent != root
            or socket_path.name != "control.sock"
            or not isinstance(allowed_uid, int)
            or allowed_uid < 1
            or not isinstance(timeout, int)
            or not 30 <= timeout <= 600
            or alias != raw.get("alias")
        ):
            raise RuntimeError("The Bluetooth helper configuration is invalid.")
        return cls(socket_path, allowed_uid, alias, timeout)


class BluetoothHelperServer:
    def __init__(self, config: HelperConfig, broker: BluetoothBroker) -> None:
        self.config = config
        self.broker = broker
        self.server: asyncio.AbstractServer | None = None

    @staticmethod
    def _peer_uid(writer: asyncio.StreamWriter) -> int | None:
        connection = writer.get_extra_info("socket")
        if connection is None or not hasattr(socket, "SO_PEERCRED"):
            return None
        try:
            credentials = connection.getsockopt(
                socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")
            )
        except OSError:
            return None
        _pid, uid, _gid = struct.unpack("3i", credentials)
        return uid

    async def _reply(self, writer: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8") + b"\n"
        writer.write(encoded)
        await writer.drain()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            if self._peer_uid(writer) != self.config.allowed_uid:
                await self._reply(
                    writer,
                    error_response("The Bluetooth helper caller is not permitted.", code="invalid"),
                )
                return
            try:
                encoded = await asyncio.wait_for(reader.readline(), timeout=3.0)
            except TimeoutError:
                await self._reply(writer, error_response("The Bluetooth request timed out."))
                return
            if not encoded or len(encoded) > MAX_PROTOCOL_BYTES or not encoded.endswith(b"\n"):
                await self._reply(
                    writer,
                    error_response("The Bluetooth request is malformed.", code="invalid"),
                )
                return
            try:
                request = validate_request(json.loads(encoded.decode("utf-8")))
                parameters = {
                    key: value
                    for key, value in request.items()
                    if key not in {"protocol", "action"}
                }
                response = await self.broker.perform(request["action"], parameters)
                await self._reply(writer, success_response(response))
            except (UnicodeError, json.JSONDecodeError, BluetoothProtocolError) as exc:
                await self._reply(writer, error_response(str(exc), code="invalid"))
            except BluetoothConflict as exc:
                await self._reply(writer, error_response(str(exc), code="conflict"))
            except Exception:
                LOGGER.exception("Bluetooth helper operation failed")
                await self._reply(
                    writer,
                    error_response("Bluetooth control could not complete that action."),
                )
        finally:
            writer.close()
            await writer.wait_closed()

    async def start(self) -> None:
        existing = self.config.socket_path
        if existing.exists() or existing.is_symlink():
            try:
                mode = existing.lstat().st_mode
            except OSError as exc:
                raise RuntimeError("The Bluetooth helper socket cannot be inspected.") from exc
            if not stat.S_ISSOCK(mode) or existing.is_symlink():
                raise RuntimeError("The Bluetooth helper socket path is unsafe.")
            existing.unlink()
        await self.broker.start()
        self.server = await asyncio.start_unix_server(self.handle, path=existing)
        os.chmod(existing, 0o660)

    async def close(self) -> None:
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()
            self.server = None
        try:
            await self.broker.close()
        finally:
            self.config.socket_path.unlink(missing_ok=True)


async def run(config_path: Path) -> None:
    from pi_jukebox.bluetooth.bluez import BluezAdapter

    config = HelperConfig.load(config_path)
    broker = BluetoothBroker(
        BluezAdapter(),
        alias=config.alias,
        pairing_timeout_seconds=config.pairing_timeout_seconds,
    )
    helper = BluetoothHelperServer(config, broker)
    await helper.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for caught_signal in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(caught_signal, stop.set)
    try:
        await stop.wait()
    finally:
        await helper.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run(arguments.config))


if __name__ == "__main__":
    main()
