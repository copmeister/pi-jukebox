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

Milestones 2 through 4C implement the local catalogue, browser playback, persistent queue and classic selector. Version 0.5.0 adds isolated CD and release-update domains without replacing those stable paths. Version 0.6.0 adds an external Bluetooth audio source through a separately isolated helper; it does not add a second browser player or queue.

```text
USB audio CD -> python-discid/libdiscid TOC -> MusicBrainz / Cover Art Archive
      |                              |
      +-> cdparanoia -> WAV staging  |
              -> flac -> Mutagen tags/artwork
              -> atomic FLAC rename -> single-file catalogue index

GitHub Release check -> authenticated local gh CLI -> safe status API
stable release tar + external manifest -> root-owned validation and staging
              -> offline per-version venv + prebuilt frontend
              -> atomic version pointer -> service restart + health check
                                      `-> automatic rollback on failure

Phone -> BlueZ A2DP sink -> PipeWire/WirePlumber -> existing DAC default sink
Browser -> FastAPI -> strict Unix socket -> isolated BlueZ D-Bus helper
```

## Backend

The backend is an installable Python package under `backend/src/pi_jukebox`.

- **FastAPI** provides the local HTTP API.
- **Uvicorn** runs FastAPI during development and eventually on the Pi.
- **Pydantic Settings** reads configuration from environment variables and an ignored local `.env` file.
- **SQLite** stores artists, albums, tracks, artwork references, scan history, stable queue items, and queue revision state.
- **Mutagen** reads tags, duration, and embedded artwork without modifying source files.
- Library scanning and metadata extraction are isolated from HTTP routing so they can be tested without running a server.
- A guarded background thread performs manual scans. Only one scan can run at a time, and FastAPI remains available while it runs.
- The CD coordinator polls a configured drive in a daemon thread, suspends probing while secure extraction is active, and keeps hardware/network failures independent from playback. The maintained `python-discid` binding reads MusicBrainz `libdiscid` results: its short FreeDB ID remains the internal job/disc key, while its distinct 28-character MusicBrainz Disc ID and TOC are used for exact and fuzzy release lookup.
- `cdparanoia` reads one track into a hidden staging directory on the external filesystem, `flac` encodes it, and Mutagen applies FLAC tags and optional front artwork. Same-filesystem staging makes the final rename genuinely atomic. Subprocesses use explicit argument arrays with `shell=False`; metadata never becomes executable input. Configurable POSIX niceness reduces Pi contention.
- SQLite schema version 3 adds jobs and per-track lifecycle history. Startup marks previously active work interrupted, retains finalized tracks, and cleans only the configured staging root. A cancelled or interrupted attempt can seed a new attempt with Ready rows only after the current disc/release snapshot, confined destination path and finalized FLAC tags all match. The new worker skips those immutable files and processes only missing tracks; ambiguous history or files become a non-overwriting conflict.
- Finalized tracks use sanitized Artist/Album names and `os.replace`, then enter the catalogue through a single-file scanner operation sharing a lock with full scans. A final reconciliation follows the job.
- Storage validation resolves mount, library and output paths; requires output beneath both approved roots; checks a genuine mount, write access and free space; and rejects conflicts instead of overwriting.
- MusicBrainz requests use a versioned identifying User-Agent, timeout and bounded retry. Cover Art Archive failure is advisory. Available art is written atomically as `Cover.jpg` and embedded in each FLAC.
- Bluetooth HTTP routes call a bounded local client only. The client speaks a versioned, exact-shape JSON protocol over one fixed Unix socket and fails closed when disabled, absent, slow or malformed. It never accepts a command, MAC address, D-Bus path or audio destination from the browser.
- The Bluetooth broker runs under a dedicated unprivileged account, owns one BlueZ `DisplayYesNo` agent and uses `dbus-fast` rather than subprocesses. It hashes BlueZ paths into opaque UI IDs, sanitizes phone names, serializes mutations, limits discoverability/pairability to 120 seconds, requires touchscreen approval before trust, exposes only remote A2DP Audio Source devices, and reconciles explicit or unsolicited connections to one active trusted phone. BlueZ persists pairing keys; receiver presentation itself is transient and starts inactive.

The API uses `/api` as its prefix. Health, scan status, albums, tracks, search, cached artwork, track media, and queue mutations are exposed. Media requests accept only a catalogue track ID. The server resolves its stored relative path beneath the configured library root, rejects escapes (including resolving symbolic links), and supports one HTTP byte range for browser seeking.

The backend queue is authoritative. Every mutation runs in an immediate SQLite transaction, returns a complete confirmed snapshot, increments a revision, and normalizes upcoming positions. Advance requests include the expected current queue-item ID; stale or repeated requests return a conflict instead of skipping another item. The complete Stop & Clear operation deletes current and upcoming rows in one transaction without touching catalogue tables. Queue rows retain safe metadata snapshots and catalogue IDs but never paths. They deliberately do not use a restrictive track foreign key, so a later scan may remove catalogue rows without blocking; missing tracks are marked unavailable and skipped on advancement.

## Frontend

The frontend is a React single-page application written in TypeScript and built by Vite.

- React owns screens and interface state.
- One application-root player context is the only component allowed to control the persistent HTML audio element. It consumes confirmed queue snapshots for local playback and can temporarily select one curated Internet Radio stream without changing those snapshots, so Queue, Now Playing, and the mini-player stay synchronized while navigation never recreates the element.
- One queue context loads persisted state, serializes mutations to prevent double taps, safely refetches after failures, and shows concise confirmations or errors.
- Chromium will perform audio decoding and playback.
- The demand-driven spectrum visualiser captures the dynamically resolved DAC/default-sink monitor in the `admin` PipeWire graph. It resolves the stable sink name with WirePlumber and uses PipeWire's sink-monitor capture property rather than a numeric node ID. This common digital-output point covers local browser and Bluetooth audio, and can cover later sources routed to the same sink; it does not measure analogue amplifier or speaker behavior.
- FFT analysis runs in an isolated daemon thread only while a browser subscribes. It reuses its NumPy window and logarithmic band mapping, publishes only bounded LED targets over a server-sent event stream, and treats capture/analysis failure as a visualiser-only unavailable state.
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
- A root CD-status hook uses bounded polling, so navigation cannot lose an active job. A persistent header control returns to progress. Catalogue data refreshes when another track reaches Ready; playback and queue state remain independent.
- The CD screen covers missing hardware/storage, lookup, release selection, generic metadata fallback, progress, partial success, cancellation, safe Resume Rip, conflicts and completion without keyboard input. A terminal attempt remains visible but no longer hides the selected release action. Settings displays update state without receiving credentials.
- A small display-size context owns the browser-local `pi-jukebox:display-size:v1` preference. It applies Standard, Large or Extra Large design tokens at the document root immediately; invalid or unavailable storage safely falls back to Standard. This is deliberate typography/control/card sizing rather than Chromium zoom or a transformed canvas.
- The main content region and scrollable dialogs use native `pan-y` scrolling, contained overscroll and hidden scrollbar styling. General kiosk text is non-selectable to prevent drag selection, while inputs, range controls and useful Settings diagnostics retain their appropriate interaction.
- Standard retains the original four-by-eight Jukebox selector. Large and Extra Large provide three persistent letter identities A–C with six numbered slots each; the same panel generator, forward transition, queue mutation and single audio path receive the mode-specific panel count and size.
- A root Bluetooth context polls bounded status and coordinates the two mutually exclusive sources. Activating, pairing or connecting pauses the single local `HTMLAudioElement`, cancels pending Jukebox loading and preserves the queue. Starting local playback deactivates Bluetooth first. Phone disconnect never auto-resumes an old local track. While Bluetooth is active, mini-player and Now Playing show receiver state rather than local seek, volume or transport controls.
- Internet Radio uses that same Bluetooth mutual-exclusion gate and persistent `HTMLAudioElement`. Its centralized, small HTTPS station catalogue is frontend-owned; selecting another tile replaces only the element source, Stop restores any current local queue item paused, and bounded reconnect attempts remain presentation failures rather than queue or backend failures. The final DAC monitor therefore observes Radio without a second player, PCM transport, or routing change.
- Now Playing retains its existing artwork and controls and offers an in-screen Spectrum mode. A single canvas calculates square LED cells from its live viewport, aggregates bands only on constrained widths, animates at most one block per column per rendered frame, and returns to the ordinary Now Playing view without recreating playback state.

The shell targets the official Touch Display 2 at 1280×720 landscape. Standard, Large and Extra Large are visually accepted at that native size. The interface uses large touch targets, no hover-only controls, visible keyboard focus, native vertical scrolling, and fixed player/navigation rows.

## Configuration and data

All settings use the `PI_JUKEBOX_` environment prefix. `.env.example` documents safe values, while the developer's `.env` stays untracked.

Important settings include:

- The one music-library folder
- Runtime data directory
- Backend host and port
- Frontend development origin
- Bluetooth feature flag, fixed helper socket and bounded helper timeout (Pi only)

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
- Schema version 3 is additive: startup creates queue, CD history and update-history tables when absent, preserving existing catalogue, queue and rip rows. Existing databases never need to be deleted or rebuilt.
- Queue position `0` identifies the current item; upcoming positions are contiguous positive integers. Each duplicate receives its own `queue_items.id`.
- Playback time is browser-only transient state. After refresh or restart, current metadata is restored paused at zero and Chromium is never asked to autoplay.

## Safe release update boundary

`pi_jukebox.version.__version__` is authoritative and is mirrored in Python and frontend package metadata. A short startup task calls authenticated local `gh api` for one configured repository's published stable releases. It ignores drafts, prereleases, branch heads and non-semantic tags. Repository names, URLs, asset paths, commands and credentials never cross the browser API.

FastAPI can write only a fixed-schema request for the already discovered newer version. A root-owned systemd path unit watches only that predetermined file and starts the root-owned one-shot helper, so the application account needs no sudo permission. The helper independently rechecks that exact stable release, downloads only the expected tar and external manifest through the Pi account's existing `gh` authentication, validates compatibility and SHA-256 for the archive and every file, and rejects traversal, links, special entries, extras and size-limit violations.

Each release is prepared under a root-owned staging directory. Its hashed dependency lock is installed offline from an ARM64 wheelhouse into a release-local virtual environment, and its prebuilt frontend requires no production Node process. Only then is it renamed into an immutable semantic-version directory and the root-owned `current-version` text pointer atomically replaced. The managed application service restarts and `/api/health` must return both `ok` and the requested version; otherwise the old pointer is restored and the known-good service is health checked. Configuration, SQLite data, artwork, music, queue state and browser preferences remain outside release directories.

The existing graphical-session startup retains ownership of Chromium kiosk launch but no longer launches FastAPI or Vite. A fixed system service owns the application lifecycle and serves both API and prebuilt frontend on the kiosk's existing production origin, `http://127.0.0.1:5173`, allowing the updater to restart it safely while Chromium reconnects without losing origin-scoped display preferences. Windows development remains Vite on 5173 proxying FastAPI on 8000. Bluetooth has a second fixed unprivileged service whose `PartOf` relationship restarts it against the same active immutable version on update or rollback; it does not own Chromium or PipeWire. Exact updater operations are in [Safe software updates](software-updates.md), and the separately privileged Bluetooth migration is in [Bluetooth receiver](bluetooth.md).

## First integrated visualiser boundary

The frequency visualiser is now a demand-driven observer of the final digital
output. Physical Pi evaluation and tuning remain, but playback ownership and
PipeWire routing stay outside its boundary.

## Deliberate constraints

- The system is local-only in v0.1.
- Chromium owns playback in v0.1; Python does not wrap VLC, MPV, or GStreamer.
- There are no accounts, cloud services, or remote control.
- The labwc kiosk command remains machine-local; reviewed root-owned system services manage the application and updater after the one-time migration.
- Raspberry Pi codec and performance support must be proven on real target hardware.
- The Raspberry Pi 5, Touch Display 2, DAC Pro playback path and managed update/rollback workflow are operational. Bluetooth remains a hardware-test candidate until the separate physical checklist passes.
