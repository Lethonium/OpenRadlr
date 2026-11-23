import { test } from "node:test";
import assert from "node:assert/strict";

import { parseShotList, settingsFor, pinCamera } from "../worldShotList.mjs";

const shot = (extra = {}) => ({ name: "a", kind: "ride", ...extra });

test("a list of shots is read", () => {
  const shots = parseShotList(JSON.stringify([shot({ at: 6490, camera: "drone" }), { name: "b", kind: "menu" }]));
  assert.deepEqual(shots.map((s) => s.name), ["a", "b"]);
  assert.equal(shots[0].at, 6490);
});

test("a duplicate name is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot(), shot()])), /a/);
});

test("an unknown kind is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot({ kind: "potato" })])), /a/);
});

test("an eye without a target is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot({ eye: [1, 2, 3] })])), /a/);
});

test("a target without an eye is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot({ target: [1, 2, 3] })])), /a/);
});

test("a negative join point is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot({ at: -5 })])), /a/);
});

test("an unknown time of day is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot({ time: "noon" })])), /a/);
});

test("settingsFor asks for the 3D view and nothing else by default", () => {
  assert.deepEqual(settingsFor(shot()), { "openride.view": "3d" });
});

test("settingsFor passes the route, camera, time of day and biome", () => {
  assert.deepEqual(settingsFor(shot({ route: "rolling-hills", camera: "chase", time: "dusk", biome: "winter" })), {
    "openride.view": "3d",
    "openride.route": "rolling-hills",
    "openride.camera": "chase",
    "openride.time": "dusk",
    "openride.biome": "winter",
  });
});

test("settingsFor never stores a quality level", () => {
  const keys = Object.keys(settingsFor(shot({ quality: "low" })));
  assert.ok(!keys.includes("openride.quality"));
});

test("pinCamera keeps the module and ends by pinning the camera", () => {
  const source = "export class ChaseCamera {}\n";
  const out = pinCamera(source, [1, 2, 3], [4, 5, 6]);
  assert.ok(out.startsWith(source));
  assert.match(out, /ChaseCamera\.prototype\.update = function/);
  assert.match(out, /this\.eye = \[1,2,3\]/);
  assert.match(out, /this\.target = \[4,5,6\]/);
});
