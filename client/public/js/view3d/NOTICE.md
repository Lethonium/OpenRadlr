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
| `scene/noiseGlsl.js` | `NOISE_GLSL` in `core/shared.js` |
| `assets/materials.js`, `assets/hookChunks.js` | `core/shared.js` and `core/geo.js`: grain, cloud shadows and height fog hooks |
| `engine/post.js`, `engine/shaderChunks.js` | `core/post.js`: the post chain (occlusion, sun rays, depth of field, bloom, grade) |

Three.js itself is MIT licensed (`client/public/vendor/three/`).
