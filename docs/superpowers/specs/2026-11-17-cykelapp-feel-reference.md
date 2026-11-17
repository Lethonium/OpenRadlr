# Cykelapp feel reference — how its archipelago reads as alive

Date: 2026-11-17 · Status: reference for the scenery kit (#117)
Source: `github.com/noslemaus/Cykelapp` @ `2026-11-16` (Godot 4.7, MIT). Read: `README.md`,
`LICENSE`, `game/world/skargarden/{skargarden,sommarliv}.gd`, `atmosphere.gd`, `effekter.gd`,
`vaxt.gdshader`, `game/world/{japan,egypten}/*.gd`, `assets/blender/skargarden_modeller.py`.
Everything is placed in code from a 12.4 km road spline resampled every 2 m — the most directly
copyable idea here.

## 1. Density — where the instances actually go

- Road is ~6,200 samples at `STEP = 2.0` m. Every non-bridge sample, both sides, gets a fixed
  budget: 2 ground-cover in 3.1–7 m, 2 "fine" items (stone/moss/berry) in 3–10 m, 60 % chance of
  one more in 7–16 m, a slab on every 2nd sample at 85 % × zone weight, a tree on every 4th sample
  × `tree_p`. ≈ 4.7 items per sample-side → **~58,000 verge instances**.
- A second pass throws **34,000 random points** over the island, skips < 9 m from the road and
  y < −2.5, and sorts each by noise into tree / slab / boulder / thicket / cover. Total: 60–70k.
- Density is **asymmetric by zone**, not uniform: slab probability 1.0 on outer skerries vs 0.12 in
  pasture; `tree_p` 0.55 in forest vs 0.10 in pasture.
- Two subtraction rules do most of the composition work: nothing within 3 m of the asphalt (a clean
  shoulder; clutter starts at 3.1 m), and if ground 18 m out is below 0.5 m the verge goes low-only
  (heather, stones, shore plants, half-submerged slabs) so the sea stays visible.

## 2. Variety — 172 models in one world

`game/world/skargarden/models/` holds **172 unique GLBs** (plus `_tex` painted twins):

- Trees: 4 pines, 2 spruces, 2 birches, 2 wind-shaped pines, 3 junipers, alder, rowan, willow, hazel,
  dog rose, 2 apple trees, lilac, sea buckthorn — per-kind scale ranges 0.55–2.6.
- Ground: heather, grass tuft, blueberry, lingonberry, moss, reindeer lichen, 3 stone sets, 2
  erratics, 5 granite slabs, sea kale, reeds, bulrushes, water lilies.
- Buildings and harbour: white/yellow/red/blue/green cottages, farmhouse, barn, shed, boathouse,
  sauna, church, bell tower, windmill, lookout tower, kiosk, café; jetty, guest pier, bathing
  jetty, 5 boat types, buoy, red/green sea marks, net rack, beacon (båk), cairn, lighthouse.
- Everyday: mailboxes, road signs (text drawn on the mesh), cycle-route signs, road posts every
  50 m, roundpole and picket fences, power poles, woodpile, washing line, garden furniture, parked
  bikes, old car, tractor.
- People/animals: fisherman, sunbather, swimmer, café guest ×2, child with ice cream, dancers ×2,
  walker, dog, 2 cows, 2 sheep, horse, roe deer, seal, swan, eider raft, gull, kayak.

The ratio is the lesson: **~12 "hero" props per zone** carry the story, the rest repeat cheaply.
Each category has 2–5 silhouettes, not 20.

## 3. Composition — zones, landmarks, reserved sightlines

- The lap is cut into **32 zone runs of ~380 m** over 10 types: harbour, outer skerry, bay, forest,
  rock, church village, pasture, meadow, marina, bare islet. A zone is a *style table*, not a mesh:
  `{slab, trees[], tree_p, cover[], fine[], shore[], reeds[]}`.
- Landmarks sit on high points and at bay mouths: lighthouse on the hill, a second on the harbour
  knoll, church + bell tower, windmill, lookout tower, maypole, marina. Each is placed once then
  **reserved** (`_keep(pos, r)`, r = 4–30 m) so scatter refuses to grow over it — that is how a
  landmark keeps a clean 20 m apron.
- Clusters vs void: a village is a dense 40 m bubble (houses, drives, mailboxes, gardens, fences)
  followed by 150 m of open meadow. The emptiness between clusters is what makes them read.
- `FLATS` (6 discs) suppress rock humps and hill forest, and a flatness multiplier squared kills
  tree probability there, so villages and pastures stay open.

## 4. Life — the `sommarliv.gd` layer (292 lines, highest feel-per-line in the repo)

It **decorates what the world already placed** rather than adding new set dressing:

- Jetties: a fisherman at the tip of each of the first 4; per bathing jetty a sunbather on the
  deck, 2 swimmers circling 3.5–6 m out, a parked bike at the shore end.
- Café tables: 1–2 guests per table, every 4th table left empty; one child with ice cream and one
  parked bike per 60 m cell.
- 10 dancers in a 4.2 m ring round the maypole, two alternating models, 0.3 rad/s, 8 cm bounce.
- Animals: 2 horses beside the cows, up to 4 roe deer 22 m off the road in forest, up to 7 seals on
  rocks where land is 0.15–1.4 m and water 5 m beyond is below −0.8, up to 5 swans in pairs; a camp
  (tent, fire, hammock) 16 m inland, rejected unless all three sit above 0.5 m and are free.
- Boats and tracks: 3 Optimist dinghies on 22–30 m circles with 0.18 rad heel, 1 motorboat on a
  75 m circle; a walker + dog on one gravel road, a tractor (3.2 m/s) and a second walker on
  another, ping-ponging end to end.
- Ambient: 12 gulls in 3 flocks, 3 kayaks, 9 eider rafts, 7 anchored sailboats, 1 ferry on a 1.5 km
  lane. ≈ 60 animated nodes; per-frame cost is a handful of `sin()`.

Movement is **procedural oscillation on top of a path**: path point + `sin(t)` bob, a `sin` head
dip for grazers (`sin^6`), 4 % scale flicker on the fire. No clips, skeletons or state machines.

## 5. Performance

- One `MultiMesh` per (model × 64 m or 160 m chunk): 64 m for small plants, 160 m for trees and
  rocks. Each model is pre-merged into a single surface with colours baked into vertex colours, so
  a chunk is one draw call.
- `visibility_range_end` per kind: moss 110, lingonberry 120, lichen 130, blueberry 140, grass 150,
  stones 170, heather 210, sea kale 220, flowers 260, bushes 280, reeds/lilies 320, juniper 450,
  boulders 900, granite slabs 1800 m.
- Pines swap to a cheap `tall_fjarran` silhouette at exactly 170 m (two meshes, ranges split there).
  Far islets outside the playable rect get their own pine scatter, so the horizon reads as wooded
  skerries instead of fog.
- Small kinds and far silhouettes cast no shadows; shadow distance 220 m, 4 splits. The viewport
  renders at most 3.4 MP and upscales with FSR. Japan and Egypt use the same technique on a 7 m
  grid — smaller budgets, same rules.

## 6. Palette, light, atmosphere

- A dozen named colours do the whole ground: granite `#bf8a7c` / light `#cf9f90` / dark `#a8716a`,
  moss `#7c9440`, grass `#a2ad4c`, sand `#c9b48c`, sea bed `#5f7473`, gravel `#a69a88`, asphalt
  `#5e5955`. No textures on nature at all — flat vertex colour only.
- Default look is **one summer evening**: sun `#ffb062` at 2.4 energy, low (−10°), long soft
  shadows; sky lavender overhead to gold at the horizon; fog `#e9a98f` at 0.00035 density, 0.18 sun
  scatter, 0.55 aerial perspective; ACES, exposure 0.95, saturation 1.14, SSAO 1.8, glow 0.7.
- Wind is a vertex shader with per-instance phase from world position (`foot.x*0.13 + foot.z*0.17`)
  plus a slow global gust, so a meadow ripples instead of pulsing in lockstep. Weather and season
  are **global shader uniforms** (`snow_amount`, `autumn_amount`, `wet_amount`, `ice_amount`) read
  by ground, plants, road and water; props get snow via a material overlay. One switch recolours
  the whole world without touching placement.

## 7. What OpenRadlr can take (ideas only, no assets), ranked by impact per cost

| # | Idea | Why it pays |
| --- | --- | --- |
| 1 | **Zone style tables** per ~300 m stretch: `{species[], pTree, pRock, cover[], shore[]}` | cheapest change, biggest visible variety |
| 2 | **Verge bands**: 0–3 m empty, 2 items per 2 m in 3–7 m, one in 7–16 m | density where the camera looks |
| 3 | **Near-only ground cover**: 64 m chunks, 110–150 m range, no shadows, one mesh | cheapest triangles, biggest "fullness" win |
| 4 | **Far silhouettes + far-island scatter**: cheap pine at ~170 m, trees on the horizon | fills the skyline; our `far` variant exists |
| 5 | **Reserved sightlines**: `_keep(pos, r)` with r = 15–30 m round landmarks | composition from subtraction |
| 6 | **Open the verge on the sea side** when ground 18 m out is under water | same problem, same one-line fix |
| 7 | **A "summer life" pass** decorating props we already place (tables, jetties) | cheap, and it is what people remember |
| 8 | **~60 slow movers**: walker + dog, tractor, dinghies, swans, horses, seals | path point + `sin` bob, no animation data |
| 9 | **Per-instance wind phase** from world position in the plant shader | ten lines; a meadow stops moving as one |
| 10 | **Palette discipline**: 12–15 named colours, colour as data per kit model | stops a mixed CC0 kit from clashing |

## 8. Licensing

- `LICENSE` is **MIT**, "Copyright (c) 2026 noslemaus". Code reuse is fine with attribution; do not
  copy models into an AGPL repo without keeping the MIT notice.
- The models are **generated by the project's own Blender scripts**:
  `assets/blender/skargarden_modeller.py` ("Builds every Skärgården model in Blender and exports
  one GLB per model", own named palette), plus `japan_modeller.py` / `egypten_modeller.py`.
  Textures come from its own TextureCraft pipeline (`assets/texturer/*/*.json`), music from
  `assets/ljud/musik.py` (stems as `.wav`); every in-game sound effect is synthesised in code
  (`game/world/ljud.gd`), so there are no sampled sound assets.
- Only `README.md` and `LICENSE` exist as prose — **no third-party attribution file**, no vendor
  folder. Provenance is therefore "the script says so"; nothing suggests traced or downloaded
  artwork, but that is not proof. This is a reference for technique, not a source; do not lift
  geometry, and our CC0-only `make scenery-check` boundary stays as it is.

## Ten things to try first

1. Zone style tables keyed by distance along the route, 8–10 zones, ~380 m each.
2. Verge bands: 0–3 m clear, 3–7 m cover at 2 m steps, 7–16 m sparse, 6–14 m occasional tree.
3. Ground cover as its own near-only layer (64 m chunks, ~150 m range, no shadows).
4. Far pine silhouette swap at ~170 m, and a horizon ring of far trees on the outer islets.
5. `reserve(position, radius)` so landmarks, cafés and jetties get a clean apron.
6. Suppress verge clutter on the water side when the sea is within 18 m.
7. Decorate existing props: person at each table, bike at each jetty, fisher at the jetty end.
8. Add a walker + dog and a tractor on existing paths; three boats on circles in the bay.
9. Per-instance wind phase and a slow global gust in the plant shader.
10. Bake a 12-colour palette per kit model so CC0 packs read as one world.
