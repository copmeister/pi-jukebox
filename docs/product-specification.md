# Product specification

## Product statement

Pi Jukebox is a friendly, touchscreen-operated player for a local music collection. It will turn a Raspberry Pi and a 7-inch landscape screen into an appliance that boots directly into a clear, modern jukebox interface.

## v0.1 goals

The first release should let one person use a locally attached music library without an internet connection, account, keyboard, or mouse during normal operation.

It will eventually include:

- One configurable local music folder
- Album and track metadata with artwork
- Album browsing and track listings
- Search by album, album artist, and track
- Real playback in Chromium
- Play, pause, next, previous, seek, volume, and mute
- A persistent, reorderable queue
- A Now Playing screen and persistent mini-player
- A live frequency visualiser
- Full-screen Raspberry Pi kiosk operation

## Milestone 1 scope

This milestone establishes the project foundation only:

- Installable FastAPI backend package
- Backend health endpoint
- React, TypeScript, and Vite frontend package
- Responsive touchscreen shell
- Placeholder Home, Library, Search, Queue, and Now Playing navigation
- Persistent placeholder mini-player
- Safe environment configuration example
- Formatting, linting, testing, and build checks
- Beginner-friendly Windows setup instructions

It does not scan music, read metadata, play audio, manage a queue, draw a visualiser, create a database, or configure Raspberry Pi deployment.

## Milestone 2 scope

Milestone 2 adds the backend catalogue and scanner foundation:

- One environment-configured library folder
- Versioned SQLite catalogue for artists, albums, tracks, artwork, and scan runs
- Incremental recursive scanning with safe metadata fallbacks
- Embedded artwork extraction and runtime caching
- Non-blocking manual scans with overlap protection
- Read-only album, track, artwork, and scan-status APIs

The frontend remains unchanged. Playback, queue state, search UI, visualisation, and Raspberry Pi deployment are still outside this milestone.

## Milestone 3 scope

Milestone 3 connects the touchscreen interface to the local catalogue:

- Typed, runtime-validated frontend API requests
- Home library totals and album selection
- Touch-friendly album grid and detailed ordered track lists
- Debounced search across albums, Album Artists, track artists, and titles
- Scan configuration, availability, activity, summary, and rescan controls
- Loading, empty, unavailable, missing-artwork, and error states

Playback, media streaming, functional queue actions, the visualiser, and kiosk deployment remain outside this milestone.

## Milestone 4A scope

Milestone 4A provides the first local listening path:

- Native Touch Display 2 target of 1280×720 landscape, with 1024×600 and 800×480 compatibility
- Application-owned QWERTY/number search keypad that preserves physical-keyboard input
- Catalogue-ID media endpoint with safe root confinement and single byte-range support
- One persistent application-root HTML audio element
- Track playback from albums and search, with album-context previous/next and automatic advancement
- Persistent mini-player and functional Now Playing controls for play/pause, seek, volume, and mute
- Clear loading, paused, playing, browser-interaction, and media-failure states

This milestone does not add queue persistence, playback-state persistence, visualisation, kiosk deployment, system-wide volume, or hardware integration.

## Milestone 4B scope

Milestone 4B completes the pre-hardware listening workflow:

- One authoritative SQLite queue with stable queue-item IDs and duplicate tracks
- Play Now, Play Next, Add to Queue, Play Album, and Add Album to Queue
- Separate current/upcoming presentation, removal, confirmed clearing, and touch Up/Down reordering
- Transactional deterministic positions and migration-safe upgrade from existing catalogues
- Queue-aware manual Next and exactly-once automatic advancement
- Safe skipping of catalogue entries or media files that have disappeared
- Queue restoration after browser or backend restart without autoplay
- Current metadata restoration paused at the beginning; playback position is not persisted

This milestone established the complete persistent listening workflow before the classic selector was added. It does not add visualisation, kiosk deployment, hardware integration, shuffle, repeat, playlists, or listening history.

## Milestone 4C scope

Milestone 4C adds the final pre-hardware defining experience:

- Jukebox becomes the default navigation destination while Library, Search, Queue, and Now Playing remain available.
- Four simultaneously visible eight-song panels provide A1–A8 through D1–D8 at the native 1280×720 display target.
- A, B, C, and D are persistent panel identities with permanent amber, blue, violet, and green accents. The colour follows the owned letter as panels change screen position.
- Every newly mounted screen and incoming panel uses a fresh Fisher–Yates random selection from the complete catalogue.
- Letter-then-number controls add the chosen code without making song labels into touch targets.
- The first selection uses Play Now when no current item exists; later selections append without interruption.
- Leftward swipe and NEXT share one forward-only panel transition. The outgoing identity is recycled on the right with newly randomized tracks, producing A–B–C–D, B–C–D–A, C–D–A–B, and D–A–B–C in sequence. Discarded song groups have no history or persistence.
- Transition cleanup must be invisible: after the leftward movement completes, the recycled strip is reset without animation and unlocked on the following animation frame. A guarded fallback completes the advance if `transitionend` is lost, while reduced-motion mode advances immediately without movement audio.
- Optional synthesized mechanical feedback gives every enabled letter or number press exactly one heavy spring-loaded click. Successful queue acceptance adds one non-musical latch/contact mechanism; failed selections do not. Panel movement and ordinary non-Jukebox navigation retain their existing trigger boundaries.
- Idle Jukebox playback and transitions between queued Jukebox songs show an honest loading/changing state and run a quiet, cancellable 900 ms record-positioning mechanism before music starts at zero. Adding a song while another is playing produces acceptance feedback but defers loading until that item becomes current. Queue exhaustion has no loading sequence, and automatic advancement never repeats the earlier acceptance clunk.
- A transient presentation mode distinguishes this theatrical Jukebox path from immediate modern Library and Search playback without creating another queue or audio element. Stop & Clear and modern Play Now cancel pending starts; the mode is browser-memory-only and is not restored from SQLite.
- A compact accessible Jukebox Sounds dialog provides effects and loading-pause switches, independent master/category levels, previews, reset, close and Escape handling. Settings persist in versioned browser-local storage and never change music playback volume or Raspberry Pi system volume. Effects Off removes both sounds and the delay; loading volume zero produces a silent pause when the pause remains enabled.
- Confirmed Stop & Clear atomically removes current and upcoming queue items and resets browser audio without touching the catalogue.

Milestone 4C was the final feature before the initial Raspberry Pi hardware bring-up. Version 0.5.0 follows that successful deployment with integrated CD ripping and update foundations. Visualisation remains future work.

## Agreed product behaviour

- Use the official Touch Display 2 at 1280×720 landscape as Milestone 4C's only detailed visual acceptance target. Existing smaller responsive rules may remain but are not separately accepted for this feature.
- Develop with Windows audio until the Raspberry Pi audio hardware is selected.
- Require MP3 and FLAC. WAV may be supported. M4A/AAC remains provisional until tested on the Pi.
- Group albums by Album Artist and Album title.
- Order album tracks by disc number and then track number.
- The current queue item cannot be removed; Next skips it. Clearing affects upcoming items only.
- After a restart, restore the queue and current item, remain paused, and restart that track from the beginning after one touch. Playback position is not stored.
- Defer shuffle and repeat.
- Begin with a clean, modern visual direction.
- Use configuration files for initial kiosk administration.

## Version 0.5.0 scope

Version 0.5.0 adds the first hardware-integrated library-creation workflow:

- Detect the configured audio-CD drive without blocking startup.
- Query MusicBrainz and Cover Art Archive with bounded network operations and a generic no-match fallback.
- Present release cards and a keyboard-free Rip, Cancel, Eject and Retry flow at 1280Ã—720.
- Read and encode one track at a time, tag FLAC with Mutagen, atomically finalize it, and make it playable before the album completes.
- Persist honest job/track states and retain completed tracks through cancellation, failure or restart.
- Offer Resume Rip for the same disc and selected release after cancellation/interruption, after verifying finalized paths and FLAC identity. Never rewrite verified Ready tracks or overwrite an ambiguous destination; completed albums do not offer resume.
- Refuse an unmounted, read-only or full external drive, output-root escape or existing filename conflict.
- Show rip progress globally while preserving browsing, queue editing and playback.
- Establish version 0.5.0, non-blocking stable-release checks, private-repository credential isolation, checksum validation and health-check rollback foundations.
- Keep software installation disabled until an external update helper and release channel are explicitly approved.

## Touch and accessibility requirements

- Primary interactive targets should be at least 44 CSS pixels in both dimensions where practical.
- No required action may depend on hovering.
- Active, disabled, and keyboard-focused controls must be visually distinct.
- Text must remain readable at both supported target resolutions.
- Main screens must tolerate short height without hiding essential navigation or the mini-player.
- Search must remain usable by touch without relying on an operating-system keyboard.
- Motion-heavy features, including the future visualiser, must respect reduced-motion preferences or offer a disable option.

## Data and privacy

- Music and catalogue information remain local to the jukebox.
- Music files and machine-specific paths are never committed to Git.
- Local `.env` files, databases, logs, caches, and secrets are ignored.
- v0.1 has no remote access, telemetry, user accounts, or streaming integration.

## Out of scope for v0.1

- Direct audio playback from a CD
- Streaming services
- User accounts
- Remote access and phone control
- Tag editing
- Playlists and favourites
- Lyrics
- Crossfade and guaranteed gapless playback
- ReplayGain or normalization
- Shuffle and repeat
- Hidden kiosk exit gesture

## Milestone 1 acceptance criteria

- A new Windows developer can follow the README and start both services.
- `GET /api/health` returns a successful response.
- The browser displays all five placeholder destinations.
- Selecting a destination updates the main content without removing the mini-player.
- The classic selector must fit completely at 1280×720 without page scrolling, overlap, or controls hidden by the persistent player/navigation.
- Backend tests and lint/format checks pass.
- Frontend tests, lint, type checking, formatting, and production build pass.
- No music, machine-specific path, database, secret, or deployment script is committed.
