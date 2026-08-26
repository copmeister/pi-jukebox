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

The backend runs in the established PipeWire user graph. It dynamically resolves
the current default sink's stable `node.name` and captures it with
`stream.capture.sink=true`; numeric node IDs and DAC models are never hard-coded.
The first fullscreen subscriber starts the isolated analysis thread and the last
disconnect stops capture. Capture or drawing failure cannot stop playback.

No renderer receives PCM, owns the audio element, changes PipeWire routing or
adds FFT work. All three renderers share the existing bounded level SSE stream,
and only the currently selected canvas is mounted.

## Current renderers

- **Spectrum** is the physically proven square-cell LED matrix. Its layout,
  red peak cells, block-at-a-time movement, Smooth/Classic palettes and vertical
  palette swipe are unchanged.
- **Golden Ratio** is the existing edge-filling six-band recursive composition.
  Its geometry, deterministic low-to-high colours and response are unchanged;
  its browser-local default sensitivity is modestly higher than Spectrum.
- **Concentric Squares** is a 32×18 square-cell field with nine edge-distance
  layers. The centre represents the lowest frequencies and the outside layer
  the highest. It aggregates the existing analyser centres over edges
  35, 70, 120, 220, 400, 750, 1,400, 2,800, 6,000 and 14,000 Hz. Silence is
  black; a nonlinear brightness curve, modest high-frequency compensation,
  fast attack and slower release expose musical energy without normalising
  quiet passages. A vertical swipe cycles the persisted solid colour through
  Cyan, Blue, Green, Magenta, Orange, Red and White.

A horizontal swipe cycles enabled renderers in either direction and wraps.
Preferences persist locally. Settings keeps a restrained Visualisers section at
the bottom where each renderer can be enabled and independently adjusted from
-6 to +6 dB. At least one renderer must remain enabled. The sensitivity control
is display-only: it does not mutate backend frames or analyser configuration.

## Tuning

Backend settings retain the `PI_JUKEBOX_` prefix:

| Setting suffix | Default | Purpose |
| --- | ---: | --- |
| `VISUALISER_BANDS` | 24 | Logarithmic analyser bands. |
| `VISUALISER_LEVELS` | 16 | Spectrum LED levels. |
| `VISUALISER_FFT_SIZE` | 4096 | FFT window; must be a power of two. |
| `VISUALISER_HOP_SIZE` | 1024 | New samples per overlapping FFT. |
| `VISUALISER_SAMPLE_RATE` | 48000 | Requested capture rate. |
| `VISUALISER_MIN_FREQUENCY` | 45 | Lowest analyser edge in Hz. |
| `VISUALISER_MAX_FREQUENCY` | 16000 | Highest analyser edge in Hz. |
| `VISUALISER_QUIET_THRESHOLD_DB` | -62 | Energy at or below this maps to zero. |
| `VISUALISER_HEADROOM_DB` | -8 | Energy at this level maps to full scale. |
| `VISUALISER_GAIN` | 1 | Fixed analyser gain; not auto-normalisation. |
| `VISUALISER_SPECTRAL_TILT` | 0.28 | Gentle high-frequency compensation. |
| `VISUALISER_RISE_RATE` | 48 | Spectrum upward block steps per second. |
| `VISUALISER_FALL_RATE` | 36 | Spectrum downward block steps per second. |
| `VISUALISER_STREAM_FPS` | 30 | Maximum SSE publication rate. |
| `VISUALISER_RETRY_SECONDS` | 2 | Missing-monitor retry delay. |

All canvases resize from their live bounds, cap pixel density for Raspberry Pi
cost, reuse level buffers and render through `requestAnimationFrame`. Concentric
Squares calculates one integer cell size at runtime and uses it for both cell
dimensions; at 1280×720 the 32×18 field is near edge-to-edge without stretching.

## Physical Pi acceptance

No machine configuration change is part of this release. Confirm on the
Raspberry Pi that:

1. Local, Internet Radio and Bluetooth audio continue through the DAC while all
   three renderers respond.
2. Horizontal swipe wraps through enabled renderers and skips disabled ones.
3. Spectrum's vertical swipe still changes only its palette; Concentric Squares'
   vertical swipe changes only its solid colour.
4. Independent sensitivity changes are visible and survive a browser restart.
5. Concentric Squares remains square and near edge-to-edge at 1280×720, fades to
   black with silence and responds centre-to-outside from bass to treble.
6. Missing monitor/capture leaves the view usable and playback unaffected.

The monitor observes the digital sink mix, not analogue amplifier or speaker
behaviour, and cannot observe a future source routed to another sink.
