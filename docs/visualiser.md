# Real-time spectrum visualiser

## Runtime path

```text
Browser playback ─┐
                  ├─> current default PipeWire sink ─> DAC
Bluetooth A2DP ───┘                  │
                                     └─> passive sink-monitor capture
                                            │
                                  windowed FFT/log bands
                                            │
                                  small SSE level frames
                                            │
                                      canvas LEDs
```

The backend runs as `admin`, the same user that owns the established PipeWire
graph. If systemd did not supply `XDG_RUNTIME_DIR`, capture derives
`/run/user/<current uid>` without assuming a fixed uid. `wpctl inspect
@DEFAULT_AUDIO_SINK@` resolves the current sink's stable `node.name` and
`pw-record` targets that name with `stream.capture.sink=true`. Numeric object
IDs, a PulseAudio monitor alias and the observed DAC model are never hard-coded.

Capture is passive and demand-driven. The first Spectrum subscriber starts one
daemon analysis thread; the last disconnect stops its `pw-record` child.
Capture or FFT exceptions are contained at that thread boundary. No visualiser
code owns or controls the HTML audio element, queue, Bluetooth helper, DAC
default, CD service or updater.

## Tuning

All values use the `PI_JUKEBOX_` environment prefix. Defaults are intentionally
conservative for the Raspberry Pi 5 and are expected to be tuned after viewing
the physical display.

| Setting suffix | Default | Purpose |
| --- | ---: | --- |
| `VISUALISER_BANDS` | 24 | Logarithmic analysis bands; the canvas aggregates on narrow viewports and interpolates extra display columns when space permits. |
| `VISUALISER_LEVELS` | 16 | Vertical LED levels. |
| `VISUALISER_FFT_SIZE` | 4096 | Frequency resolution and analysis window. Must be a power of two. |
| `VISUALISER_HOP_SIZE` | 1024 | New samples per overlapping FFT. |
| `VISUALISER_SAMPLE_RATE` | 48000 | Requested PipeWire capture rate. |
| `VISUALISER_MIN_FREQUENCY` | 45 | Lowest logarithmic edge in Hz. |
| `VISUALISER_MAX_FREQUENCY` | 16000 | Highest logarithmic edge in Hz. |
| `VISUALISER_QUIET_THRESHOLD_DB` | -62 | Energy at or below this maps to zero. |
| `VISUALISER_HEADROOM_DB` | -8 | Energy at this level maps to full height. |
| `VISUALISER_GAIN` | 1 | Fixed analysis gain; this is not auto-normalisation. |
| `VISUALISER_SPECTRAL_TILT` | 0.28 | Gentle high-frequency compensation around 1 kHz. |
| `VISUALISER_RISE_RATE` | 48 | Maximum upward block steps per second. |
| `VISUALISER_FALL_RATE` | 36 | Maximum downward block steps per second. |
| `VISUALISER_STREAM_FPS` | 30 | Maximum backend level-frame publication rate. |
| `VISUALISER_RETRY_SECONDS` | 2 | Delay before retrying a missing monitor. |

The browser renders with `requestAnimationFrame`, independently of stream
frequency. Each column changes by at most one block in a rendered frame. Empty
cells are never painted. One integer `cellSize` is passed as both dimensions to
every canvas `fillRect`; layout is centred and derives its display-column count
from the live canvas aspect ratio. Spectrum uses the full kiosk viewport behind
compact metadata and Exit overlays, with no reserved header, footer or frequency
axis.

## Physical Pi acceptance

No machine configuration change is part of this feature. Before evaluating
colour/gain tuning, confirm the existing DAC is still the default and both local
and Bluetooth audio reach it. Then:

1. Play local music, enter Now Playing > Open Spectrum, and confirm the matrix
   responds while audio and queue behaviour remain unchanged.
2. Return to Now Playing and confirm capture stops without pausing the track.
3. Activate Bluetooth, stream music, open Spectrum and confirm the phone source
   drives the same matrix. v1 shows the phone/source fallback because the
   current Bluetooth API does not expose AVRCP track metadata.
4. Disconnect/disable the DAC monitor and confirm Spectrum remains safely blank,
   Exit Spectrum still works, and playback is unaffected.
5. At 1280×720 in Standard, Large and Extra Large display modes, inspect the
   blocks closely: every lit cell must be square, the matrix centred, the top
   block red, and a full column blue-to-red from bottom to top.
6. Observe CPU and temperature for at least one full album. If necessary,
   reduce stream FPS or band count before reducing FFT frequency resolution.

The monitor represents the digital sink mix. It cannot observe analogue
amplifier behaviour, speakers, or any future source routed to a different sink.
