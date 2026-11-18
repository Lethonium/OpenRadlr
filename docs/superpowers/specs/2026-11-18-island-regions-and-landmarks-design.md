# Island regions and landmarks — design

Date: 2026-11-18 · Status: approved 2026-11-18 · Issue: #117 (follow-up to PR #119)

## Intent

The rider and owner compared our island with Cykelapp (screenshots: a Swedish
archipelago boardwalk at sunset, pyramids in a desert, cherry blossom under a
Fuji-like peak, a coast road lined with lupins and picket fences) and found ours
flat and samey: woods, fields and villages in muted greens under a grey haze.

What they want: **more variety**, so a ride passes through places that each
look different and that you remember. They chose a **believable Mediterranean
island with a few playful landmarks** — not themed fantasy worlds — and asked
for visuals first, before the remaining performance work. They handed the
choice of landmarks and the detailed look to the builder ("you decide").

Why Cykelapp reads better (what this design copies, as technique only):

1. light and air — low warm sun, sky gradient, haze in the sky's colour, long
   shadows, saturated colour;
2. one landmark visible from far away per area;
3. big **masses of one colour** (a slope of blossom, a verge of lupins) instead
   of speckle;
4. roadside detail at the distance the camera looks (fences, mailbox,
   boardwalk, cart);
5. every area has its own character you recognise at a glance.

`docs/superpowers/specs/2026-11-17-cykelapp-feel-reference.md` records how
Cykelapp does this (zone style tables, verge bands, reserved aprons,
near-only ground cover). This design applies those ideas to our island.

## Goals

- Light that looks warm and alive in every time preset, with golden hour as
  the showcase.
- An island of distinct **regions**, each with its own ground colours, tree
  mix, roadside props and one colour mass.
- Seven **landmarks**, each anchoring a region and visible from afar.
- Same world on every route and every client (seeded, map data).

## Non-goals

- Performance work beyond staying inside today's budget (see Constraints).
  The renderer follow-ups from PR #119 come after this.
- People and animals moving about (Cykelapp's "summer life" layer). Later.
- New biomes or seasons. Winter must keep working, nothing more.
- Changing roads, heights, routes or anything the server simulates.

## Anti-goals (a failure even if it works)

- A theme park: pyramids, torii, anything that breaks "one Mediterranean
  island". Landmarks are a wink, at most seven.
- Speckle: regions made of noise so fine that they read as random dots again.
- Visible circles: region edges that look like compass-drawn discs.
- A slower or crashing phone: no region may add more than the current densest
  scene (the dense wood) costs.
- Scenery **off** changing its geometry: its objects stay exactly as today
  (it does get the new light, by the owner's decision below).

## Constraints

- CC0 assets only, `make scenery-check` stays the gate; Kenney and the two
  Quaternius CC0 packs are in; another pack goes through the same rule
  (its own page or licence file says CC0, never the Quaternius Asset License).
  Cykelapp is MIT and is a technique reference only — no geometry lifted.
- World origin stays put (39.0 N 2.6 E). The island's shape, roads and heights
  do not change.
- Visual-only client data. The server reads `routes/maps/valley.json` for the
  road network but ignores keys it does not know (as with `settlements`), and
  nothing on the server mirrors `land.js` (its header comment says it could;
  today it does not). Regions live in a new client-only module and leave
  `land.js`'s answers (forest/field/kind/treeFactor) unchanged, so the farms,
  villages and canopy that already use them do not move.
- Biomes: temperate is the target; winter must render sensibly (blossom bare,
  lavender under snow) via per-biome overrides, not a second layout.
- Budget (call made in review): first run `client/sceneryBench.mjs` on this
  branch at the dense wood (about 6,490 m on rolling-hills) to get the
  baseline, record it in the PR, then no region scene may exceed it in
  **visible vertices** or **draw calls** at the same camera. Headless numbers
  are for comparison only; real-hardware checks stay with the owner.
- Server: confirmed in review that `server/crates/server/src/map_file.rs`
  deserialises the map without `deny_unknown_fields`, so new keys are
  ignored; a server test that loads the map with the new keys proves it.
- One feature, ordered commits, TDD, plain node tests; ADR for the region layer.

## Approaches

- **A. Region map layer (chosen by the owner).** Regions and landmarks are
  hand-placed in `routes/maps/valley.json` next to the settlements; each region
  kind is a style table (colours, plants, verge props, colour mass), blended at
  the edges with noise. Builds on the settlement layer (ADR 0029); landmarks
  stand exactly where they look best; same world on every route.
- B. More noise kinds in `land.js` (olive, lavender, blossom). Cheap and
  automatic, but landmarks cannot be placed on purpose and regions dissolve
  into speckle — the thing we are fixing. Rejected.
- C. Hand-dressed decoration per route. Most control per ride, but the shared
  world falls apart and each route costs new work. Rejected.

The light step is independent and comes first in any approach.

## Design

### Step 1 — Light and air

Today: `view3d/lighting.js` has `day`, `golden`, `dusk` presets (auto by
local clock); `renderer.js` draws a sky gradient with sun glow, distance and
height fog in the horizon colour, and a gentle tone map.

Change (tuning plus small shader additions, no new pass):

- Retune all three presets warmer and more saturated: lavender-blue zenith,
  warm horizon, warmer bounce light; golden hour lower and longer-shadowed.
- **Aerial perspective toward the sun:** the fog colour leans to the sun
  colour in the sun's direction (one `dot` in the fragment shader), so
  backlit distance glows instead of greying.
- A slightly larger, softer sun disk and a wider glow at golden hour.
- A saturation term in the tone map (around 1.1), so flat vertex colours do
  not wash out.
- Water: a sun glint (specular streak on the water toward the sun) if the
  water is drawn by the opaque program; skip if it needs its own pass.
- Ground palette: retune `temperate.js` greens to warmer, Mediterranean values
  (dry grass gold, olive-silver, terracotta soil), keeping the land kinds.

Acceptance: before/after screenshots of the same four views (forest, city,
coast, high country) at day and golden hour; the owner judges.

### Step 2 — Region layer

New map section in `routes/maps/valley.json`:

```json
"regions": [
  { "id": "south-coast", "kind": "pineCoast", "x": 0, "y": -3900, "radius": 1600 },
  { "id": "almond-valley", "kind": "blossomValley", "x": 400, "y": -800, "radius": 900 }
]
```

Builder's call: circles or simple polygons. Whatever the shape, `regionAt(x, z)`
returns `{kind, weight}` and perturbs the boundary with low-frequency noise
(~300 m) so edges wander and blend over ~150 m. Outside every region, the
current land (woods/fields/open) applies unchanged.

A **region kind** is a style table, data only, per biome with a temperate
default:

```js
{
  ground: { open: [r,g,b], field: [...], forest: [...] }, // overrides by land kind
  trees: { roles: ["umbrellaPine", "leafy"], density: 0.6 }, // multiplies treeFactor
  mass: { kind: "lavender", colour: [...], cover: 0.5, scale: 120 }, // the colour mass
  verge: { cover: [...], props: [...], every: 40 },        // roadside detail
  reserve: [],                                             // filled by landmarks
}
```

Region kinds. Positions follow the composition map drawn for PR #119:
`https://raw.githubusercontent.com/Lethonium/OpenRadlr/pr-screenshots/scenery/quaternius/valley-proposal.png`
(regenerate with `client/worldMap.mjs`). The numbers in brackets are that
map's region numbers: 1 east market city, 2 southwest village, 3 southeast
harbour, 4 north deep wood, 5 west farm belt, 6 south wetland, 7 meadow
verges, 8 high country. Regions cover the whole island and are built once
with the world, like the settlements, whether a route passes them or not.
The builder places them on the real island:

| Kind | Where | Look | Colour mass | Roadside |
| --- | --- | --- | --- | --- |
| `pineCoast` | south and east coast | umbrella pines, granite/limestone, sea close | none (sea is the mass) | dry-stone wall, white posts, boardwalk where the road runs by water |
| `oliveTerraces` | slopes below the high country | olive trees in rows on terraces, dry gold grass | silver-green rows | dry-stone walls, a cart, a shrine niche |
| `blossomValley` | river valley, centre | almond trees in pink/white bloom | pink-white canopy masses | picket fences, mailboxes, beehives |
| `lavenderFields` | meadow region (7) | open fields in bands | purple strips following contours | wooden fence, bench, a small barn |
| `farmBelt` | west (5) | existing fields and farms | sunflower or wheat-gold fields | hay bales, windmills (landmark) |
| `deepWood` | north (4) | existing dense wood, darker floor | none | log piles |
| `wetland` | south (6) | reeds, willows, a pond by the road | reed-gold and water | boardwalk, birds-on-posts |
| `highCountry` | north (8) | existing rock, snow, treeline | alpine flowers below the snow | cairns, snow poles |

Colour masses are the most important part: they are drawn as **ground colour
plus near-only low cover**, not as thousands of models. The ground colour
alone carries the mass at distance (a purple band reads from 2 km); near the
road (≤150 m) cheap low cover meshes give it texture. They follow Cykelapp's
near-only ground-cover idea: own group, ~64–100 m chunks, ≤150 m range, no
shadows, instanced.

**Verge bands** (Cykelapp idea 2), per region: 0–3 m from the asphalt clear;
3–7 m the region's cover; 7–16 m sparse; props at the region's spacing; on
the sea side, low only when water is within 18 m so the sea stays visible.

Assets: what the kits have is used first (Kenney nature, Quaternius nature and
farm, fantasy-town fence/cart/bench/lantern). What they lack — umbrella pine,
olive, almond in bloom, lavender clump, dry-stone wall, beehive, mailbox,
boardwalk, cairn — is built procedurally in the existing low-poly style (like
`structures.js`), or assembled/recoloured from kit parts (like
`tools/scenery/assemble.mjs`), or taken from another CC0 pack that passes the
gate. Builder's call per item; keep 2–5 silhouettes per category.

### Step 3 — Landmarks

New map section:

```json
"landmarks": [
  { "id": "cape-light", "kind": "lighthouse", "x": 4600, "y": -4300, "yaw": 0, "apron": 25 }
]
```

Each is built once, seeded, into `village`/`villageFar` (a far twin always;
visible to 2.6 km like the settlements), and **reserves its apron**: scatter
refuses to place anything inside it, so it stands clear (Cykelapp's `_keep`).

| Landmark | Region | Notes |
| --- | --- | --- |
| Lighthouse | SE cape above the harbour | white with red bands, lamp lit at dusk via the town-light `bright` group |
| Castle ruin on a crag | hill above the SW village | Kenney Castle Kit (CC0, check) or assembled; broken walls, one tower |
| Sea arch | south bay, offshore | procedural rock arch standing in the water |
| Stone viaduct | where a road crosses the river high above the ground | arches *under* the existing road deck; road heights do not change; if no crossing is high enough, drop it rather than move the road |
| Windmill plain | west farm belt | a row of 4–6 Mallorcan stone windmills, sails turning slowly |
| Cathedral | market city skyline | one oversized church that dominates the city; replaces the city's church |
| Hot-air balloons | over the valley | 3–5 balloons drifting slowly on fixed loops, visible from almost everywhere; the only moving landmark |

Moving parts (sails, balloons) use a per-frame transform from the clock, not
the seed; they are visual only and need not match between clients. (Call
made in review:) they may live in a small dynamic group outside the baked
chunks — about 10 draws, transforms updated per frame — drawn like the other
groups and culled by distance; a vertex-shader animation is equally fine if
simpler. The static parts (windmill towers, the balloons' absence) stay in
`village`/`villageFar`.

Fewer than seven landmarks is acceptable: the viaduct is dropped if no road
crosses the river high enough, and any other landmark that cannot stand
believably is dropped rather than forced. The **cathedral** changes only
which model the city's church slot uses (a larger assembled church from the
fantasy-town parts, or a new one); `layoutSettlement` and its seeded order
stay untouched, so the city layout does not move.

### Scenery off and winter

- Scenery off: regions and landmarks are skipped; its geometry is today's.
  The light retune applies to every scenery level including off (owner's
  decision, 2026-11-18): light is not scenery, and one set of presets stays.
- Winter (the only other biome today besides temperate): each region kind may
  override its style per biome. Required: blossom turns bare, lavender and
  flowers sit under snow. Every other region falls back to the winter biome's
  existing ground and tree rules. Balloons stay.

## Order of work

1. Light and air (screenshots to the owner before going on).
2. Region layer: data, `regionAt`, ground colour, tree mix — then colour
   masses, then verge bands. Screenshots per region.
3. Landmarks, one commit each, lighthouse first.
4. Bench numbers against the dense-wood budget; ADR for the region layer;
   PR description with before/after screenshots.

Delivered as its own draft PR stacked on `feat/scenery-kit` (builder's call
to retarget once #119 lands).

## Left to the builder

- Exact colours, densities, region positions and sizes, landmark spots.
- Circle vs polygon regions; the noise for the edges.
- Procedural vs assembled vs other-CC0 for each missing model.
- Chunk size and range for ground cover within the stated limits.
