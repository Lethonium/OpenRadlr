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

`assets/nature/olive.js`, `umbrellaPine.js`, `almond.js` and `lavender.js` are new in this renderer, in the reference's style.

Three.js itself is MIT licensed (`client/public/vendor/three/`).
