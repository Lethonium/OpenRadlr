# VR headset display — design

Date: 2026-11-13 · Status: draft, awaiting review · Issue: #86 (steps 3 and 4; steps 1 and 2 shipped with #87)

## Goal

The tablet rides as usual: trainer over Bluetooth, Strava, recording. A paired
Meta Quest 3 becomes a display for that same ride:

1. **Floating display:** the 3D view in a Quest Browser window, resizable and
   placed in the room. It needs no sideloading and no Bluetooth on the headset.
2. **Immersive:** "Enter VR" puts you on the saddle of your own bike in the
   world, on the road or in the studio. You can look around freely.

Every part of the VR view must also be checkable **without a headset**. A dev
preview draws both eyes side by side on a normal screen, and the head moves by
mouse, keyboard or URL, so headless Playwright can take repeatable screenshots.
Production hides the preview, the same way it hides the simulated trainer.

## Why

Riding in the headset is the goal. The relay from #87 is built, and the server
already has a `world` view for watchers that passes all riders through. Only
the display side is missing. A preview is needed because nobody can take
screenshots inside the headset. Without one, every visual change would wait
for a person wearing it.

## Non-goals and anti-goals

- **Not in scope:** Bluetooth on the Quest, the sideloaded APK, a native
  OpenXR app, VR controllers as game input (steering, menus), workouts in the
  gym (yoga, bodyweight) in VR, rider name labels in VR, protocol changes
  beyond `watch_status.rider_id` and the paired-screens additions.
- **Anti-goals (failures even if the code works):**
  - The camera moves on its own while in VR: a scripted move, a cut, the
    pedalling bob, or a chase-camera lag. The headset decides where the eyes
    are. Only the bike carries you along the road.
  - The preview tests different code from the headset. Both must go through
    the same per-eye drawing path.
  - The normal app gets slower or changes how it looks.

## Approaches considered (for the headset-free preview)

| Approach | Trade-off | Decision |
| --- | --- | --- |
| **Own fake headset** behind a small "XR frame source" interface; the real WebXR session and the preview are its two implementations | Covers the per-eye cameras, the head-follows camera and the in-VR HUD; repeatable screenshots in headless Chromium without a GPU; no dependency. Does not cover `navigator.xr.requestSession` itself | **Chosen** |
| Meta Immersive Web Emulator / WebXR polyfill | Emulates `navigator.xr` itself. But the emulator is an extension driven from its devtools panel (brittle in headless Playwright), and the polyfill is stale third-party code in a no-build-step app | Rejected |
| A plain eye-height debug camera, no stereo | Cheapest, but only shows what the POV camera already shows; the VR-specific code stays unchecked | Rejected |

## Decisions

| Question | Decision |
| --- | --- |
| Where the headset gets the ride | The `watch { key, view: "world" }` relay from #87. One additive protocol change: `watch_status` gains `rider_id` while live (the server's `HostGuard` already knows it), because the `world` view gives a watcher no other way to tell the host's rider apart. No version bump. |
| Page | Its own entry `vr.html` + `js/vr/main.js`, a composition root like `cockpit.html` |
| Pairing | The cockpit's flow and stored pairing (`openradlr.cockpit`), so a device pairs once and can open either page. "Use as VR display" sits in the start menu next to "Use as cockpit". |
| Shown when | `info.screens` and (`immersive-vr` supported, or `info.xr_preview`) |
| Preview gate | New server flag `OPENRADLR_XR_PREVIEW` (default `true`, like `OPENRADLR_ALLOW_SIMULATED_TRAINER`), advertised as `/api/info` `xr_preview`. `docs/deploy.md` sets it `false` for production. |
| Camera in VR | Seated on my own bike: the anchor is my rider's head on the saddle, facing the road's heading (studio: my seat facing the stage). The head pose from the headset (or preview) is added in that frame. |
| HUD in VR | A small panel at the handlebars like a bike computer, built from the pixel font (the renderer has no textures) |
| Labels, DOM overlays | Not drawn in VR (they are DOM). The 2D window shows the normal labels. |

## Parts

### Server

- `config.rs`: `xr_preview: bool` from `OPENRADLR_XR_PREVIEW`, default `true`,
  with a test like the simulated trainer's.
- `watch_status` gains `rider_id` while live (`protocol.rs`, `screens.rs`,
  `docs/protocol.md`, the cockpit ignores it).
- `/api/info`: `xr_preview`. Also in `docker-compose.yml`, `.env.example`, the
  README's settings table and `docs/deploy.md` (`false`). `docs/protocol.md`
  documents the info field.

### The VR page (step 3: the floating display)

- **`vr.html` + `js/vr/main.js`.** This page connects as a `world` watcher.
  - It reuses `CockpitConnection` with the view as a parameter (default
    `data`), so the reconnect and status logic stays in one place.
  - The page shows "Waiting for <name>'s ride…" while not live, and a
    "Not live" badge after 3 s without data, as the cockpit does.
- **Following the host.** The page draws the world of the host's rider.
  - It loads routes with `/api/route`, as `routeFollower.js` does.
  - It builds the scene with the same world worker as the app.
  - It switches world when the host's rider changes route, and switches to the
    studio when a `studio_state` arrives.
  - It feeds a `RiderSmoother`, with `myId` set to the host's rider.
- **Sharing the app's code.**
  - The host's rider is the one with `watch_status.rider_id`. Its `route`
    tells the page when to switch world. In the studio, its entry in
    `studio_state.riders[]` gives the room and seat.
  - The parked and exercise stamps and the studio rider mapping in `main.js`
    move into shared modules that both pages import (a refactor commit before
    the page). `followMyRoad` and `onMyOwnRoad` stay in `main.js`: they serve
    the tablet's own steering, and `View3D` already places riders that are
    off every route.
- **HUD in the 2D window.** Power, cadence, speed and grade come from `state`
  (4 Hz) and `resistance`; only heart rate and the workout come from `display`
  frames (1 Hz). The same split holds for the VR HUD. It's a small DOM overlay, reusing the cockpit model for the derived
  numbers.
- **Camera in the 2D window.** The app's cameras and camera cycling: chase
  modes on the road, the studio cameras in the studio. Name labels show as in
  the app. The preview and VR use the POV anchor (below).
- **Screen awake** while live (`util/wakeLock.js`).

### The XR frame source (step 4)

`js/vr/` holds the headset logic, injected into the page:

- **`XrFrameSource` interface.** Every frame it gives:
  - `views[]`, each with `{ viewport, projection, headFromEye }` (a 4×4
    matrix) and the framebuffer to draw into;
  - the head pose in the seated reference space;
  - the time.

  It drives its own frame loop: `start(onFrame)` and `stop()`.
- **The GL context.** The VR page creates View3D's context with
  `xrCompatible: true`, so it never has to call `makeXRCompatible` later, which
  can lose the context. `createContext` takes the option; the app doesn't pass
  it.
- **`webXrSource.js`** (real). It uses:
  - `navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] })`
    with the `local` reference space, because you are seated;
  - an `XRWebGLLayer` on View3D's GL context (`makeXRCompatible`);
  - the session's `requestAnimationFrame`;
  - views from `XRViewerPose.views`.

  Recenter: the yaw of the head pose when entering VR is taken as "facing
  forward". The system's recenter (the reference space's `reset` event)
  takes it anew. This is thin glue, tested with a fake `navigator.xr`.
- **`previewSource.js`** (dev). It draws both eyes side by side on the page's
  canvas:
  - 64 mm apart;
  - a fixed per-eye field of view near the Quest 3's (about 100° × 96°);
  - its frame loop is `requestAnimationFrame`.

  The head pose comes from:
  - mouse drag (yaw and pitch) and keys (arrows; `R` recenters);
  - the URL `?head=<yawDeg>,<pitchDeg>[,<x>,<y>,<z>]`, for screenshots.

  It is pure apart from the injected input, so it is unit-tested.
- **The page decides which source to use.**
  - The "Enter VR" button uses `webXrSource` when `immersive-vr` is supported.
  - "Preview VR" (only with `info.xr_preview`, and also `?preview=1`) uses
    `previewSource`.

### View3D: drawing per eye

- **The split.** `render()` is split into a frame part and a view part.
  - The frame part runs once per frame: placing riders, pedal phases, vehicles,
    crowd, lemons, shadows and the label probes.
  - The view part runs once per eye: `#drawWorld` with that eye's view and
    projection, already factored out for the workout's side view, plus
    weather.
  - `render()` keeps its signature and output for the app.
- **`renderXr({ riders, myId, myCadence, timeS, colors }, frame)`** draws each
  of `frame.views` into its viewport of `frame.framebuffer`. Its camera:
  - `eye = anchor · headPose · headFromEye`;
  - with the projection from the view, and the lens near and far planes from
    `RIDE_LENS`.

  It does no DOM label update.
- **`Renderer`** gets a target framebuffer, instead of always binding `null`
  after the shadow pass and in `viewport`.
- **The anchor.** `vr/seatAnchor.js` (pure) gives my rider's head on the
  saddle and the yaw of travel.
  - On the road it uses the rider position and heading from `world.js`
    (`riderPosition`), at `RIDER_GEOMETRY.headHeight`.
  - In the studio it uses the `pov` pose from `studioCamera.js`, without the
    bob.
  - The anchor follows `RiderSmoother`'s output directly, with no easing or
    lag of its own. Whether that's smooth enough at 4 Hz is judged on the
    headset (see Open), not built for in advance. My
    own body is hidden, as in the studio's pov; the bike stays visible.
- **Quality in VR.** The low-quality path, with no shadows, by default. Exact
  budgets are measured on the Quest (see Open).

### The HUD in VR

- **`vr/hudPanel.js`** (pure). It builds model matrices for glyph quads from
  the numbers: power (zone-coloured), heart rate, cadence and speed, plus the
  workout's target and step time when a workout runs.
- **Where it sits.** On a panel just above the handlebars, about 0.6 m in front
  of the anchor and tilted towards the eye, so you see it by looking down. It
  moves with the bike, not the head.
- **How it's drawn.** With the existing pixel-font glyph meshes; it adds the
  `W`, `b`, `p`, `m` and `/` glyphs and the units it needs.

### Pairing UI: polish and a device list

Today the pairing flow doesn't look like the rest of the app. "Second screen"
is a collapsed section at the bottom of the start settings, with the buttons
stacked in it. The code dialog is the only native `<dialog>` in the app; every
other dialog uses `.menu-dialog`. And the phone enters the code in the
browser's `prompt()` box. The rider wants it to stay out of the way (it is a
niche feature) but, once opened, to look and work like the rest of OpenRadlr.
They also want to see which devices are paired.

- **The entry point.** "Second screen" becomes one row in the start screen's
  settings, which opens its own panel in the app's dialog style
  (`.menu-dialog` and the existing card, button and spacing rules). It is
  still shown only with `info.screens`. The panel has:
  - "Pair a new screen" (tablet side);
  - the list of paired screens;
  - "Unpair all";
  - "Use this device as a cockpit" and "Use this device as a VR display".
- **The tablet's code view.** It follows the same style:
  - the code in large letters, grouped `ABC DEF`;
  - a countdown bar;
  - "Waiting for a screen…", which turns into "Paired: <device>" when the
    code is claimed;
  - "New code" once the code expires.

  The hint text covers both the phone and the headset.
- **Code entry (phone, Quest, cockpit and VR pages).** A shared component,
  `view/codeInput.js`, replaces `prompt()`:
  - six boxes, styled like the app's inputs, large enough for the Quest's
    pointer;
  - only the code alphabet is accepted, and input is upper-cased. The
    alphabet has no look-alikes (`0`, `O`, `1`, `I`, `L`), so the boxes simply
    don't take them;
  - pasting a whole code fills all boxes, and the code submits once all six
    are entered;
  - errors appear in place, with no alert, through states: "Connecting…",
    "Code unknown or expired: get a new one on the tablet", and "No
    connection to the server".

  Its logic (filtering and state) is pure and unit-tested; the DOM part is
  thin.
- **Not paired.** The cockpit and VR pages show "Pair now", which opens the
  code entry right there, instead of a paragraph pointing to the menu.
- **The paired-screens list (option 1: a list; removing stays "Unpair all").**
  - **Names.** `pair_claim` gains an optional `device`: a short name the
    screen derives from its user agent (for example "Quest 3",
    "Android phone", "iPhone"; otherwise "Browser"), at most 40 characters.
    The server passes it on in `pair_claimed { device }` without storing it.
  - **The list.** The tablet stores the list locally
    (`openradlr.pairedScreens`: `{ device, pairedAt }`). It shows the name
    and the date. "Unpair all" clears the list along with the key.
  - **The "live" dot.** It shows which screens are connected right now.
    - `watch` gains the same optional `device`.
    - A key holder can ask `screens_query { key }` on a short connection like
      the pairing one, and gets `screens_watching { devices: [...] }`. A hub
      exists while watchers are connected, even with no ride.
    - While riding, the host gets `screens_watching` pushed whenever a
      watcher arrives or leaves.
    - The tablet marks list entries with a matching name as live. Two devices
      with the same name both show live; this is accepted.
  - **What it can't do.** Per-device removal is out of scope. All screens
    share one key; per-device keys would change the relay from #87.
  - **Protocol.** These additions are documented in `docs/protocol.md`; there
    is no version bump.
- **VR entry.** "Use this device as a VR display" opens `vr.html`, pairing
  first if needed. `vr.html` has "Forget this tablet" and a link back, like
  the cockpit.
- **Text.** All of it goes in `i18n/en.js` + `de.js`.
- **Checks.** Screenshots of the panel, the code view and the code entry,
  phone-sized and tablet-sized, are compared with the app's other dialogs
  before the PR.

## Testing

- **Unit tests (plain node, as usual):**
  - the preview's poses and URL parsing;
  - `seatAnchor` on a straight and a curved road and in the studio;
  - the eye matrices for both sources: the fake XR session gives views, and
    the preview's eyes are 64 mm apart;
  - `hudPanel` layouts;
  - the shared rider-stamping module;
  - `renderXr` with a fake renderer: one shadow pass and one `#drawWorld` per
    view, each with its own viewport and framebuffer;
  - `xr_preview` in config and info (Rust).
- **Screenshots without a headset.**
  - `client/screenshot.mjs` gains a two-page mode. One page rides with the
    simulated trainer and pairs. The other opens
    `vr.html?preview=1&head=…`.
  - So `make screenshot` can shoot the preview on the road, in the studio and
    with the HUD in view.
- **On the Quest 3 (the user):**
  - the floating window;
  - entering VR on the road and in the studio;
  - recentering;
  - comfort;
  - the frame rate.

## Docs

- **ADR 0027:** "VR display as a world watcher with an injected XR frame
  source". It covers the page split, the preview behind a server flag and the
  no-camera-motion rule.
- **`docs/app.md` or a new `docs/vr.md`:** how to use it on the Quest, and the
  preview recipe for developers.
- **AGENTS.md:** the preview screenshot recipe.

## Build order (one PR, ordered commits)

1. Move the rider stamps and the studio rider mapping out of `main.js` into shared modules (refactor).
2. `xr_preview` flag on the server and in `/api/info`; `rider_id` in `watch_status`.
3. `vr.html`: the world watcher with the 2D view and HUD, and the start-menu
   entry. This is #86 step 3.
4. Split `View3D.render` into a frame part and a per-view part, and give the
   renderer a framebuffer target (refactor, with no visible change).
5. The XR frame source interface, `previewSource`, `seatAnchor` and
   `renderXr`. The preview works here.
6. `webXrSource` and "Enter VR".
7. The VR HUD panel.
8. Pairing UI: the styled second-screen panel, the code view and `codeInput`
   (styling and behaviour, no protocol change).
9. Paired-screens list: `device` in `pair_claim` and `watch`, `pair_claimed { device }`,
   `screens_query` / `screens_watching`, and the list with the live dot.
10. Screenshot two-page mode and the docs.

The branch builds on `feat/cockpit` (PR #88). It is rebased onto `main` once
that merges.

## Open (to measure on the headset)

- Is the 4 Hz state with smoothing smooth enough for my own bike, or does the
  watcher need more? This could become a follow-up, such as faster state for
  `world` watchers.
- The frame rate on the Quest 3 (72 Hz target) with the world's chunks.
  Possible fixes are a shorter draw distance in VR, or
  `framebufferScaleFactor` below 1.
- Whether the road's turns, which carry you round like a vehicle, are
  comfortable.
