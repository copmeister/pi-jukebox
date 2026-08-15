# pi-jukebox

A touchscreen-first local music jukebox for Raspberry Pi. The backend catalogues one local music folder, securely serves catalogue tracks, and owns a persistent SQLite playback queue used by the React interface. The visualiser and Raspberry Pi deployment are intentionally not implemented yet.

The display target is the official 7-inch Raspberry Pi Touch Display 2 in landscape at its native 1280×720 resolution. Milestone 4C uses this as its only detailed visual acceptance target; older responsive rules remain in place but are not separately accepted for this feature.

## What you need on Windows

Install these tools before starting:

- Python 3.11 or newer. Python 3.12 is recommended.
- Node.js 22 or newer. Node.js 24 is also supported.
- Git, if you want to work with source control.

The commands below use `npm.cmd` instead of `npm`. This works even when Windows PowerShell script execution is restricted.

## First-time installation

Open PowerShell, change to the repository, and run each command in order:

```powershell
cd C:\path\to\pi-jukebox
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -e ".[dev]"
npm.cmd install --prefix frontend
Copy-Item .env.example .env
```

If `py -3.12` is unavailable but `python` reports version 3.11 or newer, create the environment with:

```powershell
python -m venv .venv
```

The example configuration is safe to run unchanged. With no music folder configured, the API stays healthy and reports the library as unconfigured.

## Configure a test music folder

Open `.env` in a text editor. Uncomment the library line and replace its example value with the full path to a folder containing test music:

```dotenv
PI_JUKEBOX_MUSIC_LIBRARY_PATH=C:/Music/Pi Jukebox Test
```

Forward slashes are recommended on Windows. The folder must already exist and must be a directory. Do not put quotes around the path. `.env` is ignored by Git, so this machine-specific path will not be committed.

The catalogue database and extracted artwork are written under `./data` by default. That directory is also ignored by Git. The scanner reads source audio files but never changes, renames, copies, or deletes them.

The frontend normally uses Vite's local `/api` proxy. If the backend is hosted at a different address during development, copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_BASE_URL`. Keep that local file untracked.

## Start the application

The backend and frontend each need their own PowerShell window.

In the first window, start the backend:

```powershell
cd C:\path\to\pi-jukebox
.venv\Scripts\python.exe -m uvicorn pi_jukebox.main:app --reload --host 127.0.0.1 --port 8000
```

In the second window, start the frontend:

```powershell
cd C:\path\to\pi-jukebox
npm.cmd --prefix frontend run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173> in your browser.

The application opens in **Jukebox** mode. Four panels show 32 randomly mixed codes from A1 through D8. A, B, C, and D are persistent panel identities with permanent amber, blue, violet, and green accents. Choose a letter and then a number: the first selection starts immediately when nothing is current, while later selections append to the persistent queue. Swipe left or use **NEXT ›** to move every panel left and recycle the outgoing identity with newly randomized songs on the right. The transition resets invisibly after the panels finish moving, so it never travels backwards. Panels have no back history, and moving them never changes queued music. **Stop & Clear** requires confirmation and stops audio while clearing the complete queue.

Jukebox letter and number controls use one heavy mechanical click per press, and a successful queue acceptance adds one separate latch-and-relay clunk. When an idle Jukebox selection is ready to play, and between queued songs in the same Jukebox presentation, a quiet record-loading mechanism runs for approximately 900 ms before the single browser audio element starts the track at its beginning. Queuing another selection does not interrupt the current song or play the loading mechanism early. Library and Search Play Now actions remain modern and immediate.

Open **Sounds** in the Jukebox header to enable or disable the effects, adjust the effects master and category levels (including the loading mechanism), preview each category, enable or disable the mechanical loading pause, or reset the controls. Turning all effects off also removes the theatrical delay; setting only the loading volume to zero retains a silent pause. These browser-local settings are independent from music volume and Raspberry Pi system volume. They are saved only in that browser's local storage and can safely fall back to defaults if storage or Web Audio is unavailable.

With at least eight catalogued tracks, each panel contains eight different songs. A catalogue of at least 32 tracks fills all visible positions uniquely. Smaller libraries are distributed through fresh shuffled cycles, so repeats occur across panels only as necessary; libraries with fewer than eight tracks repeat within a panel while avoiding immediately adjacent repeats where possible.

The modern Library, Search, Queue, and Now Playing screens remain available. A Library or Search track's **Actions** menu provides Play Now, Play Next, or Add to Queue. Album details provide Play Album and Add Album to Queue. The Queue screen retains touch Up/Down reordering, removal, and its existing upcoming-only clear. The mini-player and Now Playing screen provide play/pause, queue-aware previous/next, seeking, volume, and mute.

Queue order and the current queue item persist in SQLite across browser refreshes and backend restarts. Restored audio remains paused and restarts from the beginning after one Play tap. Playback position is deliberately not saved, and restored audio never autoplays.

Useful backend addresses:

- Health check: <http://127.0.0.1:8000/api/health>
- Interactive API documentation: <http://127.0.0.1:8000/docs>

Queue endpoints include:

- `GET /api/queue` — complete current/upcoming snapshot
- `DELETE /api/queue` — stop and atomically clear current and upcoming items
- `POST /api/queue/tracks/{track_id}` — Add to Queue
- `POST /api/queue/tracks/{track_id}/next` — Play Next
- `POST /api/queue/tracks/{track_id}/play-now` — Play Now
- `POST /api/queue/albums/{album_id}` — Add Album to Queue
- `POST /api/queue/albums/{album_id}/play` — replace with and play an album
- `DELETE /api/queue/items/{queue_item_id}` — remove an upcoming item
- `DELETE /api/queue/upcoming` — clear upcoming items only
- `POST /api/queue/items/{queue_item_id}/move` — move an upcoming item up or down
- `POST /api/queue/advance` — atomically complete the expected current item

See [the API reference](docs/api.md) for request and response details.

## Scan the configured library

With the backend running, open another PowerShell window at the repository root.

Check whether the library is configured and available:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/library/scan/status | ConvertTo-Json -Depth 5
```

Start a scan:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/library/scan | ConvertTo-Json
```

The request returns immediately because scanning happens in the background. Run the status command again until `running` is `false`. A second scan request made while one is active returns HTTP 409.

View catalogued albums:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/albums | ConvertTo-Json -Depth 5
```

Search the catalogue:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/search?q=artist-or-title" |
    ConvertTo-Json -Depth 5
```

Use the interactive API documentation to open a particular album or track. See [supported formats](docs/supported-formats.md) before interpreting format support as playback support.

Stop either development server by pressing `Ctrl+C` in its PowerShell window.

## Run the checks

Run backend checks from the repository root:

```powershell
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m ruff format --check .
.venv\Scripts\python.exe -m pytest
```

Run frontend checks from the repository root:

```powershell
npm.cmd --prefix frontend run format:check
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run test
npm.cmd --prefix frontend run build
```

## Current scope

The backend provides an incremental SQLite catalogue, background scanning, search, album and track queries, cached embedded artwork, range-capable audio responses, and an authoritative persistent queue. The frontend opens with the four-panel classic selector while retaining modern touch browsing, search, queue editing, persistent Chromium playback through one audio element, and optional synthesized Jukebox-only mechanical feedback and record-loading presentation. Playback position, discarded selector panels, selector transition history, and the modern/Jukebox presentation mode are not saved. Sound-effect preferences are local to the browser. The visualiser, kiosk deployment, and Raspberry Pi hardware integration remain pending.

Milestone 4C is the final pre-hardware feature milestone. The next project stage is Raspberry Pi hardware bring-up and validation, not another software feature milestone.

See [the architecture](docs/architecture.md), [database schema notes](docs/database-schema.md), and [the product specification](docs/product-specification.md) for the approved design and v0.1 boundaries.
