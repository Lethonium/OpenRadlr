# 18. The 2D view is a top-down map

Date: 2026-11-02 · Status: accepted

## Context

The 2D view was the POC's first view: a lane strip with distance left to right,
one row per lane. It was useful while drafting, but it was drawn for a small
panel and later stretched over the whole window. On a tall screen each lane is
hundreds of pixels high, the rider is a 14 px capsule, the metre scale ends up
under the HUD, and on a solo ride nothing in it moves: it reads as a broken,
empty screen next to the 3D world. It is also the fallback for devices without
WebGL 2, where it should still show the ride.

The client already has the data for a real map: `RouteGeometry` (the road being
ridden, including the rider's own road after a turn), the map's `RoadNetwork`
(every road, the coast and terrain), and the smoothed rider list. The start
menu already draws such a map (`view/mapPreview.js`).

## Decision

- **Replace the lane strip with a top-down map** (`view/rideMapView.js`) rather
  than trying to fit the strip to the window.
- **Heading-up camera**, rider 62 % down the screen, canvas height spanning
  120 m. The road ahead fills the screen and the map scrolls and turns with the
  rider, so the view is alive even when riding alone.
- **Draw what the world has:** the sea and island coast when the network is
  loaded (one coast path cached per network), minimal tree dots and thin
  village/café outlines from the route's scenery zones and the network's cafés,
  every road as a thin context line, the ridden road at full width with
  shoulders, edge lines and dashed lane dividers, then one mark per rider or
  vehicle with its name. Me is an orange arrow.
- **Same data as 3D, no new requests:** the map uses the route and `app.network`
  / `app.routes` that the ride already loads. Without a network it draws the
  current route on land, so it works as the WebGL 2 fallback and while the world
  builds.
- **Fit the existing layouts:** the map is clipped above the Training layout's
  workout band, as the 3D view already is. It fills the window in the other
  layouts and the HUD stays an overlay.

## Consequences

- No server or protocol change; the view consumes the same smoothed riders.
- The lane close-up (who sits where in which lane) is gone. Drafting stays
  visible in the HUD pill and the nearby-rider list; the minimap still shows the
  route and all riders.
- The map's land is a coarse hillshade sampled from the network's height grid
  (drawn on a small offscreen canvas and smoothed up), not the 3D terrain
  render; the coast, roads and riders carry the rest. The start menu's map
  palette keeps the two views consistent.
- Trees and buildings are symbolic (dots and thin outlines) generated from the
  route's scenery zones and the network's cafés, not the 3D meshes: they stay
  cheap and available while the world builds or without WebGL, at the cost of
  not matching the 3D tree-for-tree.
- The 2D view now has a pure camera and offset maths, tested with fake canvases
  and screenshots at the sizes the lane strip failed on.
