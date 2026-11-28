# 0035 — 2D views drawn from the 3D world with sprites baked on the device

Date: 2026-11-26 · Status: accepted

## Context

Devices that cannot run the 3D world well (`view3d/qualityPick.js`: no WebGL 2, or frames over 70 ms
at Low) ride in 2D. The old 2D map (`view/rideMapView.js`) draws its own light scenery with its own
symbols, so it looks like a fallback and drifts from the 3D world with every scenery change. Almost
every device sent to 2D still has WebGL 2: it is too slow to render 3D every frame, not unable to
render at all.

## Decision

The 2D views (a top-down **Map** and a layered **Side** view, `client/public/js/view2d/`) draw from
the same scene the world worker builds for 3D (`plan`, `ground`, `roads`, `crowd`, `arches`, …), and
every tree, building, animal, spectator and rider in them is a picture of the real 3D asset:

- `sprites/baker.js` renders each workbench asset once into a canvas with an orthographic camera (side:
  pitch 0.16 rad; top: straight down with its shadow), for the current season and each rider's look.
  It is the only module in `js/view2d/` allowed to import `js/three.js` (`client/layering.mjs`).
- `sprites/spriteStore.js` bakes a few sprites per frame, nearest first, within a time budget and a
  40 MB cap; a rider not yet baked is drawn with the default look's sprite.
- Map and Side then draw with Canvas 2D only; nothing is rendered in 3D per frame.

Rejected: sprite sheets pre-rendered by a script and committed (several MB per season, regenerated on
every asset change, riders only tinted); keeping the map's own drawn scenery (drifts, every feature
drawn twice).

## Consequences

- 2D matches 3D by construction: a new asset or scenery rule shows up in both.
- Devices without WebGL 2 cannot bake: they keep the old `rideMapView` map, and Side is not offered.
- The bake costs time and memory at load on exactly the weak devices: about 240 sprites took 64 s in
  headless software GL. `sprite-probe.html` measures it on a real device; the store shows the view as
  soon as what is in view is baked. One multi-frame bake (a 12-frame rider) can still exceed the
  per-frame budget.
- The baker holds a second WebGL context next to the 3D view's; it is freed on dispose.
