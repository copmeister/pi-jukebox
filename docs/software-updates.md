# Safe software updates

This document defines the Pi Jukebox release channel, package format, one-time
Raspberry Pi migration, recovery procedure and physical acceptance tests. The
updater is a hardware-test candidate until both a real update and a deliberate
rollback have succeeded on the physical Pi.

## Trust and process boundary

Production updates come only from published, stable GitHub Releases in
`copmeister/pi-jukebox`. Drafts, prereleases, branch heads and ordinary commits
on `main` are not installable.

```text
Settings
   |
   | POST /api/system/updates/install (no version or path supplied by browser)
   v
FastAPI writes /home/admin/jukebox-data/updater/request.json
   |
   | root-owned pi-jukebox-update.path observes that one fixed file
   v
root-owned one-shot updater service
   |-- reads semver-only request once
   |-- uses /home/admin/.config/gh through authenticated gh CLI
   |-- downloads two exact assets for the matching stable tag
   |-- validates manifest, archive and every extracted file
   |-- prepares an offline per-release virtual environment
   |-- atomically replaces current-version
   |-- restarts pi-jukebox-app.service
   |-- verifies /api/health and the requested application version
   `-- restores the previous pointer and restarts it on failure
```

The application account receives no sudo permission. The root-owned systemd
path unit observes only the fixed request file and starts the fixed updater
service. The browser cannot supply a command, repository, URL, asset name,
destination or credential.

Update progress is written by root to
`/var/lib/pi-jukebox-updater/status.json`, which the application can read but
cannot replace. Local data and the semver request remain under
`/home/admin/jukebox-data`; music remains under `/mnt/jukebox/Music`.

## Release asset format

A stable `v0.6.0` release must contain these two exact named assets:

```text
pi-jukebox-v0.6.0.tar.gz
pi-jukebox-v0.6.0-manifest.json
```

The archive contains only regular files. It has no links, device entries or
absolute/traversing paths:

```text
app/pi_jukebox-0.6.0-py3-none-any.whl
requirements.lock
wheelhouse/*.whl
frontend/dist/index.html
frontend/dist/assets/*
```

`requirements.lock` is generated with hashes. `wheelhouse` contains all
Python dependencies for 64-bit Raspberry Pi OS. `frontend/dist` is built before
publication, so the production Pi neither downloads Python packages nor needs
Node during installation. Every version receives its own `.venv`.

The external manifest format is:

```json
{
  "format_version": 1,
  "application_version": "0.6.0",
  "archive": {
    "filename": "pi-jukebox-v0.6.0.tar.gz",
    "sha256": "64-lowercase-hex-characters"
  },
  "compatibility": {
    "architecture": "aarch64",
    "python": "3.13"
  },
  "files": {
    "app/pi_jukebox-0.6.0-py3-none-any.whl": "sha256",
    "requirements.lock": "sha256",
    "wheelhouse/example.whl": "sha256",
    "frontend/dist/index.html": "sha256"
  }
}
```

The helper rejects unknown manifest structure, incorrect filenames, invalid
semantic versions, incompatible architecture/Python, missing files, extra
archive files, checksum mismatches, duplicate paths, traversal, absolute paths,
symlinks, hardlinks, devices, oversized members and archives over the defined
limits. GitHub's advertised asset sizes are checked before download and must
match the completed files; timeouts and retries are bounded.

## One-time Raspberry Pi migration

Perform this from SSH during a maintenance window. Keep a second SSH session
open throughout the cutover. These commands preserve the working checkout and
do not edit the current labwc startup script until the managed bootstrap
release has passed its health and data checks.

First confirm the reviewed commit, 64-bit OS, Python, Node 22, storage and both
normal-user and headless root-context private GitHub access:

```bash
set -euo pipefail
cd /home/admin/jukebox
git status --short
test -z "$(git status --porcelain)"
git switch main
git pull --ff-only origin main

test "$(uname -m)" = aarch64
python3 --version
node --version
findmnt --target /mnt/jukebox
df -h /home/admin /mnt/jukebox

sudo apt update
sudo apt install -y python3-venv
gh auth status
sudo env -i PATH=/usr/bin:/bin HOME=/home/admin \
  GH_CONFIG_DIR=/home/admin/.config/gh GH_NO_UPDATE_NOTIFIER=1 \
  GH_PROMPT_DISABLED=1 LANG=C.UTF-8 \
  /usr/bin/gh api --method GET \
  repos/copmeister/pi-jukebox/releases -f per_page=1 >/dev/null

npm ci --prefix frontend
npm run build --prefix frontend
```

If `git status --short` prints anything, `uname` is not `aarch64`, Node is not
v22, the external filesystem is not mounted, or either `gh` command fails, stop
before changing services. Do not install Debian's older Node package. `npm ci`
replaces the checkout's development dependencies, so do this while the current
Vite jukebox is idle. Future managed releases use prebuilt frontend assets and
do not invoke Node on the live version.

Create external configuration and state. `install -d` preserves the existing
database/artwork directory, and `cp -n` never replaces an earlier external
configuration:

```bash
sudo install -d -o admin -g admin -m 0750 /home/admin/jukebox-data
sudo cp -n /home/admin/jukebox/.env /home/admin/jukebox-data/jukebox.env
sudo chown admin:admin /home/admin/jukebox-data/jukebox.env
sudo chmod 0600 /home/admin/jukebox-data/jukebox.env
sudo install -d -o admin -g admin -m 0700 /home/admin/jukebox-data/updater
sudo install -d -o root -g root -m 0755 /var/lib/pi-jukebox-updater
```

Edit `/home/admin/jukebox-data/jukebox.env`. It must contain plain `KEY=value`
lines suitable for a systemd `EnvironmentFile`. Preserve other reviewed
settings, but make every runtime path absolute; relative `./data` would point
inside the immutable release and must not be used:

```dotenv
PI_JUKEBOX_ENVIRONMENT=production
PI_JUKEBOX_HOST=127.0.0.1
PI_JUKEBOX_PORT=5173
PI_JUKEBOX_DATA_DIRECTORY=/home/admin/jukebox-data
PI_JUKEBOX_MUSIC_LIBRARY_PATH=/mnt/jukebox/Music
PI_JUKEBOX_OPTICAL_DRIVE_PATH=/dev/sr0
PI_JUKEBOX_EXTERNAL_STORAGE_PATH=/mnt/jukebox
PI_JUKEBOX_RIP_OUTPUT_PATH=/mnt/jukebox/Music
PI_JUKEBOX_RIP_STAGING_PATH=/mnt/jukebox/.pi-jukebox-rip-staging
PI_JUKEBOX_FRONTEND_DIRECTORY=frontend/dist
PI_JUKEBOX_UPDATE_CHECK_ENABLED=true
PI_JUKEBOX_UPDATE_INSTALL_ENABLED=true
PI_JUKEBOX_UPDATE_REQUEST_PATH=/home/admin/jukebox-data/updater/request.json
PI_JUKEBOX_UPDATE_STATUS_PATH=/var/lib/pi-jukebox-updater/status.json
```

Create the immutable bootstrap version from tracked files only, then add the
already-built production frontend. This does not copy `.env`, runtime data,
Git history, dependency folders, logs, caches or music:

```bash
test ! -e /home/admin/pi-jukebox-releases/releases/0.5.0
test ! -e /home/admin/pi-jukebox-releases/current-version
sudo install -d -o root -g root -m 0755 \
  /home/admin/pi-jukebox-releases/releases/0.5.0
bootstrap_archive="$(mktemp /tmp/pi-jukebox-bootstrap.XXXXXX.tar)"
git archive --format=tar --output="$bootstrap_archive" HEAD
sudo tar --extract --file="$bootstrap_archive" \
  --directory=/home/admin/pi-jukebox-releases/releases/0.5.0
rm -- "$bootstrap_archive"
sudo install -d -o root -g root -m 0755 \
  /home/admin/pi-jukebox-releases/releases/0.5.0/frontend/dist
sudo cp -a frontend/dist/. \
  /home/admin/pi-jukebox-releases/releases/0.5.0/frontend/dist/
sudo chown -R root:root \
  /home/admin/pi-jukebox-releases/releases/0.5.0
sudo python3 -m venv \
  /home/admin/pi-jukebox-releases/releases/0.5.0/.venv
sudo /home/admin/pi-jukebox-releases/releases/0.5.0/.venv/bin/python \
  -m pip install /home/admin/pi-jukebox-releases/releases/0.5.0
test "$(sudo /home/admin/pi-jukebox-releases/releases/0.5.0/.venv/bin/python \
  -c 'from pi_jukebox.version import __version__; print(__version__)')" = 0.5.0
printf '0.5.0\n' | sudo tee \
  /home/admin/pi-jukebox-releases/current-version >/dev/null
sudo chown root:root /home/admin/pi-jukebox-releases/current-version
sudo chmod 0644 /home/admin/pi-jukebox-releases/current-version
```

Install the fixed launchers, root configuration, application service and
request-file path/service pair:

```bash
cd /home/admin/jukebox
sudo install -o root -g root -m 0755 \
  deployment/pi-jukebox-launcher.py \
  /usr/local/libexec/pi-jukebox-launcher
sudo install -o root -g root -m 0755 \
  deployment/pi-jukebox-update-entrypoint.py \
  /usr/local/libexec/pi-jukebox-update-entrypoint
sudo install -o root -g root -m 0644 \
  deployment/pi-jukebox-app.service \
  /etc/systemd/system/pi-jukebox-app.service
sudo install -o root -g root -m 0644 \
  deployment/pi-jukebox-update.service \
  /etc/systemd/system/pi-jukebox-update.service
sudo install -o root -g root -m 0644 \
  deployment/pi-jukebox-update.path \
  /etc/systemd/system/pi-jukebox-update.path
sudo install -o root -g root -m 0600 \
  deployment/pi-jukebox-updater.json.example \
  /etc/pi-jukebox-updater.json
sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/pi-jukebox-app.service \
  /etc/systemd/system/pi-jukebox-update.path \
  /etc/systemd/system/pi-jukebox-update.service
sudo stat -c '%U:%G %a %n' \
  /usr/local/libexec/pi-jukebox-launcher \
  /usr/local/libexec/pi-jukebox-update-entrypoint \
  /etc/pi-jukebox-updater.json \
  /home/admin/pi-jukebox-releases/current-version
sudo find /home/admin/pi-jukebox-releases -xdev ! -user root -print
stat -c '%U:%G %a %n' \
  /home/admin/jukebox-data \
  /home/admin/jukebox-data/jukebox.env \
  /home/admin/jukebox-data/updater
sudo stat -c '%U:%G %a %n' /var/lib/pi-jukebox-updater
```

The `find` command must print nothing. Launchers and the pointer should be
`root:root`; updater configuration is mode 600. Runtime data and its environment
file remain owned by `admin`; only updater status and immutable releases are
root-owned.

Locate and back up the machine-local labwc/custom startup script, but do not
edit it yet. The repository cannot safely assume its physical-Pi filename:

```bash
grep -RIl -- '127.0.0.1:5173' \
  /home/admin/.config/labwc /home/admin/.config/autostart 2>/dev/null || true

jukebox_startup=/absolute/path/reported/above
test -f "$jukebox_startup"
cp -- "$jukebox_startup" "$jukebox_startup.pre-managed-updater"
```

If the search does not identify exactly the script that launches backend,
Vite and Chromium, stop and inspect the current startup arrangement rather
than guessing. With the backup made, preflight the managed application before
changing labwc. Run this from SSH; the first command deliberately closes the
graphical kiosk session but does not change the default boot target:

```bash
sudo systemctl isolate multi-user.target
sudo ss -ltnp | grep -E ':(8000|5173)\b' || true
sudo systemctl start pi-jukebox-app.service
systemctl status --no-pager pi-jukebox-app.service
curl -fsS http://127.0.0.1:5173/api/health
curl -fsS http://127.0.0.1:5173/api/albums
curl -fsS http://127.0.0.1:5173/api/queue
curl -fsS -o /dev/null http://127.0.0.1:5173/
sleep 15
curl -fsS http://127.0.0.1:5173/api/system/updates
```

The `ss` command must show no old listener before the managed service is
started. If it does, identify and stop only the exact old startup process; do
not use a broad `pkill`. The health response must report `0.5.0`, the album and
queue responses must contain the existing catalogue and queue, and update
status must not report a GitHub authentication failure. This last API check
proves that `gh` authentication works in the actual headless app-service
context, not only in the SSH session. If any check fails, use the recovery
steps below while the original script is still intact.

Only after that preflight succeeds, edit `$jukebox_startup`:

1. Remove only the FastAPI/backend and Vite launch lines.
2. Retain the existing Chromium executable, profile, kiosk flags and URL
   `http://127.0.0.1:5173`. Do not change its user-data directory or port.
   Browser storage is origin-scoped, so keeping both preserves display size
   and other browser-local preferences.
3. Before the Chromium command, retain or add a bounded wait that retries
   `curl -fsS http://127.0.0.1:5173/api/health` for up to 60 seconds. This
   prevents Chromium landing permanently on a connection-error page if the
   backend is slower than the graphical session.

A POSIX-shell wait immediately before the existing Chromium line can be:

```bash
attempt=0
until curl -fsS http://127.0.0.1:5173/api/health >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -ge 60 ] && exit 1
  sleep 1
done
# Keep the existing Chromium command/flags here, still using port 5173.
```

Enable the already-running application and the request watcher, return to the
graphical target, and test the kiosk without rebooting:

```bash
sudo systemctl enable pi-jukebox-app.service
sudo systemctl enable --now pi-jukebox-update.path
sudo systemctl isolate graphical.target

systemctl status --no-pager pi-jukebox-app.service
systemctl status --no-pager pi-jukebox-update.path
curl -fsS http://127.0.0.1:5173/api/health
curl -fsS -o /dev/null http://127.0.0.1:5173/
systemctl is-enabled pi-jukebox-update.path
```

Confirm the touchscreen opens the production UI at port 5173 and that albums,
queue, CD status, playback and display size remain correct. The system service
now owns FastAPI and the prebuilt frontend; labwc still owns Chromium. The path
unit must be enabled and waiting. Do not manually create a request.

Finally reboot once to validate the real cold-boot ordering, then repeat the
status, health, catalogue, queue and physical-kiosk checks:

```bash
sudo reboot
```

The reboot is an acceptance test, not a requirement for installing unit files.
`daemon-reload`, service start and restarting the graphical target are enough
for the initial cutover. Normal software updates restart only
`pi-jukebox-app.service`; Chromium stays open and reloads its page once after a
confirmed update or rollback.

On cold boot, the application service starts under `multi-user.target`; the
graphical session waits for its health endpoint and then launches Chromium.
The update path watcher is independent and idle until a request exists. A
missing `/mnt/jukebox` mount does not prevent the application process from
starting, but library/rip operations remain unavailable until the real external
filesystem is mounted. Update checking is asynchronous and an offline GitHub
failure does not block startup.

### Migration recovery

If the managed service fails before the startup script is edited, preserve the
journal and return immediately to the untouched graphical startup:

```bash
sudo journalctl -u pi-jukebox-app.service -n 200 --no-pager
sudo systemctl stop pi-jukebox-app.service
sudo systemctl isolate graphical.target
```

If failure occurs after the script edit or after reboot, reconnect through SSH,
disable the managed units, restore the exact backup, and restart the graphical
session:

```bash
sudo systemctl disable --now pi-jukebox-update.path pi-jukebox-app.service
cp -- "$jukebox_startup.pre-managed-updater" "$jukebox_startup"
sudo systemctl isolate multi-user.target
sudo systemctl isolate graphical.target
```

If `$jukebox_startup` is not defined in the recovery shell, set it again to the
same absolute path used during migration. A reboot may be used instead of the
two final `isolate` commands. Neither recovery route deletes the original
checkout, external environment file, database, artwork, music or immutable
bootstrap release.

## Building and publishing a release

Build on the target Pi or an equivalent clean ARM64 Raspberry Pi OS builder.
Version 0.6.0 targets the appliance's Python 3.13 major/minor and Node 22
through nvm. Start from the exact reviewed commit intended for the tag. The
reviewed commit must already contain the same version in
`backend/src/pi_jukebox/version.py`, `pyproject.toml`, `frontend/package.json`
and the root package in `frontend/package-lock.json`; do not edit version files
during the artifact build.

The physical Pi can build the first package safely **after** the managed
migration: the live service executes the root-owned immutable release, while
the build uses `/home/admin/jukebox`, an external tool venv and ignored
`build/` output. Do not build during CD ripping or critical playback; `npm ci`
and wheel building can cause temporary CPU, disk and memory pressure. Check
free space first. Installing the build prerequisites below does not require a
reboot unless `apt` explicitly reports that one is needed.

```bash
set -euo pipefail
release_version=0.6.0
release_tag="v$release_version"

# First stop local playback in the touchscreen UI and confirm no rip is active.
systemctl is-active --quiet pi-jukebox-app.service
curl -fsS http://127.0.0.1:5173/api/health
curl -fsS http://127.0.0.1:5173/api/cd/status | \
  python3 -c 'import json,sys; status=json.load(sys.stdin); print(json.dumps(status, indent=2)); assert not status["active"], "A CD rip is active"'
systemctl --no-pager --full status pi-jukebox-app.service \
  pi-jukebox-update.path pi-jukebox-update.service || true

test "$(uname -m)" = aarch64
test "$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" = 3.13
test "$(node --version | cut -d. -f1)" = v22
df -h /home/admin

build_packages=(build-essential python3-dev libdiscid-dev)
missing_packages=()
for package in "${build_packages[@]}"; do
  dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null | \
    grep -q '^ii ' || missing_packages+=("$package")
done
if ((${#missing_packages[@]})); then
  printf 'Missing build packages: %s\n' "${missing_packages[*]}"
  sudo apt-get install --no-install-recommends "${missing_packages[@]}"
else
  echo 'All release build packages are installed; apt was not run.'
fi

cd /home/admin/jukebox
git status --short
test -z "$(git status --porcelain)"
git switch main
git pull --ff-only origin main
test -z "$(git status --porcelain)"
test "$(PYTHONPATH=backend/src python3 -c \
  'from pi_jukebox.version import __version__; print(__version__)')" = "$release_version"
test "$(python3 -c \
  'import tomllib; print(tomllib.load(open("pyproject.toml","rb"))["project"]["version"])')" = "$release_version"
test "$(node -p 'require("./frontend/package.json").version')" = "$release_version"
test "$(node -p 'require("./frontend/package-lock.json").packages[""].version')" = "$release_version"

npm ci --prefix frontend
npm run build --prefix frontend

release_tools="/home/admin/pi-jukebox-build-tools/$release_version"
release_build="build/update/$release_version"
test ! -e "$release_tools"
test ! -e "$release_build"
python3 -m venv "$release_tools"
"$release_tools/bin/python" -m pip install --upgrade pip
"$release_tools/bin/python" -m pip install build pip-tools
"$release_tools/bin/python" -m pip install -e ".[dev]"
mkdir -p "$release_build/app" "$release_build/wheelhouse" \
  "$release_build/assets"
"$release_tools/bin/python" -m build --wheel --outdir "$release_build/app"
"$release_tools/bin/pip-compile" pyproject.toml \
  --generate-hashes --resolver=backtracking \
  --output-file "$release_build/requirements.lock"
"$release_tools/bin/python" -m pip wheel \
  --require-hashes --wheel-dir "$release_build/wheelhouse" \
  -r "$release_build/requirements.lock"
test -n "$(find "$release_build/wheelhouse" -maxdepth 1 \
  -type f -iname 'dbus_fast-*.whl' -print -quit)"
test -n "$(find "$release_build/wheelhouse" -maxdepth 1 \
  -type f -iname 'numpy-*-cp313-cp313-manylinux*_aarch64*.whl' \
  -print -quit)"
"$release_tools/bin/python" scripts/build_update_release.py \
  --version "$release_version" \
  --app-wheel "$release_build/app/pi_jukebox-$release_version-py3-none-any.whl" \
  --requirements-lock "$release_build/requirements.lock" \
  --wheelhouse "$release_build/wheelhouse" \
  --frontend-dist frontend/dist \
  --output-directory "$release_build/assets" \
  --architecture aarch64 --python-version 3.13

"$release_tools/bin/python" -m pytest
"$release_tools/bin/python" -m ruff check .
"$release_tools/bin/python" -m ruff format --check .
npm --prefix frontend run format:check
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build
git diff --check

archive="$release_build/assets/pi-jukebox-v$release_version.tar.gz"
manifest="$release_build/assets/pi-jukebox-v$release_version-manifest.json"
"$release_tools/bin/python" - "$manifest" "$release_version" <<'PY'
import json
import sys
from pathlib import Path

from pi_jukebox.updates.installer import ReleaseManifest

path = Path(sys.argv[1])
version = sys.argv[2]
payload = json.loads(path.read_text(encoding="utf-8"))
validated = ReleaseManifest.load(path, version)
assert payload["application_version"] == version
assert payload["compatibility"] == {"architecture": "aarch64", "python": "3.13"}
assert validated.architecture == "aarch64"
assert validated.python_version == "3.13"
print(json.dumps(payload, indent=2, sort_keys=True))
PY
tar -tzf "$archive"
sha256sum "$archive" "$manifest"
```

Review the two assets and manifest before any tag or publication. After the
reviewed release commit is on `origin/main`, return to `main`, fast-forward,
verify the four versions and tag that exact commit. The ignored
`$release_build` assets remain available in the checkout. Create a draft first;
the production updater ignores it:

```bash
set -euo pipefail
cd /home/admin/jukebox
release_version=0.6.0
release_tag="v$release_version"
release_build="build/update/$release_version"
git switch main
git pull --ff-only origin main
test -z "$(git status --porcelain)"
git diff --exit-code origin/main...HEAD
test "$(PYTHONPATH=backend/src python3 -c \
  'from pi_jukebox.version import __version__; print(__version__)')" = "$release_version"
test "$(python3 -c \
  'import tomllib; print(tomllib.load(open("pyproject.toml","rb"))["project"]["version"])')" = "$release_version"
test "$(node -p 'require("./frontend/package.json").version')" = "$release_version"
test "$(node -p 'require("./frontend/package-lock.json").packages[""].version')" = "$release_version"
git tag -a "$release_tag" -m "Pi Jukebox $release_tag"
git push origin "$release_tag"
gh release create "$release_tag" \
  "$release_build/assets/pi-jukebox-v$release_version.tar.gz" \
  "$release_build/assets/pi-jukebox-v$release_version-manifest.json" \
  --repo copmeister/pi-jukebox \
  --title "Pi Jukebox $release_tag" \
  --notes 'Adds Bluetooth A2DP receiver support and touchscreen Bluetooth device management. Requires the documented supervised one-time Bluetooth infrastructure migration before Bluetooth is enabled.' \
  --verify-tag \
  --draft
gh release view "$release_tag" --repo copmeister/pi-jukebox \
  --json tagName,isDraft,isPrerelease,assets
```

After independently verifying the tag, asset names and checksums, publish the
draft only when the Pi is ready for the supervised test:

```bash
gh release edit "$release_tag" --repo copmeister/pi-jukebox \
  --verify-tag --draft=false --latest
```

Do not publish from this implementation pass.

## Historical first physical update test

The following v0.5.0-to-v0.5.1 scenario records the original updater acceptance
procedure. Its version numbers are intentionally historical; do not use them to
build the current release.

1. Confirm `current-version`, `/api/health` and Settings all report 0.5.0.
2. Record the album/track counts, queue contents, current display-size setting
   and `stat` output for `/home/admin/jukebox-data/catalogue.sqlite3`.
3. Confirm normal playback, CD idle state and the external mount, then stop
   playback and ensure no rip is active.
4. Publish the reviewed v0.5.1 draft using the then-current stable-release
   procedure. Do not change `main` or use `git pull` as the update mechanism.
5. Open Settings and tap **Check for updates**.
6. Confirm `0.5.0 → 0.5.1` is offered; no branch commit is mentioned.
7. Tap **Update Software** once. A second tap must be disabled/rejected.
8. Observe Downloading, Verifying, Preparing, Installing and Restarting without
   invented percentages.
9. Confirm Chromium reloads once, reconnects without manual intervention, and
   serves the new prebuilt frontend rather than the old in-memory bundle.
10. Confirm Settings, `current-version` and `/api/health` report 0.5.1.
11. Recheck album/track counts, queue, database path/timestamp, artwork,
    display size, playback and CD status. No machine path should have changed.
12. Inspect both service journals and the updater status JSON.
13. Restart only `pi-jukebox-app.service`; confirm 0.5.1 returns. This does not
    require a Pi reboot.
14. Reboot once as a separate persistence/boot-order test and confirm 0.5.1 and
    the Chromium kiosk return without Vite.

## Historical deliberate rollback test

Create a separately reviewed v0.5.2 test release whose wheel reports version
0.5.2 and passes preparation, but whose `pi_jukebox.main` deliberately raises a
startup exception only in that test release. Do not alter data paths or schema.
Publish it briefly as a stable release, request the update once, and confirm:

1. 0.5.2 downloads, verifies and activates.
2. `pi-jukebox-app.service` fails to become healthy at 0.5.2.
3. The helper atomically restores 0.5.1 and restarts it.
4. Settings says the update failed and 0.5.1 was restored.
5. `current-version` and `/api/health` both report 0.5.1; Chromium reloads once
   onto the restored frontend.
6. `/api/health`, playback, queue, catalogue, artwork and configuration remain
   healthy and unchanged.
7. The failed 0.5.2 directory appears under the root-owned `failed` directory,
   and no `releases/0.5.2` directory remains active.
8. `/var/lib/pi-jukebox-updater/status.json` records `rolled_back`; the update
   service itself may have a failed exit status because the requested update
   failed, while the restored application and path watcher remain healthy.

Immediately convert that deliberately broken release to a prerelease or remove
it from the production channel after collecting logs, so normal appliances no
longer offer it. Never use a destructive data migration for a rollback test.

```bash
gh release edit v0.5.2 --repo copmeister/pi-jukebox --prerelease
```

Automatic rollback switches application code, not external data. Until a
separate migration/snapshot protocol is designed, every published update must
keep SQLite and other external state backward compatible with the previous
known-good version. Destructive migrations are not permitted.

## Diagnostics, recovery and manual rollback

```bash
systemctl status --no-pager pi-jukebox-app.service
systemctl status --no-pager pi-jukebox-update.path
systemctl status --no-pager pi-jukebox-update.service
sudo journalctl -u pi-jukebox-update.service -n 200 --no-pager
sudo journalctl -u pi-jukebox-app.service -n 200 --no-pager
cat /var/lib/pi-jukebox-updater/status.json
cat /home/admin/pi-jukebox-releases/current-version
ls -la /home/admin/pi-jukebox-releases/releases
```

For a deliberate manual rollback, first choose a known-good directory already
under `releases`. Replace only the root-owned pointer, atomically on the same
filesystem, then restart and verify:

```bash
test -d /home/admin/pi-jukebox-releases/releases/0.5.0
printf '0.5.0\n' | sudo tee \
  /home/admin/pi-jukebox-releases/.current-version.manual >/dev/null
sudo chown root:root \
  /home/admin/pi-jukebox-releases/.current-version.manual
sudo chmod 0644 \
  /home/admin/pi-jukebox-releases/.current-version.manual
sudo mv -T \
  /home/admin/pi-jukebox-releases/.current-version.manual \
  /home/admin/pi-jukebox-releases/current-version
sudo systemctl restart pi-jukebox-app.service
curl -fsS http://127.0.0.1:5173/api/health
```

Do not delete `/home/admin/jukebox-data`, `.env`/`jukebox.env`, `/mnt/jukebox`,
music, SQLite databases, artwork, queue state or display settings during update
recovery.

## Security review summary

- **Command injection:** every subprocess uses a fixed argument array with
  `shell=False`. Browser input never becomes a command or argument.
- **Archive traversal and links:** paths are normalized and bounded; absolute,
  parent, backslash, symlink, hardlink and special entries are rejected. Files
  are streamed individually into a new root-owned staging directory.
- **Frontend trust boundary:** installation requires a fixed custom request
  header, forcing browser cross-origin requests through the configured CORS
  preflight; the header is not a credential and conveys no version or path.
- **Privilege escalation:** the app has no sudo permission. A root-owned path
  unit observes one fixed request file; the helper receives no browser
  arguments and accepts only a strict semver request schema.
- **Arbitrary versions and destinations:** the helper independently verifies
  that the version is newer, stable, attached to the fixed repository, and has
  exact asset names. Production paths and service names are fixed and validated.
- **Credential exposure:** the browser sees neither tokens nor URLs. The root
  helper invokes fixed `gh` with the admin account's existing read-only config
  directory and a minimal environment.
- **TOCTOU:** downloads, validation, extraction and preparation occur in a
  root-owned temporary directory. The archive checksum and every extracted file
  are verified before an atomic rename. The active pointer is root-owned and
  atomically replaced.
- **Partial installs:** the live version is untouched until preparation
  succeeds. Failed staging is removed; a failed activated version is moved to a
  root-owned `failed` directory after successful rollback.
- **Rollback integrity:** the previous immutable directory is never overwritten.
  Its exact reported version must pass the same health check after restoration.
- **Concurrency:** the backend rejects duplicate requests, creates the request
  with exclusive/no-follow semantics, systemd serializes the one-shot service,
  and the helper holds an OS file lock.
- **Local data:** all release operations are confined to the fixed release root.
  configuration, runtime data, music and browser-local display preferences stay
  outside it.

Remaining trust is the GitHub repository/release publisher and the root-owned
bootstrap files. SHA-256 detects corruption and asset mismatch; it is not a
substitute for protecting the GitHub account and reviewing the release tag.
Validated versions are retained rather than automatically deleted; an
administrator should review disk use before any future retention policy is
introduced.

The running helper that installs a release comes from the previously active,
known-good version and remains alive across the pointer switch. Therefore every
future release package format must remain readable by its immediate predecessor.
Changes to fixed root-owned launchers, units or privileged configuration require
a separate reviewed administrator migration; an ordinary application release
does not rewrite them.

Version 0.6.0 adds `dbus-fast` to the ARM64 wheelhouse and an independently
hardened Bluetooth service. The ordinary updater still must not create accounts
or rewrite `/etc`, systemd or WirePlumber configuration. Follow the supervised
[Bluetooth migration](bluetooth.md) around the first v0.6.0 installation. Once
installed, `pi-jukebox-bluetooth.service` is `PartOf` the application service,
so the updater's existing application restart also reloads Bluetooth helper
code from the activated version; rollback reloads both from the restored
version. A helper failure leaves Bluetooth unavailable and must not change the
catalogue, queue, CD, updater or local playback data.

Version 0.6.4 adds NumPy as an ordinary application runtime dependency for the
isolated final-output spectrum analyser. The release build remains native on
the Python 3.13 aarch64 Pi, so `pip-compile` locks the runtime requirement and
`pip wheel --require-hashes` selects its binary aarch64 wheel. The explicit
filename check in the release procedure prevents publication if a compatible
`cp313` manylinux NumPy wheel was not collected. Installation remains fully
offline through the existing per-release wheelhouse and does not alter
PipeWire, WirePlumber, Bluetooth or any system service.
