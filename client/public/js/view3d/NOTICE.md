# Notices for the Three.js world

Parts of the 3D world are ported from the "Isle of Seasons" handover (a
Three.js r170 reference renderer and asset library written for OpenRadlr:
original procedural code, taken here under the project licence). The code was
restyled to the project's lint and naming rules, not pasted as is.

| File here | Taken from the reference |
|---|---|
| `scene/terrainLayer.js` | `buildTerrain`: 64 x 64 cell tiles with vertex colours, the grain and cloud-shadow hooks |
| `scene/sea.js` | `buildOcean`: the ocean shader (depth colour, fresnel sky, sun glints, shore foam, white caps) |
| `scene/sky.js` | `buildSky`: the sky dome with sun, moon, stars and clouds (no aurora or rainbow) |
| `scene/riverLayer.js` | `world.js` `buildRiver`: the river shader (flowing ripples, rapids, pale edge, sky sheen, fog) |
| `scene/roadLayer.js`, `assets/road.js`, `roadPosts.js` | `world.js` `roadTexture`, `buildRoad`, `buildRoadFurniture` and `assets/props/road-furniture.js` `reflectorParts`: asphalt grain (as a data texture), the road mesh and the orange-faced reflector posts |
| `../world/plan/roadStrips.js`, `../world/plan/riverStrips.js` | `world.js` `buildRoad`, `buildRiver`: cross-section strips and the river ribbon with its steepness attribute |
| `scene/noiseGlsl.js` | `NOISE_GLSL` in `core/shared.js` |
| `assets/materials.js`, `assets/hookChunks.js` | `core/shared.js` and `core/geo.js`: grain, cloud shadows and height fog hooks |
| `engine/post.js`, `engine/shaderChunks.js` | `core/post.js`: the post chain (occlusion, sun rays, depth of field, bloom, grade) |
| `assets/nature/foliage.js`, `foliageTextures.js` | `_foliage.js`: leaf cards, needle and leaf textures (as data textures), foliage materials |
| `assets/nature/crown.js`, `broadleaf.js` | `tree-broadleaf.js`: trunk, hull and leaf-card crowns; round, poplar, birch, cypress |
| `assets/nature/pine.js`, `bush.js`, `rock.js` | `tree-pine.js`, `bush.js`, `rock.js` |
| `assets/nature/grass.js`, `grassShader.js` | `grass-field.js`: grass rings with LOD cross-fade (ring tables are in `quality.js`) |
| `assets/nature/crops.js`, `cropShader.js`, `hayBale.js` | `crop-field.js`, `pumpkin.js`, `hay-bale.js`: seasonal crop fields, pumpkins, bales |
| `assets/materials.js` (`windify`, `translucent`, `noFlip`) | `core/geo.js` |
| `assets/buildings/house.js`, `shapes.js` | `assets/buildings/house.js` (scenic palette) and `core/geo.js` `gable`: the house in cottage, whitewashed, timber and stone styles, the gabled roof prism |
| `assets/buildings/farmstead.js`, `farmBuildings.js` | `assets/buildings/farmstead.js`: farmhouse, gambrel barn, silos, machine shed, bales, garden fence, with a small tractor in place of `props/tractor.js` |
| `assets/buildings/streetLamp.js` | `assets/buildings/street-lamp.js`: the slim LED lamp post (scenic) |
| `assets/buildings/lighthouse.js` | `assets/buildings/lighthouse.js`: banded tower, gallery, glazed lantern, keeper's cottage (no beam) |
| `assets/buildings/windmill.js` | `assets/buildings/windmill.js`: the lattice sails with canvas (the tower is #127's Mallorcan mill) |
| `assets/buildings/windTurbine.js`, `windpump.js` | `assets/buildings/wind-turbine.js`, `windpump.js`: tapered blades and nacelle; lattice tower, multi-blade wheel, tank |
| `assets/buildings/spinStudio.js` | `assets/buildings/spin-studio.js`: the spin studio, ported from the reference (shell, one storey's room, bikes, sign), replacing the old hand-built studio mesh |
| `assets/props/balloon.js`, `boat.js` | `props/balloon.js`, `props/boat.js`: the basket and ropes, the hull, cabin and sail |
| `assets/creatures/*.js` | `assets/creatures/*.js`, `_walk.js`: cow, sheep, horse, pig, chicken, deer, rabbit, fox, bird, butterfly, dolphin, rebuilt as merged vertex-coloured parts with swinging limbs (seeded coats, no canvas wing texture) |

`assets/buildings/castle.js`, `seaArch.js` and the windmill's tower are rebuilt on the geometry kit from #127's `landmarks.js` (castle ruin, `sweepRock` and `archRings`, Mallorcan mill), not from the reference. The roadside props in `assets/props/` (fence, wall, log pile, boardwalk, cairn, snow pole, cart, bench, mailbox, beehive) are new.

`assets/buildings/cathedral.js` is rebuilt on the geometry kit from the cathedral in #127's `tools/scenery/assemble.mjs`, not from the reference.

`assets/nature/olive.js`, `umbrellaPine.js`, `almond.js` and `lavender.js` are new in this renderer, in the reference's style.

Three.js itself is MIT licensed (`client/public/vendor/three/`).
