# Supported formats

## Important distinction

The scanner's ability to read metadata and successful playback in Chromium on Windows do not guarantee that Chromium on Raspberry Pi OS can decode and play the same file. Milestone 4A provides preliminary Windows browser playback only. Actual Raspberry Pi compatibility will be established on the real Pi, Touch Display 2, and selected audio hardware before v0.1 formats are finalized.

## Current scanner policy

| Extension | Metadata scanning | Intended playback status |
| --- | --- | --- |
| `.mp3` | Recognized through Mutagen | Required for v0.1; Pi playback still needs final verification |
| `.flac` | Recognized through Mutagen | Required for v0.1; Pi playback still needs final verification |
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
