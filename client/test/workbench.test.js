import { test } from "node:test";
import assert from "node:assert/strict";

import { NATURE } from "../public/js/view3d/assets/nature/index.js";
import { workbenchState } from "../public/js/workbenchState.js";

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
