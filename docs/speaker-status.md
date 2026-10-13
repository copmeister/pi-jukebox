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
| Ctrl+Shift+F3 | One tap counts one step up; detected hold makes volume unknown; long hold resyncs MAX (50) |
| Ctrl+Shift+F4 | One tap counts one step down; detected hold makes volume unknown; long hold resyncs MIN (0) |
| Ctrl+Shift+F5 | Toggle mute once per press |

Only these complete chords are consumed. Extra Alt/Meta modifiers are rejected.
Source and mute ignore repeat events until keyup. A volume press counts once on
initial keydown. If a native repeat arrives, this is a held-volume operation and
the tracked volume becomes unknown (`--`). Linux EV_KEY value=2 repeats follow
the host keyboard repeat rate; they have not been shown to correspond one-for-one
with Edifier volume steps. No count, duration or repeat-rate estimate is used.
Lost focus or a hidden page clears held keys; orphan volume repeats also make
tracking unknown but cannot start calibration without a fresh press. Releasing
the held volume key or either required modifier, an invalid chord, or an opposing
volume command cancels an unfinished resync. A fresh press in the opposite
direction starts its own full-duration hold. Separate short holds never accumulate.

Source starts unknown (`--`) until an absolute source command is received. Volume
starts unknown (`--`) and remains so during ordinary up/down taps until a
continuous endpoint hold establishes a reference. Real Edifier R1280DB testing
verified exactly 50 discrete taps from minimum to maximum and 50 back again:
the tracked integer is bounded from 0 (physical minimum) to 50 (physical maximum).
Clean Up/Down taps change a known value by one, clamped at those endpoints.
The raw integer is a remote-control position, never measured acoustic loudness,
dB or a percentage. The UI has no volume bar.

Ordinary Up/Down holds invalidate the intermediate count. Releasing either hold
after repeats but before its calibration threshold leaves volume unknown.
A sufficiently long continuous Down hold establishes known 0; a sufficiently
long continuous Up hold establishes known 50. Further repeats in that same
calibrated hold retain its endpoint. Resync keeps mute and source unchanged.
Mute initially starts off as a tracked assumption; no other speaker command
clears it.

The calibration durations are the separate `SPEAKER_MIN_RESYNC_MS` and
`SPEAKER_MAX_RESYNC_MS` constants in `frontend/src/speaker/useSpeakerStatus.ts`,
both set to 8000 ms. Repeated manual full-range timing tests measured Up holds
at approximately 6.3, 6.5 and 6.5 seconds, and Down holds at approximately 6.9,
6.1 and 6.2 seconds. Eight seconds provides a safety margin above the slowest
observed transition (about 6.9 seconds), allowing for manual timing and hardware
variation. The deliberate gesture makes the additional delay acceptable. The
green speaker light flickers while accepting
volume changes and remains solid for further commands at an endpoint, providing
the observed physical verification cue. The Pi does not receive that light's
state; calibration is based on the continuous hold and verified duration.

The temporary display shows `TV | 50`, `PI JUKEBOX | --` or `TV | MUTED` in large
type above every application screen. It expires 1.8 seconds after the most recent
accepted command or resync; volume repeats show unknown and restart the timeout
(or retain its endpoint after calibration in the same hold).
Successful resync adds `VOLUME SYNCED · MIN` or `VOLUME SYNCED · MAX`, retained
for further repeats in the same hold. Touches pass through the feedback display.
Sleep retains its clock,
playback details, dimming and wake behaviour, adding a smaller persistent status.
Remote commands do not wake the display or alter the dimmed hardware brightness.

State uses the existing browser-local persistence pattern, in the versioned
`pi-jukebox:speaker-state:v1` local-storage entry. Source, known/unknown volume
steps and mute are saved immediately after each accepted command and resync.
They survive service restarts, browser reloads and Pi reboots in the same Chromium
profile and origin. Browser data must be retained, as for existing display/sound
preferences. Persisted non-integer or out-of-range volume values become unknown,
while a valid source and mute state are retained. Malformed state falls back to
unknown values; blocked storage leaves tracking operational in memory only.
The existing updater retains that origin
and profile, and packages the frontend through its normal production build.
No release/update process or version changes are included in this feature.

The speakers provide no feedback. Other remotes, physical speaker controls or
missed FLIRC commands can make tracking drift. The integer is an observed command
count, not measured loudness.
Hold Volume Down or Volume Up to recover the corresponding endpoint reference.
There is no automatic mute calibration.

## Raspberry Pi acceptance

- With Chromium focused, verify all five actual FLIRC chords on Jukebox, Settings,
  a dialog, Spectrum and Sleep. Incomplete chords and ordinary touch/keyboard
  input must retain their normal behaviour.
- From known volume, check each clean Up/Down tap counts exactly once, Down
  stays at zero at minimum, and Up stays at 50 at maximum. Hold either button and
  verify the first
  native repeat changes tracking to `--`, without estimating amplifier steps.
  Release a short Up or Down hold and confirm it stays unknown; further ordinary
  taps must leave it unknown. Check disappearance about 1.8 seconds after the final
  event. Confirm F1/F2/F5 each act once per physical press and again after release.
- Establish a known source. From maximum, verify an eight-second Down hold reaches
  physical minimum when `0` / `VOLUME SYNCED · MIN` appears. From minimum, verify
  an eight-second Up hold reaches physical maximum when `50` / `VOLUME SYNCED · MAX`
  appears. Confirm further commands at each physical endpoint leave the speaker
  light solid. Check the selected eight-second gesture on the final kiosk build.
  Check shorter holds do not calibrate, further repeats in the calibrated
  hold retain its endpoint, and the same count returns to the same physical setting.
- Check readability at 1280×720 in all display-size modes, including the longest
  `PI JUKEBOX | MUTED` label, Sleep at its dimmed brightness, and synced feedback
  while muted (which still displays `MUTED`). The small Sleep status should remain
  after the large feedback disappears; remote use should leave Sleep active.
- Verify selecting TV does not pause current playback, change the queue, stop
  Bluetooth/Radio, change DAC routing or change software volume/mute.
- Reload Chromium, restart `pi-jukebox-app.service`, and reboot. Confirm all three
  tracked values restore with no startup overlay. Keep the existing Chromium
  origin/profile; clearing browser data resets tracking to unknown.
- In a later approved release, install using the existing update UI and confirm
  the same persisted state is retained. No release is prepared by this change.
