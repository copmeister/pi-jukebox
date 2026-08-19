from pathlib import Path

from pi_jukebox.updates.helper import FIXED_HEALTH_URL

PROJECT_ROOT = Path(__file__).parents[2]
DEPLOYMENT = PROJECT_ROOT / "deployment"


def test_managed_services_preserve_the_existing_kiosk_origin_and_privilege_boundary() -> None:
    launcher = (DEPLOYMENT / "pi-jukebox-launcher.py").read_text(encoding="utf-8")
    application = (DEPLOYMENT / "pi-jukebox-app.service").read_text(encoding="utf-8")
    watcher = (DEPLOYMENT / "pi-jukebox-update.path").read_text(encoding="utf-8")
    updater = (DEPLOYMENT / "pi-jukebox-update.service").read_text(encoding="utf-8")
    bluetooth_launcher = (DEPLOYMENT / "pi-jukebox-bluetooth-launcher.py").read_text(
        encoding="utf-8"
    )
    bluetooth_service = (DEPLOYMENT / "pi-jukebox-bluetooth.service").read_text(encoding="utf-8")
    bluetooth_config = (DEPLOYMENT / "pi-jukebox-bluetooth.json.example").read_text(
        encoding="utf-8"
    )
    wireplumber = (DEPLOYMENT / "80-pi-jukebox-bluetooth.conf").read_text(encoding="utf-8")

    assert FIXED_HEALTH_URL == "http://127.0.0.1:5173/api/health"
    assert '"5173"' in launcher
    assert '"8000"' not in launcher
    assert "User=admin" in application
    assert "NoNewPrivileges=true" in application
    assert "Wants=pi-jukebox-bluetooth.service" in application
    assert "SupplementaryGroups=pi-jukebox-control" in application
    assert "ReadWritePaths=/home/admin/jukebox-data -/mnt/jukebox" in application
    assert "PathExists=/home/admin/jukebox-data/updater/request.json" in watcher
    assert "Unit=pi-jukebox-update.service" in watcher
    assert "User=root" in updater
    assert "ConditionPathExists=/home/admin/jukebox-data/updater/request.json" in updater
    assert "WantedBy=" not in updater
    assert "User=pi-jukebox-bt" in bluetooth_service
    assert "SupplementaryGroups=bluetooth" in bluetooth_service
    assert "PrivateNetwork=true" in bluetooth_service
    assert "RestrictAddressFamilies=AF_UNIX" in bluetooth_service
    assert "PartOf=pi-jukebox-app.service" in bluetooth_service
    assert "ExecStart=/usr/local/libexec/pi-jukebox-bluetooth-launcher" in bluetooth_service
    assert "pi_jukebox.bluetooth.helper" in bluetooth_launcher
    assert "subprocess" not in bluetooth_launcher
    assert '"allowed_uid": 1000' in bluetooth_config
    assert '"pairing_timeout_seconds": 120' in bluetooth_config
    assert "bluez5.roles = [ a2dp_sink ]" in wireplumber
    assert 'bluez5.media-source-role = "playback"' in wireplumber
    assert (
        "sudo"
        not in (application + watcher + updater + bluetooth_service + bluetooth_launcher).casefold()
    )
