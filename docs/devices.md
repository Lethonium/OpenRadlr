# Devices

| Device | Protocol | Status |
| --- | --- | --- |
| Smart trainers (e.g. Wahoo KICKR Core, Van Rysel D500) | Bluetooth FTMS `0x1826` and/or Cycling Power `0x1818` | Supported: power, cadence, simulation mode |
| Heart rate straps | Bluetooth Heart Rate `0x180D` | Supported, shown locally only |
| Zwift Cog (single gear) | none — a passive sprocket | Supported via virtual shifting over FTMS |
| Zwift Click v2 (two-piece), Ride, Play, Click v1 | proprietary Bluetooth protocol (unencrypted mode) | Supported: shifting, lanes, menus. Verified with a Click v2 on Android Chrome; Play and Click v1 are untested |
| ANT+ FE-C | ANT+ USB stick | Planned for native clients |

## FTMS

The client requests control (`0x00`), starts (`0x07`) and then sends
*Set Indoor Bike Simulation Parameters* (`0x11`) whenever the server reports a
new grade: wind 0 m/s, grade in 0.01 %, Crr 0.004, Cw 0.51 kg/m. The grade is
scaled by the trainer difficulty first (positive grades × difficulty, descents × 0.5).

In ERG mode the client sends *Set Target Power* (`0x05`, watts) instead; the
trainer then holds that power regardless of cadence. Grade and power commands
share one write queue, so they never overlap.

*Indoor Bike Data* (`0x2AD2`) supplies power, cadence and sometimes heart rate.
Codecs live in `client/public/js/ble/ftms.js` and are unit-tested with byte fixtures.

## Connecting a trainer

`SmartTrainer.connect` (in `ble/devices.js`) is defensive, because trainers
implement the standards differently:

1. Accept devices offering FTMS **or** Cycling Power; request both services.
2. Subscribe to every data source first: FTMS *Indoor Bike Data* and
   *Cycling Power Measurement* (`0x2A63`, cadence derived from crank revolutions).
3. Only then take control (request control, start). If that fails, data still flows.
4. Merge the sources: a source that reports real values wins over one that only
   sends zeros; Cycling Power is preferred when both are active.
5. Grade writes never overlap (one GATT operation at a time); only the latest
   pending grade is written.

## Diagnostics

The setup screen shows live power and cadence as soon as a trainer is
connected, and *Device diagnostics* lists the services found, subscriptions,
control point answers and the first 20 raw packets per source in hex.
*Copy report* puts all of it on the clipboard for a bug report. During a ride,
the Trainer panel warns if no data arrived for 5 seconds.

Common causes of "connected but 0 W": another app (Zwift, the manufacturer's
phone app) is still connected to the trainer, or the trainer reports power only
via Cycling Power (now handled).

## Virtual shifting (Zwift Cog and single-gear setups)

The Zwift Cog has no electronics; it is a sprocket that keeps the chain in one
gear. Zwift's own virtual shifting relies on proprietary trainer firmware. OpenRadlr
instead shifts **in the app over standard FTMS**, which works with any FTMS trainer
in simulation mode, Cog or not:

- 24 virtual gears (ratio 0.75 to 5.0); the rider enters the real gear
  (chainring × cog) on the setup screen.
- For virtual ratio *r* and real ratio *r₀* (k = r / r₀) the trainer resists
  with `k · max(F_road(v), F_floor)`, where *v* is the rider's speed in the
  game: each gear changes the force by its own step (about 9 %), whatever the
  cadence. `F_floor` (1.5 % in the real gear) leaves something to push against
  on descents, which count in full here (difficulty only eases climbs). The app
  solves for the grade that produces this force and sends it with no air drag
  of the trainer's own (`cw` 0), so the trainer adds nothing that depends on its
  wheel speed (`ride/virtualShifting.js`, unit-tested). It is re-sent as the
  speed changes.
- Changes of grade reach the trainer eased in over a few seconds (at most
  1.5 % per second), shifts at once. The server measures grades over 50 m of
  road, so they don't step at every point of the route.
- Gears only change how hard a pedal stroke feels. Power still decides the speed
  on the server, exactly like real gears.

Shift with <kbd>E</kbd>/<kbd>Q</kbd>, <kbd>+</kbd>/<kbd>−</kbd>, a Zwift controller or the on-screen buttons.

## Zwift Click, Play and Ride

Pair a controller with *Connect controller* on the start screen (a Play pair is
two devices: connect each half). See [ADR 0012](adr/0012-zwift-controllers.md)
for why and how.

**Protocol** (`ble/zwiftProtocol.js`, unit-tested with byte fixtures). Zwift's
protocol is proprietary; this follows public community notes and uses only the
unencrypted mode:

- The picker shows devices with Zwift's manufacturer ID `0x094A` or a name
  starting with "Zwift". Service `00000001-19ca-4651-86e5-fa29dcdd09d1`
  (Click, Play) or `0xFC82` (Ride, newer firmware).
- Characteristics: `…0002` notifications (buttons, battery), `…0003` commands,
  `…0004` answers (indications).
- Handshake: write the ASCII bytes `RideOn`; the controller answers `RideOn…`
  and then sends protobuf messages with a leading type byte:
  `0x37` Click v1 (field 1 plus, 2 minus), `0x07` Play (field 1 right/left half,
  2–5 face buttons or d-pad, 7 shift paddle), `0x23` Ride and Click v2
  (field 1 is a button bitmap), `0x19` battery percent (field 2), `0x15` idle.
  In Click v1 and Play messages `0` means *pressed*; in the bitmap a cleared
  bit does. `0x2a` and `0xff` messages (device info) are ignored.
- Bitmap, verified with a Click v2: d-pad `0x1` left, `0x2` up, `0x4` right,
  `0x8` down; `0x10` A, `0x20` B, `0x40` Y, `0x80` Z; left lever `0x100`/`0x200`
  (Click v2 "−"), right lever `0x1000`/`0x2000` (Click v2 "+"). Unknown pressed
  bits appear in hex in the diagnostics and the live check.

**Buttons → actions** (`input/controller.js`). Buttons act on press, like keys:

| Button | Riding | In a menu, dialog or the start screen |
| --- | --- | --- |
| + (right lever, Play right paddle) | shift up | next element |
| − (left lever, Play left paddle) | shift down | previous element |
| Both shift buttons together | open the menu | select (click) |
| D-pad left / right | change lane | previous / next |
| D-pad up / down | power or ERG target ± | previous / next |
| A | change camera | select |
| B | close panels | close panels |
| Y | menu | menu |
| Z | take a photo | — |

A chord within 250 ms of the first button undoes that button's shift or step,
so opening the menu with a Click never leaves you a gear off. Selecting
"clicks" the focused element: buttons, checkboxes and links work; number
fields and drop-downs still need a keyboard or touch. The *Connect* buttons
are skipped, because browsers only open the Bluetooth picker from a real tap.

After pairing, the start screen shows each press live (*Press a button to
check*), and *Device diagnostics* logs every button change with its bytes.
Pairing the same controller a second time is refused, since every press
would then count twice.

**Sleep and reconnect.** Controllers sleep after a few idle minutes and drop
the connection. The client retries after 1, 2, 5, 10 and then every 30 seconds
and repeats the handshake; a button press wakes the controller. The status
next to the button and a ride notification show it, and packets appear under
*Device diagnostics* as source `zwift`.

**Known limits.** Untested on encrypted-only firmware: if a controller never
sends buttons after the handshake, the diagnostics report shows its answer.
Junction choices (#15) will use the lane buttons once junctions exist.

## Browser support

Web Bluetooth requires a Chromium browser (Chrome, Edge) on Windows, macOS,
Android or ChromeOS and a secure context (`https://` or `http://localhost`).

## Staying connected

Devices are paired once per page load. They stay connected for as long as the
app is open, also between rides: *Back to menu* and *Reconnect* don't reload the
page.

**Drops.** When a trainer, heart rate strap or controller drops (switched off,
out of range, a controller asleep), the app connects to the same device again in
the background. It waits 1, 2, 5, 10 and then every 30 seconds, with no chooser.
A trainer that comes back takes control again and gets the last grade or ERG
target. The HUD feed says when a device drops and when it is back.

**App start.** The app remembers the last trainer, heart rate strap and up to two
controllers (`openradlr.devices` in local storage: kind, Bluetooth id, name). What
happens on the next start depends on the browser:

| Browser | On start |
| --- | --- |
| `navigator.bluetooth.getDevices()` available (Chrome with *Web Bluetooth new permissions backend*; check `chrome://flags`) | Remembered devices connect without a tap once they advertise. The status shows *Looking for KICKR CORE…*, or *Press a button on Zwift Click…* for a sleeping controller. After 2 minutes without a sign of the device, the Reconnect button appears. |
| Without `getDevices()` (most browsers today) | A **Reconnect *name*** button appears next to each device. It opens the chooser filtered to that name: one tap and a confirm. |

*Device diagnostics* logs what was remembered and whether `getDevices()` found it
(`Remembered devices: … (getDevices() found 1)`), which tells you which case
applies on a given phone.
