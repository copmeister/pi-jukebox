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

- `GET /api/system/updates` â€” installed/latest version, availability, helper stage, requested/previous versions and persisted success/rollback/failure outcome
- `POST /api/system/updates/check` â€” start one asynchronous published-stable-release check
- `POST /api/system/updates/install` â€” create a fixed-schema request for the already discovered version and trigger the fixed root-owned systemd helper when explicitly configured; the jukebox client supplies the fixed `X-Pi-Jukebox-Action` header so foreign browser origins must pass CORS preflight
- `POST /api/system/display/sleep` â€” dynamically discover and dim the DSI backlight, preserving its exact current level
- `POST /api/system/display/wake` â€” restore the exact brightness saved by the preceding Sleep action

The browser never receives GitHub credentials, release URLs, filesystem destinations or command arguments. Duplicate or unsafe install requests return a conflict instead of starting another helper.

## Bluetooth receiver endpoints

| Method and path | Meaning |
| --- | --- |
| `GET /api/bluetooth/status` | Safe availability, receiver state, pairing window, eligible trusted A2DP audio sources and pending touchscreen confirmation. |
| `POST /api/bluetooth/activate` | Pause local presentation and make trusted-phone connections available. |
| `POST /api/bluetooth/deactivate` | Disconnect phone audio, cancel pairing and return to local mode. |
| `POST /api/bluetooth/pairing/start` | Open the bounded 120-second discoverable/pairable window. |
| `POST /api/bluetooth/pairing/cancel` | Close pairing and reject a pending confirmation. |
| `POST /api/bluetooth/pairing/{request_id}/accept` | Accept the exact live touchscreen confirmation. |
| `POST /api/bluetooth/pairing/{request_id}/reject` | Reject the exact live touchscreen confirmation. |
| `POST /api/bluetooth/devices/{device_id}/connect` | Connect one already paired and trusted phone, disconnecting another first. |
| `POST /api/bluetooth/devices/{device_id}/disconnect` | Disconnect the selected trusted phone. |
| `DELETE /api/bluetooth/devices/{device_id}` | Disconnect and forget the selected phone. |

Every mutation requires `X-Pi-Jukebox-Action: bluetooth-control`; the header is
not a credential, but ensures a foreign browser origin must pass the configured
CORS preflight. IDs are short-lived or opaque hashes resolved only inside the
helper. The API never accepts MAC addresses, D-Bus paths, shell commands or
audio destinations. On Windows and unmigrated Pis, status remains safely
`unavailable` and mutations return 503 without affecting local playback.
