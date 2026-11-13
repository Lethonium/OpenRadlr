import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR_HEIGHT, buildStudioShell } from "../../public/js/view3d/studioBuilding.js";
import { STUDIO_FOOTPRINT } from "../../public/js/view3d/features.js";

const vertices = (mesh) => {
  const out = [];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
  return out;
};
const { halfWidth, front, back } = STUDIO_FOOTPRINT;
const EPS = 1e-4;

test("all shell parts stay inside the footprint", () => {
  const shell = buildStudioShell();
  for (const [name, mesh] of Object.entries(shell)) {
    assert.ok(mesh.vertexCount > 0, `${name} has geometry`);
    for (const [x, , z] of vertices(mesh)) {
      assert.ok(Math.abs(x) <= halfWidth + EPS && z >= front - EPS && z <= back + EPS, `${name} vertex ${x}, ${z}`);
    }
  }
});

test("a floor storey reaches exactly FLOOR_HEIGHT", () => {
  const { floor } = buildStudioShell();
  const heights = vertices(floor).map((p) => p[1]);
  assert.equal(FLOOR_HEIGHT, 4.9);
  assert.ok(Math.abs(Math.min(...heights)) < EPS);
  assert.ok(Math.abs(Math.max(...heights) - FLOOR_HEIGHT) < EPS);
});

test("the glass is at the front only", () => {
  const { glass } = buildStudioShell();
  assert.ok(glass.vertexCount > 0);
  for (const [, , z] of vertices(glass)) assert.ok(Math.abs(z - front) < EPS, `glass vertex at z ${z}`);
});
