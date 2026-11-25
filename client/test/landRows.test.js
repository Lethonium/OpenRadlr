import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createLandRowLayer } from "../public/js/view3d/scene/landRowLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { ROW_MARGIN, parcelRows, planLandRows, rowPlant } from "../public/js/world/plan/rows.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const flat = (kind, region, extra = {}) => {
  const [w, d] = [60, 40];
  return { kind, region, x: 100, z: 200, width: w, depth: d, yaw: 0.4, corners: Float32Array.from([-w, 5, -d, w, 5, -d, w, 5, d, -w, 5, d].map((v, i) => (i % 3 === 1 ? v : v / 2 + (i % 3 === 0 ? 100 : 200)))), ...extra };
};

test("an orchard is planted in rows inside its parcel", () => {
  const parcel = flat("orchard", "oliveTerraces");
  const rows = parcelRows(parcel);
  assert.ok(rows.length / 5 > 20);
  const [c, s] = [Math.cos(parcel.yaw), Math.sin(parcel.yaw)];
  const perRow = new Map();
  for (let i = 0; i < rows.length; i += 5) {
    const [dx, dz] = [rows[i] - parcel.x, rows[i + 2] - parcel.z];
    const [u, v] = [dx * c + dz * s, -dx * s + dz * c];
    assert.ok(Math.abs(u) <= parcel.width / 2 - ROW_MARGIN + 1e-3 && Math.abs(v) <= parcel.depth / 2 - ROW_MARGIN + 1e-3, `plant ${i / 5} inside`);
    assert.equal(rows[i + 1], 5);
    const key = String(Math.round(v * 10) / 10 + 0);
    perRow.set(key, (perRow.get(key) ?? 0) + 1);
  }
  assert.ok(perRow.size >= 4);
  assert.equal(new Set(perRow.values()).size, 1, "equal plants per row");
  const keys = [...perRow.keys()].map(Number).sort((a, b) => a - b);
  assert.ok(Math.abs(keys[1] - keys[0] - 7) < 0.02, "7 m between rows");
});

test("a vineyard is denser than an orchard and takes the height from its corners", () => {
  const orchard = parcelRows(flat("orchard", "oliveTerraces")).length;
  const vines = parcelRows(flat("vineyard", "oliveTerraces", { corners: Float32Array.from([0, 0, 0, 0, 10, 0, 0, 10, 0, 0, 0, 0]) }));
  assert.ok(vines.length > orchard * 8);
  for (let i = 1; i < vines.length; i += 5) assert.ok(vines[i] >= 0 && vines[i] <= 10);
});

test("the plant of a parcel follows its region", () => {
  assert.equal(rowPlant({ kind: "orchard", region: "oliveTerraces" }), "olive");
  assert.equal(rowPlant({ kind: "orchard", region: "pineCoast" }), "olive");
  assert.equal(rowPlant({ kind: "orchard", region: "almondValley" }), "almond");
  assert.equal(rowPlant({ kind: "orchard", region: "meadow" }), "broadleaf");
  assert.equal(rowPlant({ kind: "vineyard", region: "meadow" }), "vine");
  assert.equal(rowPlant({ kind: "arable", region: "meadow" }), null);
  assert.deepEqual(Object.keys(planLandRows([flat("vineyard", "x"), flat("orchard", "almondValley"), flat("arable", "x")])), ["almond", "vine"]);
});

const settings = qualitySettings("high");
const layerOf = (rows) => createLandRowLayer({ landRows: { olive: rows } }, { settings, uniforms: createSharedUniforms(), track: createTracker().track });
const frameAt = (x, z) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, 30, z);
  return { dt: 0.016, t: 1, camera };
};
const drawn = (layer) => layer.chunks.filter((c) => c.near.visible).reduce((sum, c) => sum + c.count, 0);

test("rows only grow within reach", () => {
  const layer = layerOf(parcelRows(flat("orchard", "oliveTerraces")));
  layer.update(frameAt(100 + 2000, 200));
  assert.equal(drawn(layer), 0);
  layer.update(frameAt(100, 200));
  assert.ok(drawn(layer) > 0);
  layer.dispose();
});

test("dispose frees everything", () => {
  const tracker = createTracker();
  const layer = createLandRowLayer({ landRows: { olive: parcelRows(flat("orchard", "x")), vine: parcelRows(flat("vineyard", "x")) } }, { settings, uniforms: createSharedUniforms(), track: tracker.track });
  layer.dispose();
  assert.equal(layer.object.children.length, 0);
  assert.equal(tracker.live(), 0);
});

test("the valley plans rows and the woods keep off its orchards", () => {
  const plan = planOf(valleyWorld());
  assert.ok(plan.landRows && typeof plan.landRows === "object");
  for (const data of Object.values(plan.landRows)) assert.ok(data instanceof Float32Array && data.length % 5 === 0);
  const orchards = plan.landUse.parcels.filter((p) => p.kind === "orchard");
  const inside = (t, p) => {
    const [dx, dz] = [t[0] - p.x, t[2] - p.z];
    const [c, s] = [Math.cos(p.yaw), Math.sin(p.yaw)];
    return Math.abs(dx * c + dz * s) < p.width / 2 && Math.abs(-dx * s + dz * c) < p.depth / 2;
  };
  for (const [id, data] of Object.entries(plan.trees)) {
    for (let i = 0; i < data.length; i += 5) assert.ok(!orchards.some((p) => inside(data.subarray(i, i + 5), p)), `a ${id} in an orchard`);
  }
});
