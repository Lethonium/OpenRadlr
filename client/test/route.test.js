import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_ORIGIN } from "../public/js/route/geo.js";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { squareRoute } from "./helpers.js";

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test("closes the loop and measures its length", () => {
  close(squareRoute().length, 1000);
});

test("interpolates elevation, grade and position like the server", () => {
  const route = squareRoute();
  close(route.elevationAt(375), 105);
  close(route.gradeAt(300), 4);
  close(route.gradeAt(900), -4);
  assert.deepEqual(route.positionAt(375), { x: 250, y: 125 });
});

test("wraps distances and computes signed gaps across the line", () => {
  const route = squareRoute();
  close(route.wrap(1250), 250);
  close(route.wrap(-100), 900);
  close(route.signedGap(990, 10), 20);
  close(route.signedGap(10, 990), -20);
});

test("rejects routes that are too short", () => {
  assert.throws(() => new RouteGeometry({ points: [[0, 0, 0]], lanes: 1 }));
  assert.throws(() => new RouteGeometry({ points: [[1, 1, 0], [1, 1, 5]], lanes: 1 }));
});

test("reports elevation range and bounds", () => {
  const route = squareRoute();
  assert.equal(route.minElevation, 100);
  assert.equal(route.maxElevation, 110);
  assert.deepEqual(route.bounds, { minX: 0, maxX: 250, minY: 0, maxY: 250 });
});

// --- shared maps (ADR 0010) ---------------------------------------------------

import { fetchMapNeighbours, mapCandidates } from "../public/js/route/worldMap.js";

const onMap = (id, map) => ({ id, name: id, lanes: 2, seed: 1, points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], ...(map ? { map } : {}) });

test("a route file may name the map it belongs to; anything malformed is ignored", () => {
  assert.deepEqual(new RouteGeometry(onMap("a", { id: "valley", seed: 7 })).map, { id: "valley", seed: 7 });
  assert.equal(new RouteGeometry(onMap("a")).map, null);
  assert.equal(new RouteGeometry(onMap("a", { id: 3, seed: 7 })).map, null);
  assert.equal(new RouteGeometry(onMap("a", { id: "valley" })).map, null);
});

test("the other routes on the same map are fetched; other maps, failures and the studio are left out", async () => {
  const route = new RouteGeometry(onMap("a", { id: "valley", seed: 7 }));
  const listed = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "broken" }, { id: "spin-studio", kind: "studio" }];
  assert.deepEqual(mapCandidates(route, listed), ["b", "c", "broken"]);
  const files = { b: onMap("b", { id: "valley", seed: 7 }), c: onMap("c", { id: "elsewhere", seed: 1 }) };
  const fetched = [];
  const fetchFile = async (id) => {
    fetched.push(id);
    if (!files[id]) throw new Error("HTTP 404");
    return files[id];
  };
  const others = await fetchMapNeighbours(route, listed, fetchFile);
  assert.deepEqual(others.map((f) => f.id), ["b"]);
  assert.deepEqual(fetched, ["b", "c", "broken"]);

  const alone = new RouteGeometry(onMap("a"));
  assert.deepEqual(await fetchMapNeighbours(alone, listed, fetchFile), [], "a route without a map stands alone");
  assert.equal(fetched.length, 3, "and nothing is fetched for it");
});

test("geo falls back to the world origin when missing or malformed", () => {
  const make = (geo) => new RouteGeometry({ id: "g", name: "g", lanes: 1, seed: 1, points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], geo });
  for (const bad of [undefined, "x", { lat: 38 }, { lat: 95, lon: 0 }, { lat: 0, lon: 200 }, { lat: "1", lon: 2 }, null]) {
    assert.deepEqual(make(bad).geo, WORLD_ORIGIN, JSON.stringify(bad));
  }
  assert.deepEqual(make({ lat: 38, lon: 2.6 }).geo, { lat: 38, lon: 2.6 });
});

test("the Lanzarote route has its climbs in course order", async () => {
  const { readFileSync } = await import("node:fs");
  const file = JSON.parse(readFileSync(new URL("../../routes/lanzarote-lava-180.json", import.meta.url), "utf8"));
  const route = new RouteGeometry(file);
  const names = route.markers.filter((m) => m.type === "climb" && m.name).sort((a, b) => a.distance - b.distance).map((m) => m.name);
  assert.deepEqual(names, ["Femés", "Timanfaya", "Tabayesco", "Mirador del Río"]);
  assert.deepEqual(route.geo, { lat: 38, lon: 2.6 });
  assert.equal(route.map, null);
  assert.ok(route.length > 178_200 && route.length < 181_800, `${route.length}`);
  for (let d = 0; d < route.length; d += 25) {
    assert.ok(Math.abs(route.gradeAt(d)) <= 12, `grade ${route.gradeAt(d)} at ${d}`);
  }
});
