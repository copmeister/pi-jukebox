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

## Agreed product behaviour

- Design primarily for the official Touch Display 2 at 1280×720 landscape. Retain 1024×600 as a secondary size and 800×480 as a compact fallback.
- Develop with Windows audio until the Raspberry Pi audio hardware is selected.
- Require MP3 and FLAC. WAV may be supported. M4A/AAC remains provisional until tested on the Pi.
- Group albums by Album Artist and Album title.
- Order album tracks by disc number and then track number.
- If the currently playing queue item is removed, allow it to finish before continuing with the revised queue.
- After a restart, restore the queue, current item, and approximate position, but remain paused.
- Defer shuffle and repeat.
- Begin with a clean, modern visual direction.
- Use configuration files for initial kiosk administration.

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

- CD playback or ripping
- Streaming services
- User accounts
- Remote access and phone control
- Internet metadata lookup
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
- The layout is intended for 1280×720 and has secondary rules for 1024×600 and 800×480.
- Backend tests and lint/format checks pass.
- Frontend tests, lint, type checking, formatting, and production build pass.
- No music, machine-specific path, database, secret, or deployment script is committed.
