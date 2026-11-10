# Golden lemons — design

Date: 2026-11-10 · Status: agreed in discussion

## Goal

A small easter egg that gives lane changes a purpose on a long flat: a few
golden lemons float over the road, each in one lane. Ride through one in its
lane and it is yours. It fits the name (a *Radler* is half lemonade) and the
lemon on the logo.

## Decisions

| Question | Decision |
| --- | --- |
| Who places the lemons | The client, from the route's seed and the UTC day. Every rider sees the same lemons with no server or protocol change |
| How many | About one per 1.5 km of route, at least 3, at most 24; none within 150 m of the start/finish line |
| Where | One in each equal stretch of the route, at a random point in it, on a whole lane |
| When they move | Every day at midnight UTC |
| Catching one | Passing its distance while within 0.55 lanes of its lane, so halfway through a lane change still counts |
| Laps | They grow back each time the rider crosses the line |
| Jumps | A move of more than 60 m between two frames (rejoin, junction, teleport) collects nothing |
| How present | An easter egg: no counter on the HUD. A pickup adds a line to the ticker ("🍋 Golden lemon! 2 this ride · 17 in all"), and the finish screen lists them when there were any |
| Count kept | The all-time count in the browser (`openradlr.lemons`); nothing on the server |
| Where not | Studio, workouts, off the routes (on a network road) |

## Client

- `ride/lemons.js` (pure): `lemonDay(ms)`, `lemonsFor(route, day)` and
  `LemonHunt` (`update({routeId, distance, lane})` returns the lemons this move
  collected; `collected`, `total`, `lemons` with a `collected` flag).
- `view3d/lemonModel.js`: the lemon mesh (about 1 m long, nubs and a leaf).
- `View3D.setLemons(lemons)`: draws the lemons not yet collected from 30 m
  behind to 260 m ahead of my rider, bright, spinning and bobbing at
  handlebar height; near ones cast a shadow.
- `drawPeloton(…, {lemons})`: the 2D view shows them as yellow dots in their
  lane (`lemonsInWindow`).
- `main.js`: a hunt per ridden route (new on a route switch, none off the
  routes), updated every frame while riding; ticker line on a pickup; finish
  screen row.

## Out of scope

- Unlocks for lemons (lemon-slice wheels) and showing other riders' counts.
- Lemons in the studio or workouts.
