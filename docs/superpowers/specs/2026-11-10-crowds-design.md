# Crowds along the route — design

Date: 2026-11-10 · Status: agreed in discussion

## Goal

The roadside should feel like a race: people lining the last stretch of a
climb and cheering you on, more of them when more riders are out. So far
there were two fixed crowds behind barriers (the finish and the top of each
climb), jumping in place whoever came by.

## Decisions

| Question | Decision |
| --- | --- |
| Where | As before at the finish and the top of each climb (behind barriers), now also at every sprint line; and loose groups of 1–4 lining the last 600 m of every climb, thicker towards the top |
| Keeping clear | Lining spectators stand behind the verge, off every road, out of buildings, yards and rivers |
| Crowd size | The finish, summit and sprint crowds are always out. Each lining group has a rank (lower near the top); it is out when the share for the human riders on the server is above it: 35 % alone, +15 % per further human rider, all of it from six. Bots don't count |
| Cheering | A spectator within 28 m of a rider turns towards it (at most 63° off facing the road) and gets excited: arms up, faster and higher jumps; penguins clap faster |
| Flags | About 18 % wave a flag in one of six colours, swinging about its pole; each season says where it is held (a penguin holds it in a flipper) |
| Same world for everyone | Placement is seeded as before; the existing crowds keep their exact places and looks (the new placement draws from its own random stream) |

## Client

- `view3d/crowd.js` (pure): `crowdShare(humans)` and `cheer(person, riders, t)`
  (yaw, lift, pose, excitement), which also replaces the inline jump/clap code.
- `buildSpectators` (`features.js`): sprint crowds, the climb lining, `rank`,
  `flag`; a `blocked` callback from `buildWorld`.
- `buildFlag` (`structures.js`), `people.flagHand` per season.
- `View3D.render`: filters by rank, poses with `cheer`, draws flags (and their shadows).

A fix on the way: `roadFrame` had no direction past the ends of a route that
isn't a loop, which put Lanzarote's start crowd in the middle of the road.

## Out of scope

- Names painted on the road, spectators running alongside, sound.
