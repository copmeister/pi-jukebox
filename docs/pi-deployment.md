# Raspberry Pi 5 deployment and hardware preparation

These steps describe the reviewed v0.5.0 CD/storage base. They do not erase, repartition or reformat storage. For v0.6.0, complete this base first, then use the separate [Bluetooth receiver migration and hardware test](bluetooth.md); do not enable Bluetooth with an environment variable alone.

## Prerequisites

Confirm the external drive is genuinely mounted before creating or writing library folders:

```bash
findmnt --target /mnt/jukebox
lsblk -f
```

Install required packages if they are not already present:

```bash
sudo apt update
sudo apt install cdparanoia libdiscid0 flac eject python3-venv gh
```

Confirm the optical drive and local GitHub authentication without ripping:

```bash
ls -l /dev/sr0
gh auth status
```

Ensure the service account can read `/dev/sr0`, normally through the `cdrom` group. Log out and back in after an administrator changes group membership. `libdiscid0` is the native MusicBrainz TOC/Disc-ID library; the project's Python dependency installs the maintained `python-discid` binding into its virtual environment.

Only after `findmnt` confirms the external filesystem, create the required application-owned directories:

```bash
sudo install -d -o admin -g admin /mnt/jukebox/Music
sudo install -d -o admin -g admin /home/admin/jukebox-data
```

## Deploy the reviewed source

Before the managed-service migration in the software-update guide, deploy reviewed source only after it has been committed and pushed. First confirm the Pi checkout has no local source changes, then use a fast-forward-only pull:

```bash
cd /home/admin/jukebox
git status --short
git switch main
git pull --ff-only origin main
```

If `git status --short` prints anything, stop and preserve those local changes before pulling. Then prepare the reviewed version:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e ".[dev]"
npm install --prefix frontend
npm run build --prefix frontend
```

With an audio CD inserted, verify that libdiscid returns a 28-character MusicBrainz Disc ID and its TOC:

```bash
.venv/bin/python -c "import discid; d=discid.read('/dev/sr0'); print(d.id); print(d.toc_string)"
```

An empty tray causes this diagnostic command to fail and is not an application error.

Do not replace the Pi's existing `.env`. Add the new values manually:

```dotenv
PI_JUKEBOX_ENVIRONMENT=production
PI_JUKEBOX_DATA_DIRECTORY=/home/admin/jukebox-data
PI_JUKEBOX_MUSIC_LIBRARY_PATH=/mnt/jukebox/Music
PI_JUKEBOX_OPTICAL_DRIVE_PATH=/dev/sr0
PI_JUKEBOX_EXTERNAL_STORAGE_PATH=/mnt/jukebox
PI_JUKEBOX_RIP_OUTPUT_PATH=/mnt/jukebox/Music
PI_JUKEBOX_RIP_STAGING_PATH=/mnt/jukebox/.pi-jukebox-rip-staging
PI_JUKEBOX_CD_MINIMUM_FREE_BYTES=2000000000
PI_JUKEBOX_CD_PROCESS_NICE=10
PI_JUKEBOX_UPDATE_CHECK_ENABLED=true
PI_JUKEBOX_UPDATE_INSTALL_ENABLED=false
```

Keep the existing local service and kiosk startup arrangement. For a foreground diagnostic start:

```bash
cd /home/admin/jukebox
.venv/bin/python -m uvicorn pi_jukebox.main:app --host 127.0.0.1 --port 8000
```

## Physical acceptance test

1. Start without internet. Confirm the jukebox and existing playback start normally; Settings may report that update checking is unavailable.
2. Confirm CD shows drive-ready/no-disc.
3. Insert a disposable or already-owned audio CD. Confirm release cards and track count; reconnect internet if metadata is desired.
4. Start ripping and play, pause, seek and navigate existing music during extraction.
5. After the first Ready track, confirm it appears in Library/Search and can be queued before later tracks finish.
6. Cancel during a later track. Confirm Ready FLACs remain, the current partial disappears and unrelated music/queue entries remain.
7. Leave the same disc inserted and confirm **Resume Rip** appears. Resume and verify the earlier Ready files retain their timestamps while only the missing tracks are read and completed.
8. Repeat cancellation, restart the backend or Pi, reinsert the same disc if needed and confirm Resume Rip still appears from persisted state.
9. Confirm a fully completed album says it is already in the library and does not offer Resume Rip. If testing a deliberately mismatched destination, confirm the screen reports a conflict and no file changes.
10. Start again with a non-conflicting disc. Confirm Ready/error counts, `Cover.jpg` when available, album ordering and Eject.
11. Stop the app, temporarily unmount the external drive using the normal desktop/administrator workflow, restart, and confirm ripping is refused. Do not create `/mnt/jukebox/Music` while unmounted.
12. Disconnect networking and confirm generic track names remain available and artwork failure does not prevent ripping.

### Touch Display 2 presentation test

At the native 1280×720 landscape viewport, open Settings and test Standard, Large and Extra Large. In every mode, swipe vertically on Library, Search results, Queue, CD progress and Settings content; confirm content moves naturally without selecting ordinary text and without a visible right-hand scrollbar. Mouse-wheel scrolling may be checked separately during desktop development.

Confirm the mini-player and all eight navigation destinations remain visible. Standard must show A–D with numbers 1–8. Large and Extra Large must show A–C with numbers 1–6, with no clipped panel rows or controls. Select C6, confirm it enters the authoritative queue normally, then test NEXT, left swipe, Sounds and Stop & Clear. Use long album, artist and track names when checking Library, Search, Queue, Now Playing, CD release cards, Bluetooth and rip progress.

## Diagnostics and recovery

Inspect the journal for the existing service configuration, for example:

```bash
journalctl --user -u pi-jukebox --since today
```

MusicBrainz diagnostics record the HTTP status and bounded attempt number, JSON parsing category, usable candidate count, and safe fallback reason. They deliberately omit response bodies, request headers, credentials, and release artwork bytes.

`GET /api/cd/status` reports safe job state and a `rip_action` assessment without command lines or absolute final paths. Rip history remains in the configured SQLite database. Disposable work is confined to `/home/admin/jukebox-data/rip-staging` and cleaned after restart. Do not delete completed music to recover a cancelled or interrupted job; use Resume Rip. A conflict intentionally requires administrator review rather than automatic deletion or replacement.

If playback skips while ripping, raise the configured nice value modestly and retest. Extraction speed, USB power, DAC responsiveness, temperatures, artwork appearance and speaker behaviour require physical observation.

## Managed software updates

The initial checkout-and-Vite startup remains the safe deployment path until the separate one-time migration is deliberately performed. The reviewed updater uses published stable GitHub Release assets, a root-owned helper, immutable versions, a managed application service, version-aware health checks and automatic rollback. It keeps `.env`, `/home/admin/jukebox-data` and `/mnt/jukebox` outside every release.

Do not merely change `PI_JUKEBOX_UPDATE_INSTALL_ENABLED` in the existing checkout. Follow [Safe software updates](software-updates.md) from beginning to end; it includes the service migration, retained labwc/Chromium startup, ARM64 release procedure, first physical update, deliberate rollback test and manual recovery.
