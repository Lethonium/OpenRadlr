# 27. A VR display that watches the world

Date: 2026-11-13 · Status: accepted

## Context

A Meta Quest should show the ride, first as a floating 3D window and then in
immersive WebXR on the rider's own saddle (#86). The second-screen relay of
[ADR 0026](0026-second-screens-through-a-server-relay.md) already carries the
tablet's extra data to paired screens, and the `world` view of the game state
already reaches any watcher. Nobody can test a headset in CI, and a developer
without one still has to see what each eye draws.

## Decision

- **A watcher page, not a second client.** `vr.html` + `js/vr/main.js`
  watches the ride through the relay (`watch` with `view: "world"`) and drives
  a normal `View3D`. It never sends rider input. When the host switches world
  (another route, the studio), the page builds the new world and frees the old
  one's GPU buffers.
- **An injected `XrFrameSource`.** Two sources sit behind one interface:
  `webXrSource` (the Quest) and `previewSource` (side-by-side stereo on a
  normal canvas, head pose from the mouse, the keys or the URL). The page, the
  hologram and the hands know only the interface, so everything except the
  WebXR glue is tested with fakes.
- **A preview behind a switch.** `OPENRADLR_XR_PREVIEW` (default on, shown as
  `xr_preview` in `/api/info`) gates the headset-free preview. A deployment can
  turn it off ([deploy](../deploy.md)).
- **The camera never moves on its own.** It follows the head and the bike's
  smoothed position and heading, with no bob and no easing, so riding is
  comfortable. The rider's own body is hidden; the bike stays.
- **HUD and hands in the scene.** A hologram panel on the handlebars shows the
  ride; Quest hand tracking draws your hands, snapped to the grips when they
  are within 10 cm.

## Consequences

- `View3D.render` is split into a once-per-frame part and a once-per-view part;
  `renderXr` draws each view of an `XrFrame`. The 2D picture does not change.
- There are no text labels above riders in VR: the renderer has no textures,
  and the HUD text is built from the pixel font.
- The Quest needs HTTPS for WebXR, so a local server needs a tunnel
  (`adb reverse`) or an https deployment ([VR display](../vr.md)).
- Screenshots of the VR view are repeatable: `make screenshot` with `--ride`
  pairs a page and shoots the preview without a headset.
- Performance on the headset itself (budgets, quality) can only be judged on a
  Quest; the preview checks the picture, not the frame rate.
