# 21. Living: a world tier with one generated ground texture

Date: 2026-11-09 · Status: accepted

## Context

From the drone the island read as a noise pattern, and at road level it was
empty (#48). The renderer draws flat, vertex-coloured meshes without textures
or instancing (ADR 0018), and the valley map already has 4.7M vertices. Plain
3D must stay as it is, so weaker hardware keeps a world it can draw. The
terrain's triangles are 16–48 m across, so their colours cannot show a field.

## Decision

- **Living is a view choice, not a quality level.** `2D · 3D · Living` sits
  with the view choice. The High/Low graphics toggle is about the same world
  drawn more cheaply; Living is a different world that costs more to build
  and upload. `app.viewMode` stays `"3d"`, so existing checks and saved views
  keep working, and `openride.living` (`"on"` / `"off"`) holds the choice.
  While it is unset, Living is on except on phones and devices reporting
  under 4 GB of memory. A saved `3d` is not a choice about Living.
- **One generated ground texture per island.** A 2048² RGBA8 map is painted
  in the world worker from parcel, crop and land data and read by the terrain
  shader before lighting, so sun, shadows and fog behave as on plain terrain.
  It is the renderer's first generated texture. We did not cut the terrain
  finer (millions more triangles, and the coarse far blocks would need to go)
  or recolour vertices (a field is smaller than a triangle). The map is
  premultiplied by alpha: alpha zero under the sea and in river beds keeps the
  vertex colours, and mipmaps stay right along the coast. A device whose
  texture limit is under 2048 keeps vertex colours.
- **Fields are data.** `living/fields.js` lays out road-aligned parcels and
  land classes; the painter, hedges, orchards and tractors all read the same
  layout, so a hedge stands on a painted edge.
- **Motion is plain data.** The worker produces movers with a path, a speed
  and a phase; `moverPose(mover, timeS)` is pure, so nothing accumulates over
  a long ride. At most 150 are drawn per frame, nearest first, balloons
  always; reduced motion freezes them. Movement is not synced between riders.
- **Cosmetic only.** The ADR 0018 invariants hold: terrain heights, roads,
  zones, cafés, gyms, statue rows and `overview` are identical with Living on
  or off, and tests guard this.
- **A biome opts in** with a `biome.living` hook (colours, flora, budgets).
- **Where Living falls back to plain 3D:** a biome without the hook (Winter
  for now), a world without a road network, or an island box longer than
  16 km on a side, where one map would be coarser than 8 m per pixel. The view
  says so with a short note.
- **Sky.** The sky pass never drew in plain 3D (depth 1.0 against `LESS`); the
  fix applies in Living only, so plain 3D keeps its look.

## Consequences

- Living adds about 0.85M vertices on the valley map (limit 1.65M), about
  22 MB of texture, and roughly a quarter of a plain build's time.
- Per-item vertex budgets on the biome are the levers if Living is too heavy.
- Riders on the same road may see different looks, as with seasons.
- Frame rates on real laptops and phones were not measured on the development
  machine, which has no GPU; the budgets above are its stand-ins.
