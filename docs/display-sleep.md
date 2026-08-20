# Sleep display dimming

Pi Jukebox Sleep remains an application mode: it does not suspend Linux, stop
services, pause audio or disconnect Bluetooth. Version 0.6.3 additionally asks
the kernel to dim the physical DSI backlight and suppresses hidden UI painting
and UI-only polling.

Raspberry Pi OS exposes Touch Display 2 brightness through the standard Linux
backlight class. Raspberry Pi's own screen tool enumerates
`/sys/class/backlight`, reads each entry's `display_name`, matches it to the DSI
connector and writes the corresponding `brightness` value. Pi Jukebox follows
that discovery model and never accepts a device path or brightness value from
the browser.

## Pre-merge permission check

Run these read-only diagnostics on the appliance over SSH:

```bash
for device in /sys/class/backlight/*; do
  test -e "$device/display_name" || continue
  printf '%s: ' "$device"
  cat "$device/display_name" "$device/brightness" "$device/max_brightness"
  stat -c '%U:%G %a %n' "$device/brightness"
  sudo -u admin test -w "$device/brightness" && echo writable || echo not-writable
done
```

No privilege migration is included in v0.6.3. The existing `admin` application
service first attempts the standard interface directly. If no DSI node exists
or the active Raspberry Pi OS session does not grant write access, Sleep still
shows the dark clock and the API reports hardware dimming as unavailable. Do
not add broad sudo access.

If the node is not writable, capture the output above before designing a
machine-level rule. Any later rule must target the discovered Touch Display DSI
backlight only and grant only brightness-node writes to the application user.

## Behaviour and recovery

On Sleep, the service saves the exact current brightness and writes 8% of the
device's reported maximum (never increasing an already lower setting). On wake
it restores the saved integer exactly. A normal application-service stop also
attempts restoration.

If the application is forcibly killed while dimmed and normal restart does not
restore the display, use Raspberry Pi Control Centre > Screens > Brightness, or
reboot. The release does not change boot-time or persistent brightness
configuration.

Reference implementations:

- https://www.raspberrypi.com/documentation/accessories/touch-display-2.html#change-display-brightness
- https://github.com/raspberrypi-ui/raindrop/blob/master/src/raindrop.c
