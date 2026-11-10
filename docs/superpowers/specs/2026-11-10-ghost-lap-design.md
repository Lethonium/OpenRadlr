# Ghost lap — design

Date: 2026-11-10 · Status: agreed in discussion

## Goal

Solo riders get someone to chase: their own best lap on the route. A
see-through rider replays it from the line, and the HUD shows the live gap
("Best lap +4.2 s").

## Decisions

| Question | Decision |
| --- | --- |
| Whose lap | My own, from this browser. No server or protocol change; other riders don't see my ghost |
| What is a lap | From one crossing of the start/finish line to the next on the same loop route, as splits count laps. A ride that begins within 50 m past the line starts its first lap there |
| When a lap is dropped | Leaving the route, switching routes, a jump of more than 60 m or a step backwards between frames (rejoin, teleport) |
| Time | The ride clock, which stands still while paused, so a pause doesn't cost the lap |
| Crossing time | Interpolated within the frame that crosses the line |
| What is kept | The best lap per route: duration and a trace with a point about every second (time, route metres, lane), in IndexedDB (`openradlr-ghosts`). A faster lap replaces it at once and the ghost rides it from the next lap |
| Gap | My lap time now minus the time the best lap reached my position: + behind, − ahead; minutes from a minute on |
| Ghost's lane | The lane I rode then, so it replays lane changes too |
| Where not | Routes that aren't loops, off the routes, the studio and workouts. Hidden (gap too) while I'm in a race or event; laps still count |
| Look | Pale, see-through (alpha 0.38), no shadow, label "Best lap"; in 2D a see-through capsule with a dashed outline |

## Client

- `ride/ghostLap.js` (pure): `LapRun` (`update({routeId, routeM, lane, clockS})`
  returns `start` and `lap` events), `ghostAt(trace, s)`, `timeAt(trace, m)`,
  `formatLapGap(s)` and `GhostStore` (`best(routeId)`, `offer(lap)`; storage
  errors are logged once and swallowed, like the ride history).
- `View3D`: riders with `ghost: true` are drawn last, see-through, without
  shadows; their label gets the `ghost` class.
- `drawPeloton`: the ghost as a see-through capsule with a dashed outline.
- `main.js`: a lap run per ridden route, the ghost rider added to the riders
  drawn (never to the riders used for drafting), the gap pill, ticker lines for
  a first lap, a new best and a best lap waiting at the start.

## Out of scope

- A setting to turn the ghost off, other riders' ghosts, ghosts for segments
  (climbs, sprints) and comparing with a lap from the server.
