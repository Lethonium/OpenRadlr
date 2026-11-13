# Spin studio as a building in the valley — design

Date: 2026-11-12 · Status: agreed in discussion, awaiting spec review

## Goal

The spin studio stops being a room outside the world. It becomes a glass
building across the road from the Valley Café, one floor per studio room,
growing taller as more people ride it. The start menu flies the drone to it,
riders inside look out through the glass at the real valley and the live
road, and riders on the road see the studio's riders and bots pedalling
inside.

Today the studio is a separate dark scene on its own canvas
(`view3d/studioScene.js`); picking the Studio card has nowhere to fly, so the
menu falls back to the island orbit, which looks like a jump.

## Decisions

| Question | Decision |
| --- | --- |
| Where | On maps whose network has the `valley-cafe` node: across the road from the café, facing it, glass front parallel to the road, set back about 8 m |
| Floors | Floor *n* is studio room *n* (0-based). At least 2 floors, even when room 2 is closed (then dark). Room 3 opens a third floor on top, and so on |
| Room closing | An empty extra room closes only when it is the last one, so rooms never renumber and nobody changes floor |
| Shell | Modern glass box: concrete slabs, glass front with thin mullions, solid sides and back, flat roof with a lit "Spin Studio" sign |
| Orientation | Riders face the road; the coach's stage stands right behind the glass |
| Interior | Light daylight studio: light oak floor, white walls, pale ceiling with light panels; lemon/orange only as accents; training props along the side walls |
| Inside view | The world view (`View3D`) with the room placed on your floor; the separate `studio3d` canvas goes |
| Cameras | `seat`, `wide`, `coach` kept (rebased onto the floor), plus new `pov` |
| Seen from the road | The studio's seats are mirrored into the valley world's `riders[]` with `studio: { room, seat }` |
| Road seen from inside | `studio_state` carries `road_riders[]`: the valley world's riders near the building |
| Protocol | Additive within version 2; no bump |
| Without a valley map | Today's island orbit in the menu; the room drawn on its own, glass as flat sky colour |
| Out of scope | Entering or leaving the building on the bike, other buildings for other venues, a human instructor, more than one studio per server |

## The building (client)

### Placement

The place where the outdoor gym is built (`world.js`, `features.js` → `buildOutdoorGym`)
also builds the studio when the network has a `valley-cafe` node. Pure
`studioSite(route, network, terrain)` returns `{ origin, yaw }` or `null`:

- the road point nearest the café node, its tangent and the side of the road
  the café is **not** on;
- the origin on that side, with the glass front about 8 m from the road edge,
  the local −Z axis (the riders' forward) pointing at the road;
- the ground height at the origin, sampled like the gym's; the footprint is
  levelled by sinking the base slab (like the gym's `drop`).

The footprint (building plus 1 m margin) is reserved in the occupancy grid, so
trees, hedges and the Living tier's props stay out. The site is the same in
every biome and tier.

### Shape

Local frame as in the studio today: riders face −Z, up is +Y, seat 0 front
left. The room keeps `ROOM` (half width 7.5 m, front −9.5, back 6.5, height
4.6 m) and the seat layout, so `seatPosition` is unchanged.

- Width about 17 m, depth about 18 m; floor-to-floor height 4.6 m plus a
  0.3 m concrete slab.
- Front (−Z, towards the road): glass, mullions every 2 m, a slab edge per
  floor. Sides and back: solid white render.
- Roof: flat, a parapet, a lit sign "Spin Studio" facing the road.
- Base: a step and an entrance door at the side, for looks only.

### Floors as a layer

The floor count changes while the world is on screen, so the building is not
baked into the worker's chunks. Like the statues it is its own layer on the
main thread: `buildStudioBuilding()` returns a base mesh, one floor module
and the roof; the layer draws the base once, the floor module `floors` times
at `y = n × floorHeight`, and the roof on top. `setFloors(n)` (n ≥ 2) moves
the roof; no remesh.

A floor whose room is closed is dark: its interior unlit and its glass a
darker tint. A floor whose room is open shows its interior and its riders.

### Interior (`view3d/studioRoom.js`)

Pure geometry, replacing the dark room of `studioScene.js`:

- light oak floor, white walls, pale ceiling with long light panels;
- the stage at the front behind the glass, its edge in lemon; a lemon/orange
  stripe along the back wall; bike frames in the accents;
- props along the side walls: dumbbell racks, kettlebells, rolled mats, a few
  plants, a water station, towels on a bench, a wall screen (the room board
  is the HUD's; the screen is decoration);
- lit by the world's sun and sky (the world's lighting), so a morning class
  differs from an evening one.

Props stay outside the aisles and the camera paths of all four modes.

## Menu

- The `studio` card's world is the valley map (the first route offered whose
  map has the `valley-cafe` node). Picking the card builds that world if
  another is on screen, as a workout card does for its venue.
- New `showStudio(building)` and pure `studioPose(building, overview, angle)`:
  an orbit at about 40 m around the building, slow, keeping the café and gym
  in frame behind it; above the ground like `gymPose`. Flights blend as today;
  with reduced motion the camera cuts.
- The building shows `info.studio.rooms` floors (at least 2), without riders.
- No valley map: `showIsland()` as today.

## Riding inside

### One view

A studio ride builds the valley world in `View3D` and adds the studio layer.
The room interior of your floor is drawn with its riders; the other floors
with theirs (from the mirror below), so the building looks the same from
inside as from the road. The `studio3d` canvas and its label layer go;
`StudioView3D` becomes the studio layer's rider and camera logic on top of
the world view.

Riders:

- **Your room** from `studio_state.riders` (seat, power, cadence, the coach's
  tempo), as today.
- **Other floors** from `studio_state.road_riders` entries that carry
  `studio` (the server sends the other rooms' seats there too, see below).
- **The road** from `studio_state.road_riders` without `studio`, drawn like
  riders on a route.

Seat to world: `seatWorld(building, room, seat)` = building transform ×
floor offset × `seatPosition(seat)`; pure.

### Cameras

`STUDIO_CAMERAS` becomes `["seat", "pov", "wide", "coach"]`; `studioCamera`
returns eye and target in the room's frame as today, and the view applies the
floor transform.

- `pov`: the eye at the rider's head on the saddle (from `RIDER_GEOMETRY`),
  looking forward over the bar towards the coach and the glass; a vertical bob
  of a few centimetres at the rider's cadence; no bob with reduced motion. My
  own body is not drawn in this mode (the camera would be inside it); the bar
  and front wheel are.
- Labels in en and de (`studio.camera.pov`: "My view" / "Meine Sicht").
- The saved choice (`openradlr.studio-camera`) keeps working; an unknown saved
  value falls back to `seat`.

### Fallback

If the server has no valley map or the world cannot be built, the studio
layer is drawn on its own (no terrain), the glass as a flat sky colour, so a
class always works.

## Server and protocol

### Rooms close from the top (`sim/studio.rs`)

`Studio`'s room upkeep removes empty extra rooms only from the end: while the
last room has no humans and is not room 0, remove it. An empty room in the
middle keeps its bots until every room above it has emptied too. Room indices
are therefore stable for every seated rider.

### Studio seats on the road

- Every studio state tick (about 4 Hz) the studio core builds a seat snapshot:
  per seated rider `id`, `name`, `is_bot`, `power`, `cadence`, `room`, `seat`.
- It hands the snapshot to the valley map's game core through a new event on
  the game handle, alongside the existing OpenBikeNet `remote` path. The
  valley game is the one whose map has the `valley-cafe` node; without one no
  snapshot is sent.
- The game core keeps the latest snapshot and appends its riders to every
  client's `riders[]`, culled like other riders by distance from the building
  position (the café node's position). Each carries
  `studio: { room, seat }`, `power`, `cadence`, `is_bot`, and no route
  position; they have no physics, drafting, races or events, and are not
  counted in `players` (the studio counts them).
- Rider ids: the studio and each route world count ids from 1, so they
  would clash. The studio's ids start at `0xE000_0000` instead (below the
  OpenBikeNet range at `0xF000_0000`); ids are opaque to clients, so this is
  not a protocol change.

### The road in the studio

- The game core hands the studio core, at the same rate, the riders of the
  valley world near the building (its usual culling with the building as the
  viewpoint) plus the studio's own seats of every room.
- The studio core adds them to each `studio_state` as `road_riders[]`: road
  riders in the `riders[]` format of route state; studio seats of other rooms
  with `studio`. The rider's own room is not repeated there.

### Size of the building

`studio_state` and `/api/info`'s `studio` gain `rooms` (≥ 1, the number of
open rooms). Clients draw `max(2, rooms)` floors.

### Compatibility

All additions are optional fields or entries; protocol version stays 2.
An older road client does not know `studio` and would draw a studio rider at
route position 0, so the game core sends studio riders only to clients that
announce the capability in `join` with the new optional
`features: ["studio_riders"]` (unknown entries are ignored, so later
capabilities can reuse the field); older clients see the road as today.
`docs/protocol.md` documents `rooms`, `riders[].studio`, `road_riders` and
`features`.

## Testing

Written first; one reason to fail per test; no sleeps.

Client (plain node):

- `studioSite`: opposite the café, front towards the road, set back 8 m,
  `null` without a `valley-cafe` node; footprint reserved in the occupancy
  grid.
- Studio building layer: at least 2 floors, `setFloors` moves the roof,
  closed floors dark.
- `studioRoom`: floor, walls and props inside the room; props clear of the
  aisles and of all four camera eyes.
- `seatWorld` across floors and yaw; `studioCamera("pov")` at head height
  facing −Z; bob amplitude and none with reduced motion.
- Menu: `studioPose` around the building, above the ground; the studio card
  picks the valley world; island orbit without a valley map.
- Rider sources: own room from `riders`, other floors and road from
  `road_riders`.

Server (`cargo test --workspace`):

- `sim/studio.rs`: a middle room that empties stays open; the top room
  closes; rooms never drop below one; indices stable.
- Game core: a studio snapshot appears in `riders[]` with `studio`, only for
  clients with the feature, culled by distance, not counted in `players`.
- Studio core: `road_riders` holds road riders near the building and other
  rooms' seats, not the own room; `rooms` in `studio_state` and `/api/info`.
- End to end (`tests/`): a road client near the café sees a studio rider; a
  studio client sees a road rider passing the building.

`make check` passes. Playwright screenshots (1×, cache dir): the menu shot of
the building, the POV through the glass, the road view of a 3-floor building.

## Docs

- ADR 0025 "Spin studio as a building in the valley": floors as rooms,
  top-only closing, the two-way mirror, the feature flag.
- ADR 0011: note that the room now lives in the valley world.
- `docs/protocol.md`, `docs/architecture.md` (the mirror between cores).
- `CHANGELOG.md` under `[Unreleased]`; en and de strings.

## Delivery

Branch `feat/studio-building` from `main`, one PR with ordered commits:

1. Top-only room closing (sim).
2. Building site, shape and floor layer; menu shot.
3. Light interior and props.
4. Riding inside the world view; POV camera.
5. Server mirror: studio seats on the road, road riders in the studio,
   `rooms`, `features`.
6. Client: draw mirrored riders on the road and in the studio.
7. Docs.
