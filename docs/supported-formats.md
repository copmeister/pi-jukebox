# Supported formats

## Important distinction

Metadata readability still does not guarantee playback for every codec/profile combination. The deployed Raspberry Pi 5, Chromium and DAC Pro path has played locally scanned music and a real CD rip, but new format variants should still be tested on that hardware.

## Current scanner policy

| Extension | Metadata scanning | Intended playback status |
| --- | --- | --- |
| `.mp3` | Recognized through Mutagen | Required and supported; unusual profiles still need hardware checks |
| `.flac` | Recognized through Mutagen | Required and supported; CD rips use FLAC |
| `.wav` | Recognized through Mutagen | Optional; codec/tag combinations vary |
| `.m4a` | Read when Mutagen recognizes the container | Provisional pending Chromium/Raspberry Pi testing |
| `.aac` | Read when Mutagen recognizes the file | Provisional pending Chromium/Raspberry Pi testing |

Extensions are matched case-insensitively. Unsupported extensions are ignored.

## Metadata behaviour

The scanner attempts to read:

- Title
- Track artist
- Album Artist
- Album title
- Disc and track number
- Duration
- Embedded cover art

Malformed or incomplete metadata does not stop the scan. Missing titles fall back to the filename without its extension. Missing artists use `Unknown Artist`; Album Artist falls back to track artist; missing albums use `Unknown Album`. Invalid disc, track, or duration values remain unknown.

Source music is opened for reading only. The scanner never rewrites tags or modifies, renames, moves, copies, or deletes source files.

## CD-created files

Version 0.5.0 creates FLAC files only. A track is catalogued after secure reading, FLAC encoding, metadata/artwork tagging and atomic finalisation. Temporary WAV and partial FLAC files remain outside the library and are never offered for playback. The front cover is also saved as `Cover.jpg` in the album directory when available.
