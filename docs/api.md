# Local API reference

All endpoints use the `/api` prefix and return JSON unless they serve artwork or audio. IDs must be positive integers. Errors use safe messages and never expose local filesystem paths.

## Queue snapshot

`GET /api/queue` returns:

- `revision`: increasing integer changed by each successful mutation
- `current`: the position-zero item or `null`
- `upcoming`: ordered positive-position items
- `upcoming_count` and `upcoming_duration_seconds`
- `warning`: a safe message when unavailable entries were skipped

Each item includes its stable queue-item `id`, catalogue `track_id`, `album_id`, title, artist, album, duration, artwork reference, position, current/upcoming status, and availability. It never includes a source filename or path.

## Queue mutations

| Method and path | Meaning |
| --- | --- |
| `DELETE /queue` | Atomically remove current and upcoming items for Stop & Clear. |
| `POST /queue/tracks/{track_id}` | Append one upcoming item. |
| `POST /queue/tracks/{track_id}/next` | Insert first among upcoming items; do not autoplay when there is no current item. |
| `POST /queue/tracks/{track_id}/play-now` | Replace current, preserve upcoming, and return the new current item. |
| `POST /queue/albums/{album_id}` | Append all album tracks in catalogue order. |
| `POST /queue/albums/{album_id}/play` | Replace current and upcoming with the ordered album. |
| `DELETE /queue/items/{queue_item_id}` | Remove an upcoming item. Current removal returns `409`. |
| `DELETE /queue/upcoming` | Remove all upcoming items while preserving current. |
| `POST /queue/items/{queue_item_id}/move` | Move one upcoming item using `{"direction":"up"}` or `{"direction":"down"}`. |
| `POST /queue/advance` | Complete the expected current using `{"current_item_id":123}` and promote the next playable item. |

Every successful mutation returns the complete queue snapshot. `DELETE /queue` increments the revision even when the queue is already empty and never changes catalogue rows or music files. Missing catalogue or queue IDs return `404`; invalid request values return `422`; protected current-item operations, impossible movements, and stale advancement return `409`.

`GET /api/tracks` returns the complete local track catalogue used for random selector generation. Panel ordering is deliberately decided in the browser after this response; the endpoint order is not a presentation order.

## Other endpoint groups

- `/health` — application health
- `/library/scan` and `/library/scan/status` — non-blocking library scanning
- `/albums`, `/albums/{id}`, `/tracks`, `/tracks/{id}`, and `/search` — catalogue browsing
- `/artwork/{id}` — cached embedded artwork
- `/tracks/{id}/media` — root-confined audio with complete and single-range responses

FastAPI also exposes interactive documentation at `/docs` while the backend is running.

## CD endpoints

- `GET /api/cd/status` â€” drive, disc, storage, metadata candidates, selection and latest job
- `POST /api/cd/metadata/retry` â€” restart bounded metadata lookup
- `POST /api/cd/releases/{release_id}/select` â€” select only a server-known candidate
- `GET /api/cd/releases/{release_id}/artwork` â€” runtime-cached selected cover
- `POST /api/cd/rips` with `{ "release_id": "..." }` â€” start the sole background job
- `POST /api/cd/rips/{job_id}/cancel` â€” request race-safe cancellation
- `POST /api/cd/eject` â€” eject only while the ripper is idle

No CD endpoint accepts a device path, output path, executable, command or arbitrary URL.

## Software endpoints

- `GET /api/system/updates` â€” installed/latest version and safe availability state
- `POST /api/system/updates/check` â€” start one asynchronous stable-release check
- `POST /api/system/updates/install` â€” request the fixed helper only when explicitly configured

The browser never receives GitHub credentials or controls repository/release URLs.
