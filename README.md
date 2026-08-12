# pi-jukebox

A touchscreen-first local music jukebox for Raspberry Pi. Milestone 1 contains the project foundation only: a FastAPI health service and a React placeholder interface. Library scanning, playback, queues, and the visualiser are intentionally not implemented yet.

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

The example configuration is safe to run unchanged. To select a music folder later, open `.env`, uncomment `PI_JUKEBOX_MUSIC_LIBRARY_PATH`, and set it to a folder on your computer. `.env` is ignored by Git.

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

The current interface is a responsive shell for a 1024×600 landscape touchscreen and scales down to 800×480. Navigation and the mini-player are placeholders that establish layout and accessibility conventions. They do not play or manage music yet.

See [the architecture](docs/architecture.md) and [the product specification](docs/product-specification.md) for the approved design and v0.1 boundaries.
