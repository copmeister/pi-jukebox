# Internet Radio

Version 0.6.6 adds a deliberately small first Internet Radio mode for the
touchscreen. It stays inside the established browser playback boundary: the
application-root player context owns the same single persistent HTML audio
element used for local tracks, and Chromium continues to send that element to
the existing PipeWire default DAC output.

## Behaviour and safety boundary

- Radio is available from primary navigation and from Radio actions in Now
  Playing and the mini-player.
- A station selection pauses local playback but does not advance, replace,
  clear or otherwise mutate the authoritative queue.
- Switching stations changes only the source of the existing audio element.
- Stop removes the live stream and restores any current local queue item in a
  paused state at the beginning. Nothing resumes automatically.
- Starting Radio uses the existing local-playback preparation call, so active
  Bluetooth receiver mode is deactivated before Chromium starts the stream.
  Activating Bluetooth pauses Radio through the existing registered pause
  callback.
- A failed stream shows an unavailable/reconnecting state and retries after a
  bounded delay. It cannot stop the backend, queue, Bluetooth helper or local
  playback pipeline.
- Spectrum remains an observer of the final DAC sink monitor. Radio therefore
  needs no visualiser change, raw PCM transport or second playback engine.

No system service, PipeWire/WirePlumber rule, Bluetooth helper, updater, CD,
Sleep, queue-storage, deployment or kiosk configuration is changed by this
feature.

## Curated station catalogue

All station metadata and external media URLs live in
`frontend/src/radio/stations.ts`. Keep catalogue edits there and add or remove
stations only after repeating the technical checks below.

The first catalogue contains Classic FM, Classic FM Movies, Smooth Radio,
Heart, Capital and LBC. On 20 August 2026 each included HTTPS endpoint returned
HTTP 200, identified itself as `audio/mpeg`, and delivered live MP3 bytes during
a bounded request. That is a dated technical verification, not a promise that a
third-party URL will remain available permanently. Classic FM's official
listening page and Global Player confirm that Classic FM Movies is a separate
live sister station rather than only the similarly named Jonathan Ross
programme.

Station definitions may also provide a local `artwork` path. The Radio tiles,
mini-player and Now Playing reuse that image with aspect-preserving scaling.
Classic FM and Capital currently use bundled artwork declared by their official
sites; stations without a confidently sourced local asset retain the coloured
station-mark fallback. An image load failure immediately returns to the same
fallback, so a broken-image control is never left in the interface. Adding
artwork never changes the stream URL or playback selection behaviour.

BBC Radio 1, 2, 3, 4, 5 Live and 6 Music are excluded from this first release:
the former direct MP3 addresses returned BBC web pages, while current delivery
requires a player/HLS-style integration outside this small release. Absolute
Radio, Absolute 80s, Absolute Classic Rock, Greatest Hits Radio and Jazz FM are
also excluded because their official Rayo page data exposed candidate MP3
addresses but every bounded direct request returned HTTP 500 during
verification. Do not guess or synthesize replacement URLs.

## Rechecking a station

Before a future release, verify each URL from the target network with a bounded
request. Confirm HTTPS, a successful response, an audio content type and actual
audio bytes. Then test start, station switch, Stop, Bluetooth handoff and
Spectrum on the Raspberry Pi. A timeout after bytes are received can be normal
for a continuous live response; a redirect to HTML, an error response or no
audio bytes is a failure.

Physical acceptance should confirm that all included stations start on the Pi,
play through the DAC, survive ordinary navigation, switch without overlapping
audio, stop cleanly, and remain visible to Spectrum. Third-party availability
must be described as observed at test time rather than guaranteed.
