"""Touchscreen-safe Bluetooth receiver API."""

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Path, Request, status

from pi_jukebox.bluetooth.models import BluetoothStatus
from pi_jukebox.bluetooth.protocol import BluetoothHelperError, BluetoothProtocolError
from pi_jukebox.bluetooth.service import BluetoothService

router = APIRouter(prefix="/bluetooth", tags=["bluetooth"])
ACTION_HEADER = "bluetooth-control"


def _service(request: Request) -> BluetoothService:
    return request.app.state.bluetooth_service


def _mutate(
    request: Request,
    action: str,
    action_header: str | None,
    **parameters: object,
) -> BluetoothStatus:
    if action_header != ACTION_HEADER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This Bluetooth action must originate from the jukebox interface.",
        )
    try:
        return _service(request).perform(action, **parameters)
    except BluetoothHelperError as exc:
        code = (
            status.HTTP_409_CONFLICT
            if exc.code in {"conflict", "invalid"}
            else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    except BluetoothProtocolError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Bluetooth receiver control returned an invalid response.",
        ) from exc


@router.get("/status", response_model=BluetoothStatus)
def bluetooth_status(request: Request) -> BluetoothStatus:
    return _service(request).status()


@router.post("/activate", response_model=BluetoothStatus)
def activate_bluetooth(
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "activate", action)


@router.post("/deactivate", response_model=BluetoothStatus)
def deactivate_bluetooth(
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "deactivate", action)


@router.post("/pairing/start", response_model=BluetoothStatus)
def start_pairing(
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "pairing_start", action)


@router.post("/pairing/cancel", response_model=BluetoothStatus)
def cancel_pairing(
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "pairing_cancel", action)


@router.post("/pairing/{request_id}/accept", response_model=BluetoothStatus)
def accept_pairing(
    request_id: Annotated[str, Path(pattern=r"^[0-9a-f]{24}$")],
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "pairing_confirm", action, request_id=request_id, accept=True)


@router.post("/pairing/{request_id}/reject", response_model=BluetoothStatus)
def reject_pairing(
    request_id: Annotated[str, Path(pattern=r"^[0-9a-f]{24}$")],
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "pairing_confirm", action, request_id=request_id, accept=False)


@router.post("/devices/{device_id}/connect", response_model=BluetoothStatus)
def connect_device(
    device_id: Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")],
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "connect", action, device_id=device_id)


@router.post("/devices/{device_id}/disconnect", response_model=BluetoothStatus)
def disconnect_device(
    device_id: Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")],
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "disconnect", action, device_id=device_id)


@router.delete("/devices/{device_id}", response_model=BluetoothStatus)
def forget_device(
    device_id: Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")],
    request: Request,
    action: Annotated[str | None, Header(alias="X-Pi-Jukebox-Action")] = None,
) -> BluetoothStatus:
    return _mutate(request, "forget", action, device_id=device_id)
