# Bluetooth receiver: design, migration and hardware test

Version 0.6.0 makes the Raspberry Pi an A2DP receiver: a phone supplies audio,
and the existing PipeWire/WirePlumber session routes it to the Raspberry Pi DAC
Pro. This is a hardware-test candidate until the migration and physical checks
in this document pass. Windows development deliberately reports Bluetooth as
unavailable.

## Boundaries and audio route

```text
Phone -> BlueZ A2DP sink -> admin WirePlumber/PipeWire -> DAC Pro -> speakers
Browser -> FastAPI -> fixed Unix-socket protocol -> isolated BlueZ helper
```

FastAPI remains the unprivileged `admin` service and receives no sudo or shell
access. The dedicated `pi-jukebox-bt` account owns the pairing agent and can use
BlueZ D-Bus through membership of Debian's `bluetooth` group. Its systemd unit
allows only Unix sockets, has no private network, device or writable home
access, and exposes one group-readable socket. The helper checks Linux peer
credentials and accepts only UID 1000 (the audited `admin` UID), strict opaque
identifiers and a fixed protocol vocabulary.

The browser never receives a MAC address, BlueZ object path or local socket
path. Device names are treated as untrusted display text. Pairability and
discoverability are off at helper start, open together for at most 120 seconds,
and close after cancellation, timeout or an accepted pairing. A phone becomes
trusted only after touchscreen approval. Exactly one trusted phone may be
connected through the app at a time, including when phones initiate their own
reconnects. Only remote devices advertising the A2DP Audio Source service (or
presenting an established A2DP media transport) are manageable; keyboards,
pointing devices, controllers and remote audio sinks remain outside the device
list and control protocol.

WirePlumber 0.5.8 on the audited Debian 13 Pi uses the tracked
`80-pi-jukebox-bluetooth.conf`: it enables only the `a2dp_sink` role and marks
incoming `bluez_input` media as playback. It does not hard-code a numeric node
ID or DAC card number. The already configured DAC Pro remains the default sink.

## Supervised two-phase migration

Do this only after the reviewed v0.6.0 commit and ARM64 release package exist.
Keep a second SSH session open. Do not publish v0.6.0 as stable until the
successful and recovery paths have been exercised.

First update the source checkout and verify the exact live assumptions:

```bash
set -euo pipefail
cd /home/admin/jukebox
git status --short
test -z "$(git status --porcelain)"
git switch main
git pull --ff-only origin main

test "$(uname -m)" = aarch64
test "$(id -u admin)" = 1000
test "$(cat /home/admin/pi-jukebox-releases/current-version)" = 0.5.0
systemctl is-active --quiet bluetooth.service
dpkg-query -W bluez pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth
sudo -u admin env XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  wpctl inspect @DEFAULT_AUDIO_SINK@ | grep -F 'RPi DAC Pro'
for config_root in /etc/wireplumber /home/admin/.config/wireplumber; do
  if sudo test -d "$config_root"; then
    sudo find "$config_root" -xdev -type f -print
  fi
done | sort
for policy in \
  /etc/dbus-1/system.d/bluetooth.conf \
  /usr/share/dbus-1/system.d/bluetooth.conf; do
  if sudo test -f "$policy"; then
    echo "# $policy"
    sudo sed -n '1,240p' "$policy"
  fi
done
getent group bluetooth
```

If the UID, active version, package set, D-Bus policy or default DAC check does
not match, stop and review the live machine rather than adapting commands by
guesswork. Save the WirePlumber file list with the other pre-migration records
and inspect existing BlueZ rules for conflicts before installing another
fragment. This is recovery checkpoint A: local playback, queue, CD and update
checks must still pass before any machine-level file is changed.

Stage the privileged infrastructure, but **do not start or enable the helper
yet**. The active v0.5.0 release does not contain its Python module.

```bash
required_packages=(
  bluez pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth
)
missing_packages=()
for package in "${required_packages[@]}"; do
  dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null | \
    grep -q '^ii ' || missing_packages+=("$package")
done
if ((${#missing_packages[@]})); then
  printf 'Missing required packages: %s\n' "${missing_packages[*]}"
  sudo apt-get install --no-install-recommends "${missing_packages[@]}"
else
  echo 'All required Bluetooth audio packages are installed; apt was not run.'
fi

getent group pi-jukebox-control >/dev/null || \
  sudo groupadd --system pi-jukebox-control
if ! getent passwd pi-jukebox-bt >/dev/null; then
  sudo useradd --system --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin --gid pi-jukebox-control \
    --groups bluetooth pi-jukebox-bt
fi
id pi-jukebox-bt
sudo -u pi-jukebox-bt busctl --system get-property \
  org.bluez /org/bluez/hci0 org.bluez.Adapter1 Alias

sudo install -o root -g root -m 0755 \
  deployment/pi-jukebox-bluetooth-launcher.py \
  /usr/local/libexec/pi-jukebox-bluetooth-launcher
sudo install -o root -g pi-jukebox-control -m 0640 \
  deployment/pi-jukebox-bluetooth.json.example \
  /etc/pi-jukebox-bluetooth.json
sudo install -o root -g root -m 0644 \
  deployment/pi-jukebox-bluetooth.service \
  /etc/systemd/system/pi-jukebox-bluetooth.service
sudo install -d -o root -g root -m 0755 \
  /etc/wireplumber/wireplumber.conf.d
sudo install -o root -g root -m 0644 \
  deployment/80-pi-jukebox-bluetooth.conf \
  /etc/wireplumber/wireplumber.conf.d/80-pi-jukebox-bluetooth.conf

sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/pi-jukebox-bluetooth.service
sudo systemctl is-enabled pi-jukebox-bluetooth.service 2>/dev/null || true
sudo systemctl is-active pi-jukebox-bluetooth.service 2>/dev/null || true
```

The `busctl` command is a safe read-only test that the dedicated account can
actually reach the installed BlueZ D-Bus API; it avoids assuming a particular
distribution policy-file layout. If it fails, stop and review the installed
policy rather than adding a broad allowance. The final two systemd commands
must not report enabled/active. This is recovery checkpoint B: the staged files
have no effect and v0.5.0 local playback and CD checks must still pass.

Build and install the reviewed v0.6.0 immutable release through the existing
updater workflow. During
this first update the Bluetooth page safely says unavailable. Verify local
playback, queue, CD and `/api/health` first:

```bash
test "$(cat /home/admin/pi-jukebox-releases/current-version)" = 0.6.0
curl -fsS http://127.0.0.1:5173/api/health
/home/admin/pi-jukebox-releases/releases/0.6.0/.venv/bin/python -c \
  'import dbus_fast; import pi_jukebox.bluetooth.helper; print("Bluetooth modules OK")'
```

This is recovery checkpoint C. If application health or existing functionality
fails, use the managed updater rollback before enabling any Bluetooth service.

Back up the managed application unit, install its reviewed v0.6.0 definition,
and enable the feature explicitly in the external environment file:

```bash
sudo cp -a /etc/systemd/system/pi-jukebox-app.service \
  /etc/systemd/system/pi-jukebox-app.service.pre-bluetooth
sudo install -o root -g root -m 0644 deployment/pi-jukebox-app.service \
  /etc/systemd/system/pi-jukebox-app.service
sudoedit /home/admin/jukebox-data/jukebox.env
```

Add these exact lines, preserving all existing data, storage, update and CD
settings:

```dotenv
PI_JUKEBOX_BLUETOOTH_ENABLED=true
PI_JUKEBOX_BLUETOOTH_SOCKET_PATH=/run/pi-jukebox-bluetooth/control.sock
PI_JUKEBOX_BLUETOOTH_TIMEOUT_SECONDS=2
```

Restart WirePlumber once (audio briefly stops), then start the helper and app:

```bash
sudo -u admin env XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  systemctl --user restart wireplumber.service
sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/pi-jukebox-app.service \
  /etc/systemd/system/pi-jukebox-bluetooth.service
sudo systemctl enable --now pi-jukebox-bluetooth.service
sudo systemctl restart pi-jukebox-app.service

systemctl status --no-pager pi-jukebox-app.service
systemctl status --no-pager pi-jukebox-bluetooth.service
curl -fsS http://127.0.0.1:5173/api/health
curl -fsS http://127.0.0.1:5173/api/bluetooth/status
bluetoothctl show | grep -E 'Alias:|Discoverable:|Pairable:'
sudo -u admin env XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus wpctl status --name
```

Before the first pairing, the API must say `inactive`, the alias must be
`Pi Jukebox`, and both discoverable and pairable must be `no`. The DAC Pro must
still be the default sink. A reboot is not required for installation, but one
cold-boot test is required before release acceptance.

This is recovery checkpoint D. Keep the second SSH session open until helper,
application, DAC and pairing-off checks all pass. Use the recovery section
immediately if any of them fail.

`PartOf=pi-jukebox-app.service` makes a later managed application restart also
restart the helper against the newly activated immutable release. If an update
rolls back, the same restart returns both processes to the previous release.
Chromium and the admin WirePlumber session remain owned by labwc/the graphical
login and are not moved into the helper service.

## Migration recovery

If v0.6.0 itself fails before the helper is enabled, use the existing updater
rollback; staged but inactive files do not affect v0.5.0.

If helper or audio routing fails after activation, keep local data and paired
keys intact, turn off the feature and restore only the prior service/routing:

```bash
sudo systemctl disable --now pi-jukebox-bluetooth.service
sudo bluetoothctl discoverable off
sudo bluetoothctl pairable off
sudoedit /home/admin/jukebox-data/jukebox.env
# Set PI_JUKEBOX_BLUETOOTH_ENABLED=false and remove/comment the socket line.
sudo cp -a /etc/systemd/system/pi-jukebox-app.service.pre-bluetooth \
  /etc/systemd/system/pi-jukebox-app.service
sudo rm -- /etc/wireplumber/wireplumber.conf.d/80-pi-jukebox-bluetooth.conf
sudo systemctl daemon-reload
sudo systemctl restart pi-jukebox-app.service
sudo -u admin env XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  systemctl --user restart wireplumber.service
curl -fsS http://127.0.0.1:5173/api/health
```

Do not delete `/home/admin/jukebox-data`, the catalogue, queue, artwork,
`/mnt/jukebox`, music, the Chromium profile or `/var/lib/bluetooth`. The helper
account, stopped unit, root-owned launcher and configuration may remain for
diagnosis. Inspect failures with:

```bash
sudo journalctl -u pi-jukebox-bluetooth.service -n 200 --no-pager
sudo journalctl -u pi-jukebox-app.service -n 100 --no-pager
sudo -u admin env XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  journalctl --user -u wireplumber.service -n 150 --no-pager
```

## Physical acceptance checklist

At 1280×720 on Touch Display 2:

1. Confirm local playback is initially unchanged and Bluetooth is inactive.
2. Pair one iPhone and one Android phone separately; compare the six-digit code
   and accept only on the jukebox screen.
3. Confirm the pairing window ends after acceptance, cancellation and timeout.
4. Reject one pairing and confirm the phone is neither trusted nor reusable.
5. Stream speech and music from each phone through the DAC Pro using baseline
   SBC; listen for dropouts, distortion and excessive latency.
6. Confirm Bluetooth activation pauses local audio, preserves its queue and
   never auto-resumes it after phone disconnect.
7. Start Library, Search and Jukebox playback; confirm Bluetooth disconnects
   first and local playback then starts normally.
8. Switch between two trusted phones and confirm only one is connected.
9. Forget one phone and confirm it cannot reconnect without pairing.
10. Test phone hardware volume, mute, calls/notifications and 2.4 GHz Wi-Fi.
    These behaviors vary by phone and are not asserted by Windows tests.
11. Confirm mini-player, Now Playing and Bluetooth screen agree, with no local
    seek/volume controls shown while phone audio is active.
12. Reboot. Confirm discoverability is off, pairings persist, no phone is
    arbitrarily auto-connected, the kiosk returns and local playback/CD/update
    functions still work.
13. While local and then Bluetooth audio plays, resolve the current default DAC
    sink and inspect its monitor. On the audited machine it is currently
    `alsa_output.platform-soc_107c000000_sound.stereo-fallback.monitor`; treat
    that as observed hardware state, not a numeric or permanently hard-coded
    visualiser target. Both sources must reach the resolved monitor without a
    feedback loop.

## Future common-output visualiser

The future visualiser should run in, or explicitly connect to, the `admin`
PipeWire session and dynamically resolve the DAC/default-sink monitor. It must
not hard-code a transient PipeWire object ID such as `57`. Capturing this common
sink monitor can analyse the digital mix routed to the DAC for local library
playback and Bluetooth, and later radio and direct-CD playback when those
sources also use that sink. It cannot measure analogue amplifier or speaker
behavior, and it cannot see a source routed to another sink. The visualiser
itself remains outside v0.6.0.

MP3/FLAC browser support and Bluetooth codec behavior are separate. No claim of
Bluetooth audio quality, codec coverage or RF reliability is made until these
tests pass on the actual HAT, amplifier and speakers.
