import { test } from "node:test";
import assert from "node:assert/strict";

import { HOUSE_STYLES_2D, HOUSE_TURNS, HOUSE_YAWS, PLANT_SPRITES, CREATURE_SPRITES, BUILDING_SPRITES, GAME_SPRITES, riderJob, spriteJobs, spriteKey } from "../public/js/view2d/sprites/catalog.js";
import { WORKBENCH_ASSETS } from "../public/js/workbenchState.js";

const sets = [{ view: "side" }, { view: "top" }, { view: "side", night: true }, { view: "top", night: true }];

test("catalog: every job names a workbench asset", () => {
  for (const spec of sets) for (const job of spriteJobs(spec)) assert.ok(WORKBENCH_ASSETS[job.id], job.id);
  for (const id of [...PLANT_SPRITES, ...CREATURE_SPRITES, ...GAME_SPRITES, ...Object.values(BUILDING_SPRITES)]) assert.ok(WORKBENCH_ASSETS[id], id);
});

test("catalog: keys are unique within a set and between day and night", () => {
  for (const view of ["side", "top"]) {
    const keys = [...spriteJobs({ view }), ...spriteJobs({ view, night: true })].map((job) => job.key);
    assert.equal(new Set(keys).size, keys.length, view);
  }
  const job = spriteJobs({ view: "side" })[0];
  assert.equal(job.key, spriteKey(job));
});

test("catalog: side sprites are baked at their pixels per metre", () => {
  const jobs = spriteJobs({ view: "side" });
  const ppm = (ids) => jobs.filter((job) => ids.includes(job.id) && job.id !== "house").map((job) => job.ppm);
  assert.deepEqual(new Set(ppm(PLANT_SPRITES)), new Set([22]));
  assert.deepEqual(new Set(ppm(Object.values(BUILDING_SPRITES))), new Set([12]));
  assert.deepEqual(new Set(ppm(CREATURE_SPRITES)), new Set([30]));
});

test("catalog: side houses are one per turn, at 14 px/m, turned by it", () => {
  const houses = spriteJobs({ view: "side" }).filter((job) => job.id === "house");
  assert.equal(houses.length, HOUSE_STYLES_2D.length * HOUSE_TURNS.length);
  assert.deepEqual(new Set(houses.map((job) => job.ppm)), new Set([14]));
  assert.deepEqual(houses.filter((job) => job.options.style === "cottage").map((job) => job.yaw), [...HOUSE_TURNS]);
});

test("catalog: top houses are one per style and yaw k/12 of a turn", () => {
  const houses = spriteJobs({ view: "top" }).filter((job) => job.id === "house" && job.options.style === "stone");
  assert.equal(houses.length, HOUSE_YAWS);
  houses.forEach((job, k) => assert.equal(job.yaw, (k / 12) * Math.PI * 2));
  assert.equal(spriteJobs({ view: "top" }).filter((job) => job.id === "house").length, HOUSE_STYLES_2D.length * HOUSE_YAWS);
});

test("catalog: the night set holds only buildings that light up", () => {
  const ids = new Set(spriteJobs({ view: "side", night: true }).map((job) => job.id));
  assert.deepEqual([...ids].sort(), ["bike-cafe", "farmstead", "house", "lighthouse", "streetLamp"]);
  assert.ok(spriteJobs({ view: "side", night: true }).every((job) => job.night));
  assert.ok(spriteJobs({ view: "side" }).every((job) => !job.night));
});

test("catalog: a rider in the side view is 12 frames at 48 px/m, from above one frame", () => {
  const look = { primary: "#ff0000" };
  const side = riderJob(look, "side");
  assert.deepEqual([side.id, side.frames, side.dt, side.ppm, side.view], ["cyclist", 12, 0.0556, 48, "side"]);
  assert.equal(side.options.primary, "#ff0000");
  const top = riderJob(look, "top");
  assert.equal(top.frames, 1);
  assert.notEqual(riderJob({ primary: "#00ff00" }, "side").key, side.key);
  assert.equal(riderJob(look, "side").key, side.key);
});
