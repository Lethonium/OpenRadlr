# Coastal route — design

Date: 2026-10-19 · Issue: #28 · Status: agreed in discussion, awaiting spec review

## Goal

A long, mostly flat route along the south coast of Valley Island, so riders
see the sea from the road: a beach stretch and a low cliff stretch on the
south-east cape with a guard rail on the sea side.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Option 1 of the discussion: flat south coast with one low cliff on the south-east cape. The tall northern cliffs stay out (not flat) |
| Route | Cape Loop, from a new Beach Café near the river mouth, about 19–20 km |
| Laying the coastal roads | A per-edge shore distance plus hand-placed `via` points about 100 m inland, not a new "follow the coast" search |
| The cliff | Hand-placed cliff spots (like the `SHORE` capes and bays) push `cliffAt` to 1 on the cape |
| Guard rail | A new `cliff` zone on the edge; the client puts a rail on the sea side along it |
| Scenery | Nothing new: beaches are already sand without trees, cliff faces are steep and not sand. Boats and a lighthouse stay out |
| Island Tour | Rides the coast too: `south-coast` and `west-coast` in place of `lower-valley`, about 33 km |
| Other roads and routes | Unchanged |

## The terrain it rides on

Heights inland from the south coast (from the shipped map):

| Inland | 60 m | 100 m | 150 m | 250 m |
| --- | --- | --- | --- | --- |
| Height | ~2 m | 4–6 m | ~10 m | ~30 m |

The coast runs about 9 km from the western bays (about (−4000, −3180)) to the
south-east cape (about (4800, −4160)). A road about 100 m inland rides just
above the beach. The terrain blends to the road bed only within about 50 m of
the road, so the beach and the waterline seaward of it stay as they are.

## Route

Cape Loop, starting at Beach Café (east of the river mouth, about
(700, −3300)):

1. East along the beaches, about 4.5 km.
2. Over the south-east cape on the low cliff, about 1.5 km.
3. Inland and up to the `south-east` junction (42 m).
4. `lower-valley` to the `west-fork`.
5. Down to the west coast (about (−3000, −2900)), then east along the beaches
   back to the café, crossing the river near its mouth.

Island Tour changes too: after `river-east` it rides `south-coast` backwards
(the cape, the beaches, past Beach Café) and `west-coast` backwards up to the
`west-fork`, then on as before (`west-valley`, the col, the high road, back
down). Walk: `valley-east`, `river-east`, `south-coast` −1, `west-coast` −1,
`west-valley` −1, `forge-west` −1, `forge-east` −1, `high-road` 1,
`west-valley` 1, `valley-west` 1. It rides straight through Beach Café
(`through`), and turns onto `west-valley` at the west fork on a curve.

As built: the beaches (about 2 km east of the café and 3.5 km back along the west coast) ride at 3–15 m; the cape cliff top is at 35–39 m; the way back inland to the `south-east` junction rides 20–54 m (the highest point), so the route is 20.8 km with 150 m up, steepest 10 %.
The exact `via` points, café position and route seed are tuned while
building; the route file reports length, gain and steepest grade as usual.

## Generator (`tools/valley-map.mjs`)

- **Node:** `beach-cafe`, kind `cafe`, name "Beach Café", with `through` set
  to the two coastal edges so the route rides straight over its start line.
- **Edges:**
  - `south-coast`: `beach-cafe` → `south-east`, `via` points along the beach
    and over the cape, `shore: 70`, a `cliff` zone over the cape stretch.
  - `west-coast`: `west-fork` → `beach-cafe`, `via` points down to the coast
    and along the beach, `shore: 70`.
- **Per-edge shore:** `layRoad` takes the edge's `shore` in place of
  `SEARCH.shore` when set. The "below 2 m" penalty stays, so the road keeps
  out of the surf.
- **Cliffs:** a `CLIFFS` list of `[x, y, radius]` next to `SHORE`; `cliffAt`
  takes the maximum of the noise and these spots. One spot on the south-east
  cape. `coastHeight` then makes a cliff there of about 25–40 m (the natural
  land height), since cliffs rise over 45 m instead of 360 m.
- **Zones:** `cliff` joins `forest` and `village` as an edge zone type
  (`from`/`to` as fractions), carried into the network file and the classic
  route file like the others.
- **Route:** `cape-loop` in `ROUTES` with its own seed.
- **Checks (generator fails):** a coastal edge comes nearer the sea than its
  `shore`, or rides below 1.5 m.

## Client

- `features.js`: a `cliff` zone puts a guard rail on the sea side of the road
  along the zone (the side whose terrain falls away, or the side nearer the
  coast). Existing descent rails are unchanged.
- No changes to terrain, colour or tree placement.

## Server

The bundled-routes test lists `cape-loop` with the other valley routes.

## Docs

`docs/routes.md` (bundled routes, the per-edge `shore`, cliff spots and the
`cliff` zone), CHANGELOG under Unreleased.

## Testing

- Generator checks above.
- Client: Cape Loop has a stretch within 150 m of the sea; there is a guard
  rail along its cliff zone; the existing terrain-under-road and grade tests
  cover it through `ROUTE_IDS`.
- Server: bundled-routes test.
- 3D check with Playwright: the route in the menu, the start at Beach Café,
  the beach stretch and the cliff with its rail; screenshots shared on a page.

## Branch

`feat/coastal-route`, on top of `feat/more-routes` (PR #92), since both touch
the generator and the route lists. Merged after #92.
