import { test } from "node:test";
import assert from "node:assert/strict";

import { parseShotList, settingsFor, pinCamera, urlFor } from "../worldShotList.mjs";

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

test("settingsFor asks for the 3D view at a stored High by default", () => {
  assert.deepEqual(settingsFor(shot()), { "openride.view": "3d", "openride.quality": "high" });
});

test("settingsFor passes the route, camera, time of day and season", () => {
  assert.deepEqual(settingsFor(shot({ route: "rolling-hills", camera: "chase", time: "night", season: "winter" })), {
    "openride.view": "3d",
    "openride.quality": "high",
    "openride.route": "rolling-hills",
    "openride.camera": "chase",
    "openride.time": "night",
    "openride.season": "winter",
  });
});

test("parseShotList accepts night and a season", () => {
  const [parsed] = parseShotList(JSON.stringify([{ name: "a", kind: "ride", time: "night", season: "autumn" }]));
  assert.equal(parsed.time, "night");
  assert.equal(parsed.season, "autumn");
});

test("settingsFor always stores High, never a shot's own level", () => {
  assert.equal(settingsFor(shot({ quality: "low" }))["openride.quality"], "high");
});

test("pinCamera keeps the module and ends by pinning the camera", () => {
  const source = "export class ChaseCamera {}\n";
  const out = pinCamera(source, [1, 2, 3], [4, 5, 6]);
  assert.ok(out.startsWith(source));
  assert.match(out, /ChaseCamera\.prototype\.update = function/);
  assert.match(out, /this\.eye = \[1,2,3\]/);
  assert.match(out, /this\.target = \[4,5,6\]/);
});

test("a workbench shot names its asset, and may name a season and a time", () => {
  const [one] = parseShotList(JSON.stringify([{ name: "w", kind: "workbench", asset: "olive", season: "summer", time: "dusk" }]));
  assert.deepEqual([one.asset, one.season, one.time], ["olive", "summer", "dusk"]);
});

test("a workbench shot without an asset is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([{ name: "w", kind: "workbench" }])), /w/);
});

test("an asset on any other kind of shot is rejected, naming the shot", () => {
  assert.throws(() => parseShotList(JSON.stringify([shot({ asset: "olive" })])), /a/);
});

test("the gallery kind is gone", () => {
  assert.throws(() => parseShotList(JSON.stringify([{ name: "g", kind: "gallery", biome: "winter" }])), /g/);
});

test("a workbench shot opens workbench.html with its asset, season and time", () => {
  const url = urlFor({ name: "w", kind: "workbench", asset: "umbrellaPine", season: "winter", time: "night" }, "http://x");
  assert.equal(url, "http://x/workbench.html?asset=umbrellaPine&season=winter&time=night");
  assert.equal(urlFor({ name: "w", kind: "workbench", asset: "olive" }, "http://x"), "http://x/workbench.html?asset=olive");
});

test("a ride shot with a weather previews it through the address", () => {
  const [shot] = parseShotList(JSON.stringify([{ name: "s", kind: "ride", at: 200, weather: "storm" }]));
  assert.equal(urlFor(shot, "http://x"), "http://x/?at=200&weather=storm");
});

test("ride and menu shots keep their addresses", () => {
  assert.equal(urlFor(shot({ at: 12 }), "http://x"), "http://x/?at=12");
  assert.equal(urlFor({ name: "m", kind: "menu" }, "http://x"), "http://x/");
});

test("settingsFor stores a shot's extra storage, objects as JSON", () => {
  const settings = settingsFor(shot({ storage: { "openradlr.look": { kit: "road" }, "openride.flag": "on" } }));
  assert.equal(settings["openradlr.look"], '{"kit":"road"}');
  assert.equal(settings["openride.flag"], "on");
});

test("parseShotList keeps a shot's storage and refuses one that is not an object", () => {
  const [parsed] = parseShotList(JSON.stringify([{ name: "a", kind: "ride", storage: { "openradlr.look": { kit: "road" } } }]));
  assert.deepEqual(parsed.storage, { "openradlr.look": { kit: "road" } });
  assert.throws(() => parseShotList(JSON.stringify([{ name: "a", kind: "ride", storage: "x" }])), /storage/);
});
