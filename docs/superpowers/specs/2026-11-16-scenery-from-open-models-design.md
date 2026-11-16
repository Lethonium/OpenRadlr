# Scenery from open models — design

Date: 2026-11-16 · Status: draft (spike, #117)

## Context

The island reads as empty. `buildScenery` (`world.js:747`) places up to
1,100 trees per route, but every one is drawn by `plantTree`
(`biomes/temperate.js:127`) from cones and ellipsoids: one fir repeated, one
round crown repeated. Numbers do not fix it — the silhouette is the same
everywhere, so a fuller wood still reads as noise.

The Living draft (#48) attacked this procedurally from the ground up and the
result was still thin. This spike tries the other way: models that were
modelled with an eye for silhouette, taken from openly licensed packs.

It is a spike. The aim is a branch to look at, and frame numbers to argue
with, not a merge.

## Licence boundary

Only **CC0** models enter the repository. The repo is public and `LICENSE` is
AGPL, so everything under `client/public/` has to be redistributable; CC0 is a
public-domain dedication and asks nothing back.

Conditional licences are out, including Quaternius's newer **Quaternius Asset
License v1.0**, whose §3(a) forbids redistributing the assets "regardless of
how much they have been modified". Their CC0-era packs predate it, and QAL §7
says it does not apply retroactively, so those stay CC0. **A pack is taken
only if its page links CC0.** If it shows QAL, the pack is skipped, not argued
about.

Accepted, all CC0:

| Kit | Pack | Why |
| --- | --- | --- |
| `nature` | Quaternius Ultimate Nature (150 models, untextured) | trees, shrubs, rocks, deadwood — the emptiness |
| `buildings` | Quaternius Buildings (untextured) | European townhouses for the villages |
| `farm` | Quaternius Farm Buildings + Farm Animals (untextured) | barns, silos, windmills, animals |
| `racing` | Kenney Racing Kit (textured) | race-day barriers, tents, signage |

Rejected: Quaternius Simple Buildings (textured, flat-roof suburban), Kenney
City Kits (pale grey, clashes), Kenney Mini (too pastel).

`make scenery-check` enforces this: every kit manifest must declare
`licence: "CC0-1.0"` with provenance (pack URL, licence URL, download date).

## The renderer constraint

`renderer.js:12-32` draws one vertex format: `a_position`, `a_normal`,
`a_color`, flat shaded, no textures on meshes. So models are converted to
that format offline:

- **Quaternius** packs are untextured; colours come from the material.
- **Kenney** GLB carries `TEXCOORD_0` and a `colormap`; the importer samples
  the colour map at each triangle's centroid.

Either way the browser never sees a texture, a UV or a material — just
geometry in our own format, which is why the result cannot clash the way a
bolted-on kit would.

## Decision

**Models are data, imported offline, chosen by kit manifests, placed by the
existing scenery code.**

```
client/public/assets/scenery/<kit>/manifest.json + <model>.geo.json
client/public/js/view3d/scenery/{kits,models,palette,plan}.js
tools/scenery/{import.mjs, check.mjs}
```

- `world.js` keeps its placement. `buildScenery` gains an optional `flora`
  that draws from a kit instead of `biome.flora.tree`, so every existing rule
  (forests near the road, occupancy, no trees in the sea or on the beach,
  determinism from the route seed) applies unchanged.
- Placement stays one instance per pick; the kit picks a model, a yaw and a
  scale from the seeded random.
- **LOD:** each model may carry a `far` variant; the kit draws `near` within
  `nearRange` of the camera and `far` beyond. That is where fullness comes
  from — cheap silhouettes fill the horizon, detail only close up.
- **Seasons:** `palette.js` maps a model's material *role* (`bark`,
  `foliage`, `foliage-fir`, `structure`, `roof`, `stone`) to the active
  biome's colours. This spike ships identity mapping: every season keeps the
  model's own colours, and a role the biome does not know keeps the source
  colour. Wiring season colours in is a follow-up.
- **FPS read-out:** optional, in settings, off by default. A pure meter
  reports the mean and the 1% low frame time, written twice a second.

## Consequences

- The world stops being purely generated code. `ASSETS-LICENSE.md` gains a
  section for `client/public/assets/scenery/`, listing each kit's source and
  licence, and the rule that a kit without a CC0 manifest is not imported.
- Scenery is off by default (`openradlr.scenery`), so every existing ride,
  screenshot and test is unchanged until someone asks for it.
- The models are fixed artwork: a tree cannot be re-shaped by a biome the way
  `plantTree` can. Season colour is the only lever until the palette is wired.
- Bundle size grows by the imported kits; the importer quantises positions
  and strips normals where they can be recomputed from winding.
- Bike and rider stay procedural: the kits have nothing like them.
