import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createScrubLayer } from "../public/js/view3d/scene/scrubLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { scrubPlants } from "../public/js/world/plan/scrub.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const parcel = (kind, extra = {}) => {
  const [w, d] = [120, 80];
  const corners = Float32Array.from([-w, 5, -d, w, 5, -d, w, 5, d, -w, 5, d].map((v, i) => (i % 3 === 1 ? v : v / 2 + (i % 3 === 0 ? 100 : 200))));
  return { kind, region: "meadow", x: 100, z: 200, width: w, depth: d, yaw: 0.4, corners, ...extra };
};
const total = (plants) => Object.values(plants).reduce((sum, a) => sum + a.length / 5, 0);
const inside = (p, x, z) => {
  const [dx, dz] = [x - p.x, z - p.z];
  const [c, s] = [Math.cos(p.yaw), Math.sin(p.yaw)];
  return Math.abs(dx * c + dz * s) <= p.width / 2 + 1e-3 && Math.abs(-dx * s + dz * c) <= p.depth / 2 + 1e-3;
};

test("scrub is clumped inside its parcel", () => {
  const p = parcel("scrub");
  const plants = scrubPlants([p], { seed: 3 });
  assert.ok(Object.keys(plants).every((id) => ["bush", "lavender", "rock"].includes(id)));
  const per = total(plants) / (p.width * p.depth);
  assert.ok(per > 0.7 / 60 && per < 1.3 / 60, `density ${1 / per} m2 per plant`);
  const points = [];
  for (const data of Object.values(plants)) {
    for (let i = 0; i < data.length; i += 5) {
      assert.ok(inside(p, data[i], data[i + 2]), "inside");
      assert.equal(data[i + 1], 5);
      assert.ok(data[i + 4] >= 0.7 && data[i + 4] <= 1.3);
      points.push([data[i], data[i + 2]]);
    }
  }
  // Clumped: the nearest neighbour is much closer than on an even grid of the same density.
  const near = points.map((a) => Math.min(...points.filter((b) => b !== a).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  const mean = near.reduce((s, v) => s + v, 0) / near.length;
  assert.ok(mean < 0.5 * Math.sqrt(60), `mean gap ${mean}`);
});

test("dunes are sparser than scrub", () => {
  const per = (kind) => total(scrubPlants([parcel(kind)], { seed: 3 })) / (120 * 80);
  assert.ok(per("dune") > 0);
  assert.ok(per("dune") < 0.5 * per("scrub"));
});

test("only scrub and dunes get plants", () => {
  assert.deepEqual(scrubPlants([parcel("arable"), parcel("orchard")], { seed: 3 }), {});
});

test("the same seed plants the same scrub", () => {
  const parcels = [parcel("scrub"), parcel("dune", { x: 500 })];
  assert.deepEqual(scrubPlants(parcels, { seed: 7 }), scrubPlants(parcels, { seed: 7 }));
  assert.notDeepEqual(scrubPlants(parcels, { seed: 7 }), scrubPlants(parcels, { seed: 8 }));
});

const settings = qualitySettings("high");
const layerOf = (data) => createScrubLayer({ scrub: { bush: data } }, { settings, uniforms: createSharedUniforms(), track: createTracker().track });
const frameAt = (x, z) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, 30, z);
  return { dt: 0.016, t: 1, camera };
};
const drawn = (layer) => layer.chunks.filter((c) => c.near.visible).reduce((sum, c) => sum + c.count, 0);

test("scrub only grows within reach", () => {
  const layer = layerOf(scrubPlants([parcel("scrub")], { seed: 3 }).bush);
  layer.update(frameAt(100 + 3000, 200));
  assert.equal(drawn(layer), 0);
  layer.update(frameAt(100, 200));
  assert.ok(drawn(layer) > 0);
  layer.dispose();
});

test("dispose frees everything", () => {
  const tracker = createTracker();
  const layer = createScrubLayer({ scrub: { bush: scrubPlants([parcel("scrub")], { seed: 3 }).bush } }, { settings, uniforms: createSharedUniforms(), track: tracker.track });
  layer.dispose();
  assert.equal(layer.object.children.length, 0);
  assert.equal(tracker.live(), 0);
});

test("the valley plans scrub", () => {
  const plan = planOf(valleyWorld());
  for (const data of Object.values(plan.scrub)) assert.ok(data instanceof Float32Array && data.length % 5 === 0);
  const kinds = new Set(plan.landUse.parcels.map((p) => p.kind));
  if (kinds.has("scrub") || kinds.has("dune")) assert.ok(total(plan.scrub) > 0);
});
