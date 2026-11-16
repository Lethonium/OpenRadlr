# 28. Instance repeated scenery models

Date: 2026-11-16 · Status: accepted

## Context

Imported scenery initially copied every model vertex into world-space 300 m
chunks. This made placement easy, but repeated a tree or cottage hundreds of
times in the worker's heap, across the worker boundary and in GPU buffers. A
model-scenery build of only `rolling-hills` used 155 MiB of expanded scene
geometry even after removing an unnecessary far-tree copy. Richer model packs
could exhaust a phone before their first frame.

The existing renderer has flat-shaded, vertex-coloured meshes, no index buffers
and no textures. Chunk culling, deterministic placement and near/far levels of
detail already work and should not change. See [#117].

## Decision

Use WebGL 2 instancing for imported models:

- An `InstanceCatalog` registers each distinct model mesh once for the world.
  Its key is the built mesh's identity, so paint and near/far variants remain
  distinct while an identical shared cache entry is reused.
- `ChunkedMesh` keeps ordinary procedural triangles in its baked mesh. Repeated
  models instead become batches of float32 mat4 transforms per model per chunk.
  The placement translation determines chunk ownership; transformed model
  bounds keep culling conservative when a model crosses a tile boundary.
- The worker scene transfers a plain model catalog and typed-array transforms.
  The view uploads model buffers once and each batch's transform buffer once.
  A batch VAO references the shared model buffers but owns only its transform
  buffer. Batches are disposed before their models.
- Lazily compiled instanced colour and depth programs use matrix-column
  attributes with `vertexAttribDivisor(…, 1)` and `drawArraysInstanced`. The
  ordinary path is unchanged when there are no instances. Batches follow the
  same chunk visibility, LOD and near-rider shadow rules as baked geometry.
- Instance placement is opt-in for imported models. Procedural geometry,
  placement, seeded random consumption and scenery-off output stay unchanged.

Expand to position/yaw/uniform-scale packing, indexed or narrower vertices, or
per-instance tint only when a benchmark shows that the added complexity pays.

## Consequences

- Geometry is stored and uploaded once per model rather than once per
  placement. The route-only benchmark retains 1.357M expanded triangles but
  drops from 155 MiB to 21 MiB of scene data and from 2.41 s to 1.01 s to build.
- The same triangles are still submitted for visible instances. Instancing is
  primarily a memory and build-time improvement, not a triangle-reduction
  technique. More packs still need sensible near and far models.
- One draw per model per chunk costs more calls than the old single baked draw
  per chunk, in both opaque and shadow passes. The fixed-camera benchmark must
  track that trade-off on real hardware.
- Chunk bounds are conservative, and whole instances cull with their owner
  chunk. This can draw a few objects outside the ideal frustum in exchange for
  retaining batching and avoiding per-instance JavaScript work each frame.
- Full matrices preserve the current placement contract. New non-uniform or
  negative scales require an explicit normal/winding review before use.
- This is an internal client scene representation change; the server protocol
  is unaffected. Scenery with instances disabled keeps the old rendering path
  and does not compile the instanced shaders.

[#117]: https://github.com/Lethonium/OpenRadlr/issues/117
