# Roadside boards — design

Date: 2026-11-27. Branch `feat/roadside-boards`, based on `feat/polished-world` (PR #144, the Three.js world).

## Intent

Motivation *during* a ride (the other half to "come back to the app and the bike"). Big advertising-style
billboards beside the road carry funny, motivational posters in the OpenRadlr spirit (lemon, Radler, beer +
lemonade, the mascot). Some sit where effort matters (hard climbs, the last kilometre before the line), some
are rare surprises along the way, and some are placed by the rider's own season goals (#99) so the world
pushes them toward this week's target. As a gimmick, a rider can put their own pictures and lines on the
boards (a cat, a meme, a photo of their real bike); those stay on their device.

## Goals

- Billboards as a real piece of the 3D world: fixed spots, same for everyone, there on every lap.
- Default posters that are funny and motivational, en + de, drawn by us (no photo or image files).
- Push boards on hard climbs and in the last km before the start/finish line (= end of each lap and of a race).
- Goal boards that appear at the point in *this* ride where a season goal's weekly step is (nearly) reached.
- "My boards": own pictures and lines, local only, on the general boards.

## Non-goals

- Boards in the 2D views (#145) or the spin studio. 3D ride view only (the menu's drone view may show
  the frames with default posters, that's free).
- Race-state posters ("FINAL LAP") that change during a race. Possible later.
- Sharing uploads with other riders, or any server-side handling of them.
- Real ads or sponsors.

## Anti-goals (failure even if it works)

- **The world fills up with boards.** A 20 km lap shows roughly 2–3 general boards, plus the climb and last-km
  ones. It must feel like finding something, not an ad-lined motorway.
- **Uploads leave the device**, in any form (account backup, WebSocket, logs).
- **A screenshot of a user's upload looks like OpenRadlr's own content.**
- Posters that are preachy or generic gym-poster text instead of the OpenRadlr joke.
- A measurable frame-rate cost at Low.

## Constraints (from the code)

- World placement happens in the world builder (`view3d/features.js` style: deterministic from route geometry
  + seed, plain data) and crosses to the view through `view3d/worldScene.js`'s `sceneOf`, which whitelists
  fields. A new `boards` field must be added there.
- Layers are registered in `view3d/scene/worldScene.js`; the clearing/occupancy mechanism (`cafeClearing`,
  `occupancy`, `avoid`) keeps plants and props off a site. Boards need the same so trees don't grow through
  them and verge clumps don't stand in front.
- Assets (`view3d/assets/`) stay free of the document; posters with a real font and images are painted with a
  canvas on the main thread (OffscreenCanvas where available, else a `<canvas>`), in the layer, not the asset.
- Quality levels (Low … Ultra): Low ride is at ~200 draw calls; boards must stay within a handful.
- Account backup (ADR 0032, `profile/localData.js` `backupSnapshot`) sends profile, goals, progress, settings
  keys from storage and best laps. Uploads must never be in it.
- Rider-scoped storage (ADR 0028, #112): each rider's data separate; IndexedDB named per rider
  (`riderDbName`, as `ride/rideStores.js`).
- UI text in `js/i18n/en.js` + `de.js`.

## Approaches considered

- **A. Fixed spots in the world, poster per screen (chosen).** The world builder plans board sites once per
  route (general, climb, last km); a board layer draws the frames instanced; each screen picks and paints the
  posters itself. Goal boards are a separate small dynamic layer following the ride, like the lemons.
  Boards belong to a place, sit in proper clearings and repeat each lap; costs two kinds of placement.
- **B. Everything placed around the rider during the ride.** Simpler, but boards don't belong anywhere, can
  land in a hedge or wall, differ each lap; works against a believable island. Rejected.
- Default poster art: **canvas-drawn flat illustrations (chosen)** vs. rendering our 3D assets into posters
  via the #145 sprite baker (dependency on an unmerged PR, load-time cost). Rejected for now.

Owner picked A with canvas posters.

## Design

### Board kinds and placement

| Kind | Where | How many |
|------|-------|----------|
| general | village edges, long straights, junction areas; never deep in forest; facing the riding direction | ~1 per 7–10 km of route, at least 2 per loop; min. 3 km apart |
| climb | climb markers at least 1.5 km long (markers carry `length` only, no gain) | 1 shortly before the top; a 2nd mid-climb when the climb is ≥ 2.5 km; clear of arches/banners by `BANNERS.clearOfArchM` |
| lastKm | 600–900 m before the start/finish marker; on a route without one, before the route's end | 1 |
| goal | dynamic, see below | 0–2 visible at a time |

Sites are deterministic from route + seed. A site is a clearing (like `cafeClearing`), set back from the verge
so the board stands beside, not on, the road, angled ~20° toward oncoming riders. The site claims its
footprint in the occupancy grid so trees, verge clumps and houses keep off it, and the board needs line of
sight from the road (the landmark rule: forest must not hide it).

Two-way roads and out-and-back routes: a board faces the main riding direction only; unseen on the return leg is fine.

Only the ride view mounts the board layer with posters. The cockpit/second screens draw no 3D world, so uploads
cannot reach them; the menu's drone view shows default posters only (no uploads, no goal boards).

### The board

One asset: a large billboard (~6 × 3 m poster on two or three posts, a frame/back, a little walkway rail
optional at Medium+). Frames are one instanced mesh per part across all static boards. Posters are planes
with per-board textures; to stay at a few draw calls, posters share one texture atlas (e.g. 2048² holding 8
posters at 1024×512; a second atlas at most). At night the poster gets the sign glow (`GLOW` like road
signs) or a small lamp on top at Medium+.

### Poster content

Pool of default posters: text + flat illustration, painted on canvas in a bold print-ad style. Illustrations
drawn from shapes: lemon, Radler glass, beer + lemonade, mascot, rider silhouette, a hill. About 30 lines in
en/de, split into:

- general: e.g. "Half lemon, half legend.", "Pain is temporary. Lemonade is forever.",
  "The Radler is cold. You're not there yet."
- climb: "Squeeze the lemon!", short and punchy.
- lastKm: "Last km. Empty the glass.", "SPRINT!".

The owner reviews and cuts the line list before it ships (written as part of the plan, in i18n).

Choice per board, made once when the ride view builds its posters: the general boards in route order take the
rider's uploads first (fewer uploads than boards: uploads fill the first boards, defaults the rest; more uploads
than boards: a date-seeded rotation picks which uploads show this ride). Everything else is seeded by route +
board index, so the same route shows the same default posters each ride. Posters are painted in the rider's
language.

### Goal boards

From the season goals (`profile/seasonGoals.js`, this week's step) and this week's rides before today:

- **total, distance:** remaining = week step − done. If remaining is reachable in this ride (any distance),
  a board at ride distance = remaining: "Week done! 80 km ✓", and one ~2 km before: "2 km to your weekly 80".
- **long:** this week's long ride L; board at ride distance L − 10 % (or − 5 km, smaller): "5 km to your long
  ride", and at L: "Long ride done ✓".
- **lap:** near the line on the goal's route: "Beat 42:10 this lap".
- **time / climb metrics:** cannot be mapped to a distance exactly; the layer projects with the current pace
  and puts the board ~1 km ahead once the projected point is that close.

Ride distance maps to a route position (mod lap length on a loop). A goal board is placed at the nearest
free verge spot near that position (same side rules, no clearing in the world plan; it may stand in front of
plants — acceptable for a dynamic board, keep it small checks only: not in the road, not over water).
Already reached goals produce no board. Posters re-paint when a number changes (once per board, not per frame).

Data: the goal state and this week's done amounts are read when the ride starts (from `seasonGoals.js` and the
ride history, the same way the HUD's goal line gets them) and injected into the goal-board planner (pure:
goals, week totals, ride distance, pace → board list). The live part is only the ride's own distance/time/climb.
A projected (time/climb) board is placed once, when its projected point is within ~1 km, and then stays put;
no projection while the rider is stopped. Goal boards have their own two small textures (not in the atlas).

### My boards (uploads)

- **Profile > My boards**: add a picture (cropped to the poster's 2:1 shape by dragging), a line of text, or
  both; preview as on the board; remove. Cap: 12 entries per rider.
- Pictures are downscaled on the device to 1024×512 and re-encoded (drops EXIF/GPS). Nothing else.
- Stored in a per-rider IndexedDB (`riderDbName("openradlr-boards", riderId)`), not localStorage.
- Not in `backupSnapshot`, not in any server message; test asserts the backup has no board data. Not in the
  local data export either (keeps the file small; owner may change this).
- Deleted by "delete rider" and "delete everything" (`deleteConfirm`, `localData`), listed there with a count.
- Used on **general** boards only; climb, last-km and goal boards keep their own wording. Uploads take general
  boards first; if a rider has more uploads than general boards, they rotate by ride (seeded by date).
- Marker: every upload poster gets a **red bar (12 % of the poster height) along the bottom edge with a bold "Your upload"** (rider's
  language), painted into the poster, not switchable. Default posters carry nothing extra.
- Shown only on this rider's own screen. Other riders and the second-screen relay never see them.

### Quality

Boards show at every level. Low: frame without walkway/lamp, poster atlas at half resolution, no shadow.
Draw calls: +≤ 4 at Low (frames instanced + one atlas material + goal boards).

## Docs and decisions

- ADR: "Roadside boards: shared spots, per-screen posters, uploads stay on the device" (next free number).
- `docs/` feature note for My boards (privacy rules above).
- No protocol change (nothing goes over the wire).

## Left to the builder

- Exact asset proportions and poster layout style (within "bold print ad"), the illustration drawings.
- The general-board site scoring (village edge / straight / junction), within the density above.
- The atlas layout and how the canvas painting is split from the layer (keep painting a pure-ish module with
  an injected canvas factory so it can be tested in node).
- Copy for the line list (owner reviews).
