# Real-time visualiser system

## Runtime path

```text
Browser playback ─┐
                  ├─> current default PipeWire sink ─> DAC
Bluetooth A2DP ───┘                  │
                                     └─> passive sink-monitor capture
                                            │
                                  windowed FFT/log bands
                                            │
                                    compact level SSE
                                            │
                              active browser canvas renderer
```

The backend runs as `admin`, the same user that owns the established PipeWire
graph. If systemd did not supply `XDG_RUNTIME_DIR`, capture derives
`/run/user/<current uid>` without assuming a fixed uid. `wpctl inspect
@DEFAULT_AUDIO_SINK@` resolves the current sink's stable `node.name` and
`pw-record` targets that name with `stream.capture.sink=true`. Numeric object
IDs, a PulseAudio monitor alias and the observed DAC model are never hard-coded.

Capture is passive and demand-driven. The first fullscreen visualiser subscriber starts one
daemon analysis thread; the last disconnect stops its `pw-record` child.
Capture or FFT exceptions are contained at that thread boundary. No visualiser
renderer owns or controls the HTML audio element, queue, Bluetooth helper, DAC
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

## Frontend renderers and controls

All five modes reuse the same demand-driven SSE connection and FFT level frame.
Spectrum uses the analyser bands directly and may interpolate additional square
columns for the live viewport. Golden Ratio maps the supplied frequency centres
into the shared six logarithmic regions. Particle Galaxy and Water each map them into six broad
musical regions using logarithmic overlap weighting, including the lowest and
highest supplied frequencies. Frequency Waves uses those same compact levels;
no renderer receives PCM or performs audio DSP.

- **Spectrum** retains the 16-level square LED matrix and persisted Smooth or
  Classic colour palette.
- **Golden Ratio** draws five recursively divided golden squares and uses the
  complete remaining golden rectangle as its sixth region. This merges the two
  former highest-frequency regions and fills the recursive tail, eliminating
  the tiny persistently black centre while keeping cover-style edge-to-edge
  geometry. Its deterministic low-to-high mapping is red, orange, yellow,
  green, cyan-blue and violet; true black at low activity, fast attack and
  slower glow release remain unchanged.
- **Particle Galaxy** uses six bounded, pooled particle classes, a static
  starfield and at most eight layered sub-bass shockwaves. The live-particle cap
  is lower than the Python reference to protect the appliance.
- **Water** uses at most 28 vector ripple events with frequency-dependent size,
  speed and decay, transparent overlap, clipped mirror-source reflections and
  a cheap animated surface texture. It deliberately does not recreate the
  reference prototype's numerical 160×90 wave field.
- **Frequency Waves** draws six centred neon standing waves in those same
  frequency colours. The shared ranges remain 45–100, 100–233, 233–543,
  543–1,265, 1,265–2,947 and 2,947–16,000 Hz. Three equal-status components per
  line sample the 25%, 50% and 75% logarithmic positions inside that range,
  interpolating between the existing analyser centres rather than snapping to
  a nearest bin. Base spatial modes use 4, 5, 6, 7, 8 and 10 fixed half-wave
  lobes respectively, with two same-parity components at +2 and +4 lobes. The
  broadest line therefore shows two complete cycles and treble remains finer.
  Entire lines alternate initial direction, while every component retains fixed
  centre-line nodes at both edges. The existing level stream supplies fresh
  targets at up to 30 Hz; the Canvas uses approximately 13 ms attack, 25 ms
  release and 17 ms component interpolation on its 60 FPS animation loop. A
  lightweight symmetric spatial envelope gently reduces the outer lobes to 30%
  of their unweighted size while retaining full scale at the screen centre.
  Absolute six-band activity still controls height, so lower energy and musical
  fade-outs naturally collapse the waves to an exactly flat centre line. Strong
  activity can span 86% of the canvas height. There is no rolling PCM window,
  inverse FFT reconstruction or additional trace payload.

A predominantly horizontal swipe rotates through enabled renderers and wraps.
The opposite direction moves backwards. A predominantly vertical swipe toggles
Spectrum's Smooth/Classic palette; other renderers ignore it. Short or diagonal
gestures and gestures beginning on Exit Spectrum do nothing. The restrained
Visualisers section at the bottom of Settings stores the enabled stable renderer
IDs and current renderer locally, prevents an empty enabled set, and repairs a
disabled current selection by moving forward to the next enabled renderer.

Only the active renderer is mounted. Each canvas owns one animation frame loop,
resizes from its live bounds, catches drawing failures, and cancels its loop and
listeners when switched or exited. Galaxy targets 45 fps and Water 40 fps;
Frequency Waves targets 60 fps with preallocated level/component buffers, cached
standing-wave geometry, a capped 1.25 canvas pixel ratio and one blurred glow
pass. It adds no backend transforms or high-rate payload. Smooth stable Pi
rendering takes priority over forcing 60 fps.

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
