# Architecture

## Purpose

Pi Jukebox is a single-device, local-first application. During development, the backend and browser interface run on Windows. The finished application will run both parts on Raspberry Pi OS 64-bit and display the interface in Chromium kiosk mode.

## System overview

```text
Configured music folder
         │
         ▼
Python library scanner ───► SQLite catalogue
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

Milestones 2 through 4C implement the local scanner, catalogue/search APIs, browser catalogue interface, secure range-capable media responses, basic browser playback, the persistent touchscreen queue, and the classic selector. The visualiser and hardware deployment remain future work.

## Backend

The backend is an installable Python package under `backend/src/pi_jukebox`.

- **FastAPI** provides the local HTTP API.
- **Uvicorn** runs FastAPI during development and eventually on the Pi.
- **Pydantic Settings** reads configuration from environment variables and an ignored local `.env` file.
- **SQLite** stores artists, albums, tracks, artwork references, scan history, stable queue items, and queue revision state.
- **Mutagen** reads tags, duration, and embedded artwork without modifying source files.
- Library scanning and metadata extraction are isolated from HTTP routing so they can be tested without running a server.
- A guarded background thread performs manual scans. Only one scan can run at a time, and FastAPI remains available while it runs.

The API uses `/api` as its prefix. Health, scan status, albums, tracks, search, cached artwork, track media, and queue mutations are exposed. Media requests accept only a catalogue track ID. The server resolves its stored relative path beneath the configured library root, rejects escapes (including resolving symbolic links), and supports one HTTP byte range for browser seeking.

The backend queue is authoritative. Every mutation runs in an immediate SQLite transaction, returns a complete confirmed snapshot, increments a revision, and normalizes upcoming positions. Advance requests include the expected current queue-item ID; stale or repeated requests return a conflict instead of skipping another item. The complete Stop & Clear operation deletes current and upcoming rows in one transaction without touching catalogue tables. Queue rows retain safe metadata snapshots and catalogue IDs but never paths. They deliberately do not use a restrictive track foreign key, so a later scan may remove catalogue rows without blocking; missing tracks are marked unavailable and skipped on advancement.

## Frontend

The frontend is a React single-page application written in TypeScript and built by Vite.

- React owns screens and interface state.
- One application-root player context is the only component allowed to control the persistent HTML audio element. It consumes confirmed queue snapshots, so Queue, Now Playing, and the mini-player stay synchronized while navigation never recreates the element.
- One queue context loads persisted state, serializes mutations to prevent double taps, safely refetches after failures, and shows concise confirmations or errors.
- Chromium will perform audio decoding and playback.
- A future Web Audio `AnalyserNode` will provide frequency data to a lightweight Canvas visualiser.
- During development, Vite proxies `/api` requests to FastAPI on port 8000.
- A small typed client validates important response fields at runtime and converts network or invalid-response failures into safe user-facing messages.
- Catalogue summary state is shared with Library. The Jukebox selector independently requests complete track metadata when mounted. Scan status is polled only while a scan is active, then albums are refreshed.
- Search requests wait briefly after input changes and cancel stale requests.
- The search screen includes a compact in-flow QWERTY and number keypad. It changes the same editable input used by physical keyboards and can be hidden to recover result space.
- Track action menus expose Play Now, Play Next, and Add to Queue without relying on hover. Album actions support confirmed replacement and append. The Queue screen provides touch-sized deterministic Up/Down movement rather than requiring drag-and-drop.
- The default Jukebox screen requests the complete catalogue and uses a pure Fisher–Yates panel utility. It shows four eight-song panels whose state explicitly owns one persistent identity from A through D. Random panel state and discarded history remain browser-only and are never persisted.
- Each identity owns a permanent accessible accent: A amber (`#f3b53f`), B blue (`#54b6e8`), C violet (`#b08cff`), and D green (`#5fd39a`). Shared CSS custom properties tint only panel edges, selection codes, fixed letter controls, and confirmation feedback; the dark panel surface and neutral metadata text remain unchanged.
- NEXT and a valid left swipe rotate the state from A–B–C–D to B–C–D–A. The outgoing identity is recycled into a newly randomized incoming panel, retaining its letter and colour. Selection resolves the visible panel by its owned letter rather than its current array position.
- A panel never repeats a track when at least eight tracks exist. Thirty-two or more tracks fill the visible display uniquely. Smaller catalogues are distributed through fresh shuffled cycles; fewer than eight tracks therefore repeat only as needed, with immediate adjacent duplicates avoided where possible.
- Letter-then-number selection uses Play Now only when the authoritative queue has no current item; otherwise it appends. A guarded Pointer Events gesture and NEXT button share the same forward-only CSS transition. Stop & Clear updates the queue first, then resets the same root-owned audio element.
- The panel strip advances through explicit preparing, sliding, and transition-free resetting phases. A filtered `transitionend` normally completes the slide, with a short timeout fallback for interrupted events. The selector stays locked until one animation-frame reset has committed the recycled four-panel strip, preventing both double advances and a visible reverse transition.
- A Jukebox-only Web Audio engine lazily creates its context after an eligible interaction and synthesizes heavy button contact, panel movement, non-musical latch confirmation, and record-loading mechanism categories. It uses its own master/category gain structure, never connects to or modifies the persistent music audio element, and treats unsupported or suspended Web Audio as a non-fatal enhancement failure. Cancellable loading sources stop and disconnect if their expected track is superseded.
- The root audio provider owns a transient `modern`/`jukebox` presentation mode beside the same authoritative queue and single HTML audio element. A confirmed idle Jukebox selection and each subsequent queue advance prepare the expected item, show a loading/changing state, synthesize the mechanism, and start from zero after 900 ms. Modern Play Now, Stop & Clear, queue replacement, item mismatch, and provider teardown invalidate the pending token and timer so stale audio cannot start later. Queue exhaustion never schedules a mechanism.
- Sound-effect preferences use the versioned browser-local key `pi-jukebox:sound-settings:v1`. The compact modal settings surface exposes enabled, loading-pause, master, category, preview, reset, and close controls; corrupt, older, or unavailable storage safely restores defaults. Disabling all effects also disables the artificial pause, while a zero loading gain retains a silent pause.

The shell targets the official Touch Display 2 at 1280×720 landscape. Milestone 4C accepts the complete selector only at that native size. Existing smaller-screen rules remain for older modern screens but are not a detailed acceptance target for this feature. The interface uses large touch targets, no hover-only controls, visible keyboard focus, and fixed player/navigation rows.

## Configuration and data

All settings use the `PI_JUKEBOX_` environment prefix. `.env.example` documents safe values, while the developer's `.env` stays untracked.

Important settings include:

- The one music-library folder
- Runtime data directory
- Backend host and port
- Frontend development origin

Machine-specific paths, music, databases, caches, logs, and secrets must not be committed. Runtime data lives in the configured data directory rather than in the Python package. The default database is `data/catalogue.sqlite3`; content-addressed artwork is stored under `data/artwork`.

The scanner resolves the configured library root before walking it. Catalogue paths are relative to that root. Directory symlinks are not followed, and resolved audio files outside the root are rejected.

## Catalogue and scan behaviour

- Album identity is normalized Album Artist plus normalized album title.
- Track artists remain separate from the Album Artist used for grouping.
- Album tracks sort by disc number, track number, title, and stable database ID. Missing numbers sort after numbered tracks.
- Relative path is the unique track identity.
- File size and nanosecond modification time decide whether metadata needs rereading.
- A successful scan removes catalogue tracks no longer present. A failed or unavailable scan does not clear the existing catalogue.
- Artwork is deduplicated by SHA-256 hash and cached outside source control.
- Each scan records start/finish timestamps, result status, counters, and a safe error message.
- SQLite uses foreign keys, WAL journaling, short-lived connections, and a busy timeout for the API/scanner boundary.
- Schema version 2 is additive: startup creates `queue_state` and `queue_items` when absent, preserving every existing catalogue table and row. Existing databases never need to be deleted or rebuilt.
- Queue position `0` identifies the current item; upcoming positions are contiguous positive integers. Each duplicate receives its own `queue_items.id`.
- Playback time is browser-only transient state. After refresh or restart, current metadata is restored paused at zero and Chromium is never asked to autoplay.

## Future component boundaries

The following frontend feature area remains for later work:

- Frequency visualiser

## Deliberate constraints

- The system is local-only in v0.1.
- Chromium owns playback in v0.1; Python does not wrap VLC, MPV, or GStreamer.
- There are no accounts, cloud services, or remote control.
- Deployment files wait until the kiosk milestone.
- Raspberry Pi codec and performance support must be proven on real target hardware.
- Milestone 4C is the final pre-hardware feature milestone; the next stage is Raspberry Pi, display, Chromium, and audio-device bring-up.
