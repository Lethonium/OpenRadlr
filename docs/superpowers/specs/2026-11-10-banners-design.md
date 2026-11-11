# Banners along the route — design

Date: 2026-11-10 · Status: agreed in discussion

## Goal

Words over the road that tell riders where they are and what they've done:
names on the arches, banners counting down a climb's last kilometre and
marking halfway round a loop, and a banner on the screen for a personal
milestone.

## Decisions

| Question | Decision |
| --- | --- |
| Text in 3D | A 5 × 7 pixel font made of small squares (the renderer has no textures), on both faces so it reads right from either way |
| Arch names | Start/finish "OPENRADLR", climb "KOM", sprint "SPRINT" |
| Road banners | "1 KM ^" and "500 M ^" (^ is a mountain) before a climb's top when at least 150 m of climb lies below; "1/2" halfway round loops of 3 km or more (lemon yellow); none within 60 m of an arch. On two thin posts, the cloth from 4.1 m up |
| Language | The world's words are the same in every language (numbers, metres, "KOM", the brand): the world is one world for everyone and is built in a worker without the locale |
| Milestones | All-time distance at 100, 250, 500, 1,000, 2,500, 5,000 and 10,000, then every 10,000, in the rider's unit (km or mi); every Everest (8,849 m) climbed in all; the first time over the top of each climb |
| Totals | The kept rides (ride history) plus this ride; until the history has loaded only summits count. Tops reached are kept in the browser (`openradlr.summits`) |
| How shown | A lemon-yellow banner across the top for 5 s, nothing in the ticker; several at once share one banner. Rare by design |
| Where not | Studio and workouts |

## Client

- `view3d/pixelFont.js`: `GLYPHS`, `textWidth`, `pixelText`.
- `view3d/banners.js`: `ARCH_TEXT`, `BANNERS`, `bannerSpots(route)`,
  `buildBanners`, `letterArch`; `buildArches` letters its arches and adds the banners.
- `ride/milestones.js` (pure): `lifetimeTotals`, `distanceSteps`, `MilestoneWatch`.
- `main.js`: the watch per road ride, the banner.

## Out of scope

- A "last lap" banner in races, names of climbs, banners on network roads that aren't the ridden route.
