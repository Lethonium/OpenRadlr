# VR display (Meta Quest)

A paired Quest shows your ride in 3D: first as a floating window with the
same ride HUD as the tablet, then, with *Enter VR*, on your own saddle with a
hologram HUD on the handlebars. The tablet stays the controller; the headset
only watches. Why it is built this way: [ADR 0027](adr/0027-vr-display-as-a-world-watcher.md).

## Using it on the Quest

1. **Pair.** On the tablet, open the start menu, *Settings*, *Second screen*,
   *Pair a new screen*. It shows a code like `ABC 234`. In the Quest browser,
   open your OpenRadlr server's address plus `/vr.html` (or on the start menu
   choose *Use this device as a VR display*), press *Pair now* and type the
   code. The tablet lists the headset under its paired screens, with a dot
   while it is live.
2. **Ride.** Start a ride on the tablet. The headset's window shows it as soon
   as the tablet is riding.
3. **Enter VR.** Press *Enter VR* in the window. You sit on your bike's saddle.
   Look straight ahead and press the Quest button to **recenter**; the
   system's recenter also works.
4. **Hands.** Turn on *Hand tracking* in the Quest settings (*Movement
   tracking*). Your hands are drawn as gloves in your kit colour and snap to
   the virtual grips when they are within 10 cm. With controllers, or when
   tracking drops, no hands are drawn.
5. **Leave** with the Quest menu. The page returns to the window.

WebXR needs a secure origin. Use an https deployment, or for a server on your
computer connect the Quest with USB debugging and run
`adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080/vr.html` on
the headset.

## Previewing without a headset

With `OPENRADLR_XR_PREVIEW` on (the default; [deploy](deploy.md) turns it
off), the VR page offers *Preview VR*: both eyes side by side on a normal
canvas, 64 mm apart, about 100° × 96° each.

- Open `vr.html?preview=1` to start it directly.
- Move the head by dragging, with the arrow keys, and `R` to recenter.
- `?head=<yawDeg>,<pitchDeg>[,<x>,<y>,<z>]` sets the head pose, for example
  `vr.html?preview=1&head=30,-10`.
- The preview shows a pair of hands resting on the grips.

## Screenshots

`make screenshot` with `--ride <page>` pairs a second screen through the real
UI (second-screen panel, *Pair a new screen*, code entry), starts a ride with
the simulated trainer and shoots the page on the paired screen once it is live:

```sh
make screenshot ARGS='--ride "vr.html?preview=1&head=0,-35" --out vr.png'
```

Start the server first (`make dev`). Without a local Node or Chromium, use the
Playwright image as in [AGENTS.md](../AGENTS.md#ui-verification-screenshots).
The software renderer draws about one frame per second, so it can take a
minute. If a step fails, the script names it and exits with an error.

A ride in the spin studio needs a class picked by hand, so shoot it manually:
start the class on the tablet, then open `vr.html?preview=1` on a paired page.
