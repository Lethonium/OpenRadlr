/**
 * Scenery off is the world a rider already had (#117): the tree sizing, the
 * giants and the short trees by towns only exist with a kit, so the procedural
 * world must keep every vertex. This pins the whole rolling-hills build.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { buildWorld } from "../public/js/view3d/world.js";

const ROUTE = JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url)));

/** A digest of every chunk's vertices, in a stable order. */
function digestOf(world) {
  const hash = createHash("sha256");
  for (const group of Object.keys(world.chunks).sort()) {
    const chunks = world.chunks[group];
    if (!Array.isArray(chunks)) continue;
    hash.update(group);
    for (const chunk of chunks) {
      const mesh = chunk.mesh;
      if (!mesh?.positions) continue;
      hash.update(String(mesh.vertexCount));
      for (const key of ["positions", "normals", "colors"]) hash.update(Buffer.from(mesh[key].buffer, mesh[key].byteOffset, mesh[key].byteLength));
    }
  }
  return hash.digest("hex");
}

test("scenery off builds exactly the world it did before the tree sizing", () => {
  const world = buildWorld(new RouteGeometry(ROUTE));
  assert.equal(digestOf(world), "3bf6eef69c586ed0ed5550624d002ae83cb475aca3c5e97244d7097636a99bbb");
});
