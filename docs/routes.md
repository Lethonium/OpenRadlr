# Routes

A route is a JSON file in `routes/`. Riders pick one on the start screen.
Routes on one map share one world on the server (#14): riders of different
routes see each other and draft where they share a road; a route without a
map is a world of its own. `OPENRADLR_ROUTE` names the default, listed first. Files are
served unchanged at `/api/route?id=…`, so every client sees exactly the same
route. A broken file is skipped with a warning in the log.

Bundled: *Riverside Flats* (8.6 km, flat, two sprints) from the Valley Café,
*Rolling Hills* (7.8 km, 130 m up) from the Hilltop Café, *Col de la
Forge* (12.9 km, 300 m up, the last 2.5 km to the col at about 6 %) from the
Valley Café, *Balcony Road* (12.1 km, 220 m up, along the high road under the
ridge) from the Valley Café, *Forge Circuit* (9.5 km, 220 m up, down from the
col and back up) from the Forge Hut, *Island Tour* (35.1 km, 530 m up,
the valley, the south coast, the col from the west and the high road) from the
Valley Café, and *Cape Loop* (20.8 km, 150 m up, along the beaches and over a
low cliff on the south-eastern cape) from the Beach Café,
all on one road network (see below). *Lanzarote Lava 180* (179.6 km,
about 2,540 m up, climbs Femés, Timanfaya, Tabayesco and Mirador del Río) is a
world of its own and is not confirmed against the official course yet (see
[Lanzarote Lava 180](#lanzarote-lava-180)).

```json
{
  "id": "rolling-hills",
  "name": "Rolling Hills",
  "description": "A gentle loop with one short climb, a river crossing and a village sprint.",
  "loop": true,
  "lanes": 4,
  "seed": 1337,
  "map": { "id": "valley", "seed": 2026 },
  "points": [[0, 0, 40], [50, 0, 40]],
  "markers": [
    { "type": "start_finish", "distance": 0 },
    { "type": "climb", "distance": 1448, "length": 966 },
    { "type": "sprint", "distance": 4104, "length": 300 }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `description` | Optional one-liner for the route picker. |
| `points` | `[x, y, elevation]` in metres. At least two points. |
| `loop` | Routes are ridden as loops; a closing segment to the first point is added if needed. |
| `lanes` | Number of lanes (1 or more). |
| `seed` | Seed for client-side decoration (trees, villages, farms) so every client draws the same world. |
| `map` | Optional: `{ "id", "seed" }` of the shared map the route belongs to (see below). |
| `markers` | `start_finish`, `climb` and `sprint` (with `length`) for display; an optional `name` is shown in the banner (*KOM · Femés*). |
| `geo` | Optional: `{ "lat", "lon" }` of the route's (0, 0) for exported rides. Without it, the world origin below. |
| `zones` | Optional scenery: `village`, `forest` and `cliff` (with `from`/`to`; a cliff gets a guard rail on the sea side), `river` (with `at`, where it crosses under a bridge). |

Zones are pure decoration: the server passes them through, clients build the
world from them. Unknown zone types are ignored, so new ones can be added
without breaking older clients. Without zones, a village, a river crossing and
a forest are placed automatically on flat, free stretches (away from the start,
climbs and sprints), derived from the seed.

```json
"zones": [
  { "type": "river", "at": 720 },
  { "type": "forest", "from": 1500, "to": 2350 },
  { "type": "village", "from": 3480, "to": 3960 }
]
```

Distances along the route are horizontal; the grade is rise over
horizontal run, measured over 50 m of road around the rider (so it eases from
one segment to the next instead of stepping at each point). Keep grades realistic (below about 12 %).

Every route starts at a bike café beside the road, 45 m after the start/finish
line (on a road network: at its start café).

## Converting a GPX

`tools/gpx-route.mjs` turns a GPX track into a route file (step 1 of #16; the
conversion itself is `client/public/js/route/gpxImport.js`, plain functions
that also run in a browser):

```
node tools/gpx-route.mjs track.gpx --id my-route --name "My Route" \
  [--description text] [--geo lat,lon] [--seed n] [--markers markers.json] \
  [--sigma metres] [--target-length m] [--target-climb m] [--out routes/my-route.json]
```

It projects the track to metres around its start, resamples it to 10 m,
smooths the elevation (`--sigma`, a Gaussian over distance, default 60 m),
flattens any stretch steeper than 11.5 % over 50 m, finds the sustained climbs
and simplifies the points. The track must end within 200 m of its start
(routes are loops). `--markers` is a JSON array of `{ "type": "climb" |
"sprint", "name", "lat", "lon" | "distance", "length" }` that names climbs and
adds sprints. The report on stderr shows length, climbing, the steepest grade
and every climb, with the deviation from `--target-length` / `--target-climb`;
nothing is scaled to hit a target. A route without `map` gets its own
generated island in 3D.

## Lanzarote Lava 180

`routes/lanzarote-lava-180.json` is a 180 km loop around Lanzarote in the spirit of the island's long-distance triathlon bike leg, built from open
data: `node tools/lanzarote.mjs` routes about twenty waypoints over
OpenStreetMap roads (the public OSRM router) and samples the Copernicus
GLO-30 elevation into `routes/sources/lanzarote-lava-180.gpx`; the command in
the tool's header converts that to the route (`--sigma 200`). Result: 179.6 km
and 2,544 m of climbing, steepest 11.6 %.

**The course order is unconfirmed**: it follows the commonly published
order (Puerto del Carmen, Tías, Yaiza, Playa Blanca, Femés, Yaiza, Timanfaya,
Tinajo, Teguise, Guatiza, Tabayesco, Mirador del Río, Haría, Los Valles,
Teguise, San Bartolomé, back), not the official map. To fix it, edit the
`WAYPOINTS` list at the top of `tools/lanzarote.mjs` (one line each; add a pin
wherever the router takes another road), rerun and convert again. The 3D
island is generated around the route, not the real Lanzarote (real terrain
from the elevation data is a follow-up). A route this long (over 60 km) gets
thinner trees, ground detail and road markings in 3D, so the world builds in
about 9 s: `node --expose-gc tools/scene-bench.mjs routes/lanzarote-lava-180.json`
measures it.

Road geometry © OpenStreetMap contributors, ODbL. Elevation: Copernicus DEM
GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018,
provided under COPERNICUS by the European Union and ESA.

## One map, several routes

Routes whose files name the same `map.id` are drawn as one world
([ADR 0010](adr/0010-one-connected-world.md), stage 1): the client fetches the
other routes on the map and draws every road, one terrain from `map.seed`, and
the zones (villages, rivers, forests) of every route. Markers, arches and
spectators belong to the route being ridden. On the server the routes of a
map ride one world; riders of other routes show where they are in view.

For this to look right, routes on one map must agree where they meet:

- **Shared stretches use identical points** (same coordinates, same
  elevation), so the road is drawn once.
- Where a road branches off, both roads have the same height.
- Roads that don't meet stay a few hundred metres apart, so terrain can slope
  between them.

## Road networks

A map can have a road network (ADR 0010, #26): `routes/maps/<map id>.json`,
served unchanged at `/api/map?id=…`. Clients that find one build the map
from it: the island and its terrain, every road once, a café at every café,
and the scenery along the roads. Without one, the map is drawn from its
route files as above.

Shortened from the bundled map:

```json
{
  "id": "valley",
  "name": "Valley Island",
  "seed": 2026,
  "version": 1,
  "coast": { "center": [150, 250], "radius": [3930, 3972, 3977] },
  "terrain": { "x0": -6200, "y0": -4760, "cell": 40, "columns": 301, "rows": 246, "scale": 0.1, "heights": "base64…" },
  "nodes": [
    { "id": "valley-cafe", "kind": "cafe", "name": "Valley Café", "x": 0, "y": 0, "elevation": 36.3 },
    { "id": "south-east", "kind": "junction", "x": 1250, "y": -1700, "elevation": 42.4 }
  ],
  "edges": [
    {
      "id": "lower-valley", "from": "south-east", "to": "west-fork", "type": "main", "length": 4601,
      "points": [[1250, -1700, 42.4], [1233.8, -1707.9, 42.3]],
      "markers": [{ "type": "sprint", "dir": 1, "distance": 1310, "length": 320 }],
      "zones": [{ "type": "river", "at": 1346 }, { "type": "village", "from": 1426, "to": 1978 }]
    }
  ],
  "routes": [
    { "id": "riverside-flats", "name": "Riverside Flats", "seed": 4242,
      "walk": [["valley-east", 1], ["river-east", 1], ["lower-valley", 1], ["valley-west", 1]] }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `coast` | The island's centre and its outermost coast per direction (256 bins counter-clockwise from east), for the island's box and the far islands. |
| `terrain` | The landscape: heights on a grid (metres east `x0 + column · cell`, north `y0 + row · cell`), little-endian 16-bit integers × `scale` metres, base64. Below 0 is sea. Clients add a little seeded detail and flatten it under the roads. |
| `nodes` | Places: `cafe` (a bike café, where routes start), `junction` or `end`, with position and elevation. |
| `edges` | Roads between two nodes. `points` start and end exactly on their nodes, at their nodes' elevation. `type` is reserved for road variety (#27); today every road has four lanes. Roads are two-way. |
| `markers` | Climbs and sprints of a road in one direction: `dir` 1 from `from` to `to`, −1 back; `distance` from where a rider enters the road. |
| `zones` | Villages, forests and cliffs (`from`/`to`) and river crossings (`at`) along a road, in metres from `from`. A road has exactly its zones (no seeded defaults). |
| `routes` | Each route as a walk: `[edge, direction]` from its start café back to it. |

Every route also has its classic file in `routes/`, derived from the walk:
the roads' points one after the other (rounded on a short curve where it
turns from one road onto the next), and the markers and zones of the roads it
rides, in route distance. Its `walk` lists the roads in route distance, so the
server knows which road a rider is on (#14):

```json
"walk": [{ "edge": "valley-east", "dir": 1, "from": 0, "to": 970.8, "length": 979 },
         { "edge": "river-east", "dir": 1, "from": 970.8, "to": 2903.3, "length": 1941 }]
```

The steps follow each other from 0 to the route's length; `length` is the
road's own length (the route's stretch is a little shorter where it rounds a
corner). Routes on one map share a road where their walks name the same
`edge`. Both kinds of file come from the generator.

### The bundled map

`tools/valley-map.mjs` builds the bundled map terrain first, from its seed:

1. **Landscape:** an island with seeded bays and capes, cliffs under the
   mountains in the north and beaches in the south, a ridge with its lowest
   pass (the col), a river valley from below the col down to the south coast,
   and rolling hills.
2. **Places:** three cafés (the Valley Café near the GPS origin, the Forge
   Hut on the col, the Hilltop Café in the eastern hills) and six junctions.
   Where a main way runs through a place (`through`), its two roads leave it
   in a straight line, so routes ride straight over their start line.
3. **Roads:** the cheapest path between two places on a 20 m grid: steep
   grades, turning, the shore and running alongside other roads all cost
   extra. The path is smoothed into bends, gets a little seeded meander, and
   its profile follows the land, smoothed and kept below about 9 %. Roads
   leave a place straight along its main way (`through`) or in a set
   direction (`leaves`), so a route turning there rides a curve, not a
   hairpin. A road with `shore` may come that near the sea (the coastal
   roads, about 100 m from the beach), and `CLIFFS` are hand-placed spots
   where the coast is a cliff (the south-eastern cape).
4. **Routes:** walks over the roads; climbs are found from the profiles,
   sprints sit on the flattest stretch near where the road asks for them.

After changing the map run `make routes` (or `node tools/valley-map.mjs`); it
rewrites the network and the route files and prints each road and route
(length, climbing, steepest grade, markers), the closest two roads come and
the closest a road comes to the coast. `--png map.png` also draws the map.

## On the map

Exported rides (`.tcx`, `.gpx`, `.fit`, Strava) carry GPS positions: route
coordinates are metres east (`x`) and north (`y`) of **39.0° N, 2.6° E**, open
sea about 35 km south of Mallorca (`client/public/js/route/geo.js`). The café
on the bundled map sits right at the origin. There are
no real roads there, so rides never match real-world Strava segments, and the
area stays on water for maps up to about 40 km across. Never move the origin:
older rides would no longer line up with new ones.

A route can have its own origin with `geo`; its rides export there instead.
Lanzarote Lava 180 sits at 38.0° N, 2.6° E, open sea between the Balearics and
Algeria, about 110 km south of the world origin, so its 50 km wide island stays
clear of every coast.

In 3D the map is an island in that sea: route elevations are metres above sea
level. With a road network, the island is the network's landscape; without
one, the coast keeps a few hundred metres of land beyond the outermost road,
so new routes on the map simply make the island grow.
