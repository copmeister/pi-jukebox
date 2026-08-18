# Database schema notes

The runtime SQLite database is stored in the ignored configured data directory. Version 0.5.0 raises `PRAGMA user_version` to 3 using additive `CREATE TABLE IF NOT EXISTS` statements. Existing artists, albums, tracks, artwork, scans and queue rows are preserved; the user must never delete or rebuild an existing catalogue for an upgrade.

## Queue tables

`queue_state` contains one row with an increasing revision and update time.

`queue_items` contains:

- Stable integer queue-item ID
- Catalogue track and album IDs
- Safe title, artist, album, duration, and artwork snapshots
- Unique deterministic integer position
- Creation time

Position `0` is the current item. Upcoming items use contiguous positions `1..n`. Duplicate catalogue tracks are allowed because queue identity comes from the queue-item ID.

Queue records contain no source filename or absolute/relative media path. The track ID is intentionally retained as a snapshot rather than a restrictive foreign key: a successful scan may remove missing catalogue tracks without being blocked by the queue. A left join marks such queue items unavailable, and advancement removes them safely. Artwork absence falls back to the normal placeholder.

## Transaction rules

Multi-row writes start with `BEGIN IMMEDIATE`. Add, replace, move, remove, upcoming-only clear, complete Stop & Clear, and advance operations update positions and revision in the same transaction. Stop & Clear deletes every `queue_items` row without altering catalogue tables. Temporary high positions avoid unique-position collisions during reordering. A stale advance must present the old current queue-item ID and is rejected, which protects against duplicate browser completion events.

Playback time, volume, mute state, and listening history are not persisted. A restored current item is presented paused at time zero and does not autoplay.

## CD rip history

- `cd_rip_jobs` stores disc/release identity, safe album labels, job status, aggregate counts, timestamps, cancellation intent and user-safe diagnostics.
- `cd_rip_tracks` stores the track snapshot and Waiting/Reading/Encoding/Tagging/Ready/Error/Cancelled lifecycle. Only Ready rows contain a final library-relative path.
- Active rows found at startup become Interrupted/Error; finalized catalogue tracks and queue rows are untouched.

`software_update_runs` reserves durable diagnostic history for the separate updater. Release credentials and command output are never stored.
