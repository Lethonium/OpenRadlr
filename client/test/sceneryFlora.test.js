/**
 * Several kits drawn as one (#117): the trees from Kenney's nature kit, the
 * village from the town kit. Each role is answered by the first kit holding it,
 * and every model still reads its own kit's files.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { floraOf } from "../public/js/view3d/scenery/flora.js";

const model = (name, height) => ({
  name,
  triangles: [
    [-1, 0, 0, 0.5, 0.5, 0.5],
    [1, 0, 0, 0.5, 0.5, 0.5],
    [0, height, 0, 0.5, 0.5, 0.5],
  ],
  bounds: { min: [-1, 0, 0], max: [1, height, 0] },
});

const NATURE = {
  name: "nature",
  licence: "CC0-1.0",
  models: { pine: { role: "firs", file: "pine" }, bush: { role: "houses", file: "bush" } },
  files: { pine: model("pine", 4), bush: model("bush", 1) },
};
const TOWN = {
  name: "town",
  licence: "CC0-1.0",
  // Same file name as the nature kit's: packs do not coordinate their names.
  models: { pine: { role: "fountains", file: "pine" }, church: { role: "church", file: "church", far: "church-far" } },
  files: { pine: model("fountain", 2), church: model("church", 12), "church-far": model("church-far", 11) },
};

/** The tallest point of a built mesh. */
const heightOf = (built) => {
  let top = -Infinity;
  for (let i = 1; i < built.positions.length; i += 3) top = Math.max(top, built.positions[i]);
  return top;
};

test("a role only the second kit holds is drawn from the second kit's own files", () => {
  const flora = floraOf({ kits: [NATURE, TOWN] });
  const fountain = flora.model("fountains", () => 0);
  assert.ok(fountain, "the town kit's fountain is found");
  assert.equal(fountain.bounds.max[1], 2, "and it is the town's file, not the nature kit's file of the same name");
});

test("the first kit holding a role answers for it", () => {
  const flora = floraOf({ kits: [NATURE, TOWN] });
  assert.equal(flora.model("houses", () => 0).bounds.max[1], 1);
});

test("a building comes with its cheap twin when the kit ships one, and without when it does not", () => {
  const flora = floraOf({ kits: [NATURE, TOWN] });
  const church = flora.model("church", () => 0);
  assert.ok(church.near && church.far);
  assert.equal(heightOf(church.far), 11);
  assert.equal(flora.model("fountains", () => 0).far, null);
});

test("a role no kit holds gives nothing, so the world keeps its own", () => {
  assert.equal(floraOf({ kits: [NATURE] }).model("church", () => 0), null);
});
