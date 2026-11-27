import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createFieldEdgeLayer } from "../public/js/view3d/scene/fieldEdgeLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { EDGE_STRIDE, MAX_SEGMENT, parcelEdges } from "../public/js/world/plan/landUse.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

/** A flat-ish parcel `w` by `d` metres at (x, z); `rise` lifts its +x corners (a slope along the width). */
const parcel = (x, z, { w = 10, d = 10, yaw = 0, edge = "wall", rise = 0, kind = "arable" } = {}) => {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const corners = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) corners.push(x + (u * w * c) / 2 - (v * d * s) / 2, u > 0 ? 5 + rise : 5, z + (u * w * s) / 2 + (v * d * c) / 2);
  return { kind, x, z, width: w, depth: d, yaw, corners: Float32Array.from(corners), edge, region: "meadow" };
};

const count = (edges) => edges.wall.length / EDGE_STRIDE + edges.hedge.length / EDGE_STRIDE;

test("each parcel side gets one edge", () => {
  assert.equal(count(parcelEdges([parcel(0, 0)])), 4);
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(100, 0)])), 8);
});

test("a side shared with a neighbour (across the 4 m gap, or coincident) is edged once", () => {
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(14, 0)])), 7);
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(10, 0)])), 7);
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(0, 14)])), 7);
  assert.equal(count(parcelEdges([parcel(0, 0, { yaw: 0.5 }), parcel(14 * Math.cos(0.5), 14 * Math.sin(0.5), { yaw: 0.5 })])), 7);
});

test("sides that are only near, tilted, or beside each other are all edged", () => {
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(20, 0)])), 8, "a 10 m gap");
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(14, 0, { yaw: 0.3 })])), 8, "not parallel");
  assert.equal(count(parcelEdges([parcel(0, 0), parcel(10, 10)])), 8, "corner to corner, no overlap along the side");
});

test("a long side is cut into segments of at most 12 m that add up to its length", () => {
  const { wall } = parcelEdges([parcel(0, 0, { w: 50, d: 10 })]);
  assert.equal(wall.length / EDGE_STRIDE, 5 + 5 + 1 + 1);
  let along = 0;
  for (let i = 0; i < wall.length; i += EDGE_STRIDE) {
    assert.ok(wall[i + 4] <= MAX_SEGMENT + 1e-6);
    if (Math.abs(Math.sin(wall[i + 3])) < 1e-6) along += wall[i + 4];
  }
  assert.ok(Math.abs(along - 100) < 1e-3, `${along}`);
});

test("a segment follows the ground between its ends", () => {
  const { wall } = parcelEdges([parcel(0, 0, { w: 10, d: 10, rise: 3 })]);
  const rows = Array.from({ length: 4 }, (_, n) => wall.subarray(n * EDGE_STRIDE, (n + 1) * EDGE_STRIDE));
  const south = rows.find((r) => Math.abs(r[2] + 5) < 1e-3);
  assert.ok(Math.abs(south[1] - 6.5) < 1e-4, "mid height");
  assert.ok(Math.abs(south[5] - Math.atan2(3, 10)) < 1e-4, "pitch");
  const west = rows.find((r) => Math.abs(r[0] + 5) < 1e-3);
  assert.equal(west[5], 0, "level across");
});

test("walls in the south, hedges in the green, nothing on bare land", () => {
  const edges = parcelEdges([parcel(0, 0, { edge: "wall" }), parcel(100, 0, { edge: "hedge" }), parcel(200, 0, { edge: "none" })]);
  assert.equal(edges.wall.length / EDGE_STRIDE, 4);
  assert.equal(edges.hedge.length / EDGE_STRIDE, 4);
  assert.ok(edges.wall.every((v, i) => i % EDGE_STRIDE !== 0 || v < 50));
  assert.ok(edges.hedge.every((v, i) => i % EDGE_STRIDE !== 0 || v > 50));
});

test("the valley's plan carries its edges as typed arrays", () => {
  const plan = planOf(valleyWorld());
  assert.ok(plan.landEdges.wall instanceof Float32Array && plan.landEdges.hedge instanceof Float32Array);
  assert.equal(plan.landEdges.wall.length % EDGE_STRIDE, 0);
  assert.equal(plan.landEdges.hedge.length % EDGE_STRIDE, 0);
  assert.ok(count(plan.landEdges) > 0);
  const kinds = new Set(plan.landUse.parcels.map((p) => p.edge));
  assert.ok(kinds.has("wall") === plan.landEdges.wall.length > 0);
});

const settings = qualitySettings("high");
const layerOf = (landEdges) => createFieldEdgeLayer({ landEdges }, { settings, uniforms: createSharedUniforms(), track: createTracker().track });
const frameAt = (x, z) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, 30, z);
  return { dt: 0.016, t: 1, camera };
};
const drawn = (layer) => layer.chunks.filter((c) => c.visible).reduce((sum, c) => sum + c.count, 0);

test("edges only stand within reach", () => {
  const layer = layerOf(parcelEdges([parcel(100, 200), parcel(114, 200, { edge: "hedge" })]));
  layer.update(frameAt(100 + 2000, 200));
  assert.equal(drawn(layer), 0);
  layer.update(frameAt(100, 200));
  assert.ok(drawn(layer) > 0);
  layer.update(frameAt(100 + settings.landUse.edges + 200, 200));
  assert.equal(drawn(layer), 0);
  layer.dispose();
});

test("walls and hedges are separate meshes, one per kind and 300 m area", () => {
  const layer = layerOf(parcelEdges([parcel(100, 200), parcel(114, 200, { edge: "hedge" }), parcel(1000, 200)]));
  assert.equal(layer.chunks.length, 3);
  assert.deepEqual(layer.chunks.map((c) => c.kind).sort(), ["hedge", "wall", "wall"]);
  layer.dispose();
});

test("dispose frees everything", () => {
  const tracker = createTracker();
  const layer = createFieldEdgeLayer({ landEdges: parcelEdges([parcel(0, 0), parcel(100, 0, { edge: "hedge" })]) }, { settings, uniforms: createSharedUniforms(), track: tracker.track });
  layer.dispose();
  assert.equal(layer.object.children.length, 0);
  assert.equal(tracker.live(), 0);
});

test("a plan without edges draws nothing", () => {
  const layer = createFieldEdgeLayer({}, { settings, uniforms: createSharedUniforms(), track: createTracker().track });
  assert.equal(layer.chunks.length, 0);
  layer.dispose();
});
