# Architecture

## Purpose

Pi Jukebox is a single-device, local-first application. During development, the backend and browser interface run on Windows. The finished application will run both parts on Raspberry Pi OS 64-bit and display the interface in Chromium kiosk mode.

## System overview

```text
Configured music folder
         │
         ▼
Python library services ──► SQLite catalogue and durable queue
         │                           │
         ├── JSON API ───────────────┤
         ├── artwork responses       │
         └── byte-range audio        ▼
                              React interface
                                    │
                             Chromium audio
                                    │
                              Web Audio API
```

Milestone 1 implements only the FastAPI application shell, health endpoint, configuration, and React interface shell. The other boxes describe approved future boundaries, not current functionality.

## Backend

The backend is an installable Python package under `backend/src/pi_jukebox`.

- **FastAPI** provides the local HTTP API.
- **Uvicorn** runs FastAPI during development and eventually on the Pi.
- **Pydantic Settings** reads configuration from environment variables and an ignored local `.env` file.
- **SQLite** will store the catalogue, queue, settings, and recoverable player state in a later milestone.
- Library scanning and metadata extraction will be isolated from HTTP routing so they can be tested without running a server.

The API uses `/api` as its prefix. The initial route is `GET /api/health`.

## Frontend

The frontend is a React single-page application written in TypeScript and built by Vite.

- React owns screens and interface state.
- A future player controller will be the only component allowed to control the persistent HTML audio element.
- Chromium will perform audio decoding and playback.
- A future Web Audio `AnalyserNode` will provide frequency data to a lightweight Canvas visualiser.
- During development, Vite proxies `/api` requests to FastAPI on port 8000.

The shell is designed first for 1024×600 landscape and remains usable at 800×480. It uses large touch targets, no hover-only controls, visible keyboard focus, and compact layouts for short screens.

## Configuration and data

All settings use the `PI_JUKEBOX_` environment prefix. `.env.example` documents safe values, while the developer's `.env` stays untracked.

Important planned settings include:

- The one music-library folder
- Runtime data directory
- Backend host and port
- Frontend development origin

Machine-specific paths, music, databases, caches, logs, and secrets must not be committed. Runtime data will live in the configured data directory rather than in the Python package.

## Future component boundaries

The following backend areas will be added incrementally:

- `library`: discovery, metadata, artwork, and incremental scans
- `database`: schema, migrations, and repository functions
- `queue`: persistent ordering and queue rules
- `media`: artwork and seekable audio responses
- `player-state`: recoverable current item and approximate position

The following frontend feature areas will be added incrementally:

- Library and album browsing
- Search
- Queue editing
- Player controls
- Now Playing
- Frequency visualiser

## Deliberate constraints

- The system is local-only in v0.1.
- Chromium owns playback in v0.1; Python does not wrap VLC, MPV, or GStreamer.
- There are no accounts, cloud services, or remote control.
- Deployment files wait until the kiosk milestone.
- Raspberry Pi codec and performance support must be proven on real target hardware.
