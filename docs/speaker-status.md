# External speaker status

The learning remote controls the Edifier speakers directly. FLIRC USB V2 also
reports its commands as keyboard events to the focused Chromium kiosk. The
frontend observes these events globally, including in Sleep, dialogs and the
visualiser; no additional daemon, input-device permissions or service is needed.
This feature never controls playback, audio routing, software volume or IR output.

| FLIRC chord | Tracked action |
| --- | --- |
| Ctrl+Shift+F1 | TV / OPTICAL |
| Ctrl+Shift+F2 | PI JUKEBOX / LINE 1 |
| Ctrl+Shift+F3 | Tap +1; hold estimates upward movement, clamped at 50 |
| Ctrl+Shift+F4 | Tap -1; hold estimates downward movement, clamped at 0; 15-second continuous hold calibrates MIN |
| Ctrl+Shift+F5 | Toggle mute once per press |

Only these complete chords are consumed. Extra Alt/Meta modifiers are rejected.
Source and mute ignore repeat events until keyup. A clean volume tap counts
exactly once on initial qualifying keydown. Known volume is bounded from 0
(physical minimum) to 50 (physical maximum), empirically verified with exactly
50 discrete taps across the Edifier R1280DB range in either direction.
The raw integer is a remote-control position, never measured acoustic loudness,
dB or a percentage. The UI has no volume bar.

Normal holds retain known state and estimate additional speaker steps using
elapsed monotonic time from the original qualifying keydown. The named
`SPEAKER_HOLD_STEP_MS = 128` constant represents approximately 7.8125 speaker
steps per second. The initial press applies one immediate step; each complete
128 ms afterward adds or subtracts another step, clamped to 0–50.
Each callback calculates the position from the original timestamp rather than
counting callbacks, so delayed scheduling catches up without accumulating drift.
Linux EV_KEY value=2/browser repeat events follow the host keyboard rate, not
the Edifier rate: they never determine the number of speaker steps.

The estimate is based on repeated manually timed full-range holds: Up took
approximately 6.3, 6.5 and 6.5 seconds; Down took approximately 6.9, 6.1 and
6.2 seconds. Fifty steps in approximately 6.4 seconds gives the 128 ms interval.
Held values are therefore estimates; clean taps are exact observed commands.
Other remotes, physical speaker controls, missed FLIRC commands and hardware
timing variation can cause drift. The Pi receives no speaker feedback.

Source starts unknown (`--`) until an absolute source command is received.
Volume starts unknown (`--`); ordinary taps and short holds do not invent an
absolute value. Only a continuous Volume Down hold for
`SPEAKER_MIN_RESYNC_MS = 15000` establishes known zero and shows
`VOLUME SYNCED · MIN`. Fifteen seconds deliberately exceeds the measured
six-to-seven-second physical full-range movement. There is no maximum
calibration, even for a long Up hold; reaching estimated 50 is only clamping.

Calibration begins on the first delivered qualifying Down keydown, before
creating feedback. No priming tap or previously visible overlay is needed.
An initially delivered repeat can start the gesture if the browser missed the
original non-repeat event. Subsequent repeats and overlay/source/mute updates
never restart its timestamp. Release, required modifier release, broken chord,
opposite volume direction, focus loss or a hidden page cancels the gesture.
After an interrupted gesture, late repeats are ignored until release or a fresh
non-repeat press. Separate holds never accumulate calibration time.
Release samples the final elapsed position and stops movement immediately.

Temporary feedback retains the v0.6.19 style: `TV | 24`, `PI JUKEBOX | --`
or `TV | MUTED` above every application screen. It stays visible throughout
a volume hold, including at a clamped endpoint or unknown volume. On release or
cancellation the existing 1.8-second timeout starts. Successful minimum
calibration retains its confirmation through the hold and release timeout.
Mute initially starts off as a tracked assumption; source/volume commands do
not clear it. Touches pass through the feedback display.

Sleep retains its clock, playback details, dimming and wake behaviour, adding
the existing smaller persistent status with updated held-volume estimates.
Remote commands do not wake the display or alter the dimmed hardware brightness.

State uses the existing versioned `pi-jukebox:speaker-state:v1` local-storage
entry. Only source, known/unknown volume and mute are saved; no active hold,
timer, elapsed duration or calibration-in-progress state is persisted.
The final estimated value survives service restarts, reloads and Pi reboots
in the same Chromium profile and origin. Persisted non-integer or out-of-range
values become unknown while valid source/mute values are retained. Malformed
state falls back to unknown; blocked storage leaves tracking operational in
memory. The existing updater retains the browser origin/profile and packages
the normal production frontend without changes to the update mechanism.

## First-press regression

The old listener rejected a first delivered repeat when its pressed-key latch
was empty. It also cleared the resync timer after chord interruption while
retaining that latch, so later qualifying events could be ignored without
rearming calibration. These input paths required a new press. The overlay itself
does not focus, remount the hook or own calibration.
The new gesture begins on the first accepted qualifying keydown independently
of rendering, and interrupted keys are explicitly cancelled until release or a
fresh press. Controlled-timer tests exercise both input paths, first-press
calibration from unknown, overlay creation and rerenders.

## Raspberry Pi acceptance

- With Chromium focused, verify all five actual chords on Jukebox, Settings,
  a dialog, Spectrum and Sleep. Incomplete chords and ordinary input retain
  their normal behaviour. F1/F2/F5 act once per physical press.
- From known volume check exact single taps, clamping at 0/50 and normal holds
  in both directions. Values should progress at approximately one additional
  step per 128 ms and retain their final estimate after release, never becoming
  unknown because of a hold. Compare the estimate with real speaker movement.
- From unknown, hold Down on the first press with no priming tap. At 14.9 seconds
  it remains unknown; at 15 seconds it shows zero and minimum confirmation.
  Verify physical minimum using the speaker's solid green light (it flickers
  while changes are accepted). Shorter or interrupted holds must not calibrate.
  A long Up hold from unknown stays unknown and shows no sync confirmation.
- Feedback stays visible throughout the hold, including at an endpoint, then
  disappears approximately 1.8 seconds after release. Check all display sizes,
  the longest `PI JUKEBOX | MUTED` label and minimum confirmation while muted.
  Sleep's smaller status remains after the large feedback disappears.
- Confirm remote commands leave playback, queue, Bluetooth/Radio, DAC routing,
  software volume and Sleep dimming unchanged.
- Reload Chromium, restart the app service and reboot: normal speaker state
  restores without an overlay or active hold. Retain the Chromium origin/profile.
- Install through the existing update UI and confirm persisted state is retained.
