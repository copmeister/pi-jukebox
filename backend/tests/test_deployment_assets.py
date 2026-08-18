from pathlib import Path

from pi_jukebox.updates.helper import FIXED_HEALTH_URL

PROJECT_ROOT = Path(__file__).parents[2]
DEPLOYMENT = PROJECT_ROOT / "deployment"


def test_managed_services_preserve_the_existing_kiosk_origin_and_privilege_boundary() -> None:
    launcher = (DEPLOYMENT / "pi-jukebox-launcher.py").read_text(encoding="utf-8")
    application = (DEPLOYMENT / "pi-jukebox-app.service").read_text(encoding="utf-8")
    watcher = (DEPLOYMENT / "pi-jukebox-update.path").read_text(encoding="utf-8")
    updater = (DEPLOYMENT / "pi-jukebox-update.service").read_text(encoding="utf-8")

    assert FIXED_HEALTH_URL == "http://127.0.0.1:5173/api/health"
    assert '"5173"' in launcher
    assert '"8000"' not in launcher
    assert "User=admin" in application
    assert "NoNewPrivileges=true" in application
    assert "ReadWritePaths=/home/admin/jukebox-data -/mnt/jukebox" in application
    assert "PathExists=/home/admin/jukebox-data/updater/request.json" in watcher
    assert "Unit=pi-jukebox-update.service" in watcher
    assert "User=root" in updater
    assert "ConditionPathExists=/home/admin/jukebox-data/updater/request.json" in updater
    assert "WantedBy=" not in updater
    assert "sudo" not in (application + watcher + updater).casefold()
