# pi-jukebox

A touchscreen-first local music jukebox for Raspberry Pi. The backend can catalogue one local music folder, while the React interface remains a placeholder shell. Playback, queues, and the visualiser are intentionally not implemented yet.

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

Useful backend addresses:

- Health check: <http://127.0.0.1:8000/api/health>
- Interactive API documentation: <http://127.0.0.1:8000/docs>

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

The backend provides an incremental SQLite catalogue, background scanning, search, album and track queries, and cached embedded artwork. The responsive frontend displays Home summaries, album browsing, album details, search, and scan state. It does not play or queue music yet.

See [the architecture](docs/architecture.md) and [the product specification](docs/product-specification.md) for the approved design and v0.1 boundaries.
