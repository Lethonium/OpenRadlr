import { test } from "node:test";
import assert from "node:assert/strict";

import { BUILDINGS } from "../public/js/view3d/assets/buildings/index.js";
import { NATURE } from "../public/js/view3d/assets/nature/index.js";
import { CREATURES } from "../public/js/view3d/assets/creatures/index.js";
import { RIDERS } from "../public/js/view3d/assets/riders/index.js";
import { FLOATERS, PROPS } from "../public/js/view3d/assets/props/index.js";
import * as THREE from "../public/js/three.js";
import { PEOPLE } from "../public/js/view3d/assets/people/index.js";
import { WORKBENCH_ASSETS, groundAsset, workbenchState } from "../public/js/workbenchState.js";

const FIRST = Object.keys(NATURE)[0];

test("the workbench starts on the first asset, in summer, by day", () => {
  assert.deepEqual(workbenchState(""), { asset: FIRST, season: "summer", time: "day" });
});

test("asset, season and time are read from the address", () => {
  assert.deepEqual(workbenchState("?asset=olive&season=winter&time=night"), { asset: "olive", season: "winter", time: "night" });
});

test("an unknown asset falls back to the first", () => {
  assert.equal(workbenchState("?asset=potato").asset, FIRST);
});

test("an unknown season or time falls back to summer and day", () => {
  const state = workbenchState("?asset=olive&season=monsoon&time=teatime");
  assert.deepEqual([state.season, state.time], ["summer", "day"]);
});

test("every plant of the kit can be asked for", () => {
  for (const id of Object.keys(NATURE)) assert.equal(workbenchState(`?asset=${id}`).asset, id);
});

test("the asset list is the caller's when it brings one", () => {
  assert.equal(workbenchState("?asset=b", ["a", "b"]).asset, "b");
  assert.equal(workbenchState("?asset=olive", ["a", "b"]).asset, "a");
});

test("the bench offers the plants, the buildings, the props, the animals, the riders and the vehicles, each id once", () => {
  const ids = Object.keys(WORKBENCH_ASSETS);
  assert.equal(ids.length, Object.keys(NATURE).length + Object.keys(BUILDINGS).length + Object.keys(PROPS).length + Object.keys(FLOATERS).length + Object.keys(PEOPLE).length + Object.keys(CREATURES).length + Object.keys(RIDERS).length + 2); // the tandem and the beer bike
  for (const id of ["windmill", "lighthouse", "balloon", "bench"]) assert.equal(workbenchState(`?asset=${id}`).asset, id);
});

test("every building and prop on the bench builds with the bench's options and frees what it made", async () => {
  const { createTracker } = await import("../public/js/view3d/scene/tracker.js");
  const { createSharedUniforms } = await import("../public/js/view3d/assets/materials.js");
  for (const id of [...Object.keys(BUILDINGS), ...Object.keys(PROPS), ...Object.keys(FLOATERS), ...Object.keys(PEOPLE), ...Object.keys(CREATURES), ...Object.keys(RIDERS)]) {
    const tracker = createTracker();
    const made = WORKBENCH_ASSETS[id].create({ season: "summer", track: tracker.track, uniforms: createSharedUniforms() });
    assert.ok(made.object.children.length > 0, id);
    made.dispose();
    assert.equal(tracker.live(), 0, id);
  }
});

const lowest = (object) => new THREE.Box3().setFromObject(object.updateMatrixWorld(true) || object).min.y;

test("a centred animal is lifted to sit on the ground, a standing one stays put", () => {
  const dolphin = WORKBENCH_ASSETS.dolphin.create({});
  assert.ok(lowest(dolphin.object) < -0.1, "centred, so half of it is underground");
  groundAsset(dolphin.object);
  assert.ok(Math.abs(lowest(dolphin.object)) < 1e-6, "now rests on y = 0");
  const cow = WORKBENCH_ASSETS.cow.create({});
  groundAsset(cow.object);
  assert.equal(cow.object.position.y, 0);
});
