# 20. The 2D view is a top-down map

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
- **Heading-up camera**, rider mid-screen, canvas height spanning 120 m. (The
  cockpit layout's paddle meter overlays the lower third; the arrow must stay
  clear of its hint card.) The road ahead fills the screen and the map scrolls
  and turns with the rider, so the view is alive even when riding alone.
- **Draw what the world has:** the sea and island coast when the network is
  loaded (one coast path cached per network), minimal tree dots and thin
  village/café outlines from the route's scenery zones and the network's cafés,
  every road as a thin context line, the ridden road at full width with
  shoulders, edge lines and dashed lane dividers, then one mark per rider or
  vehicle with its name. Me is an orange arrow.
- **Theme with the world:** `view/rideMapTheme.js` takes the selected biome's
  2D colours (ground, water, road, markings, trees and buildings) and the
  time-of-day preset, and returns the map's palette. The season and the light
  therefore read the same in 2D as in 3D: winter paints snow, ice and pine dots,
  golden hour and dusk tint the whole map, and `auto` follows the local clock.
  The rider and HUD marks keep their own high-contrast colours.
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
  visible in the HUD pill and as a soft band from the arrow to the rider ahead
  on the map; the golden lemons and my best lap's ghost keep their marks on the
  map; the minimap still shows the route and all riders.
- The map's land is a coarse hillshade sampled from the network's height grid
  (drawn on a small offscreen canvas and smoothed up), not the 3D terrain
  render; the coast, roads and riders carry the rest. The start menu's map uses
  the same theme, so the season and time of day carry from the menu into the
  ride; the two maps agree on palette, not on every tree or building.
- The 2D palette has no shaders to reuse: it derives its colours from the biome
  data and lighting presets in plain JavaScript. The biome is the single source
  of its map colours (`map`, `flora.mapColors`), in 0–1 RGB like every other
  biome colour; the biome test requires them, and an unknown biome id falls
  back to the whole temperate biome.
- Trees and buildings are symbolic (dots and thin outlines) generated from the
  route's scenery zones and the network's cafés, not the 3D meshes: they stay
  cheap and available while the world builds or without WebGL, at the cost of
  not matching the 3D tree-for-tree. The dots and outlines are placed in metres
  and scale with the map's zoom. Per-frame work stays light: the offset lane
  lines are cached per route and off-view context roads are skipped whole, so
  the WebGL 2 fallback stays cheap on small devices.
- The 2D view now has a pure camera and offset maths, tested with fake canvases
  and screenshots at the sizes the lane strip failed on.
