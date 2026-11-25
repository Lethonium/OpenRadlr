import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createCropLayer } from "../public/js/view3d/scene/cropLayer.js";
import { createForestLayer } from "../public/js/view3d/scene/forestLayer.js";
import { createGrassLayer } from "../public/js/view3d/scene/grassLayer.js";
import { grassWeights, heightSampler } from "../public/js/view3d/scene/grassField.js";
import { createRoadsideLayer } from "../public/js/view3d/scene/roadsideLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { fieldExtras } from "../public/js/view3d/assets/nature/crops.js";
import { seededRandom } from "../public/js/world/noise.js";
import { MASK, insideField, maskAt, stampField } from "../public/js/world/plan/masks.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { planOf, tinyWorld } from "./support/planFixture.js";

const world = tinyWorld();
const plan = planOf(world);
const ground = buildGroundGrids(world.terrain, groundExtent(world.terrain), { season: "summer", long: false, regions: world.regions, masks: plan.masks });
const high = qualitySettings("high");
const low = qualitySettings("low");

const options = (settings = high, extra = {}) => ({ settings, uniforms: createSharedUniforms(), track: extra.track ?? createTracker().track, ...extra });
const cameraAt = (x, y, z) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.updateMatrixWorld();
  return camera;
};
const frameAt = (x, z) => ({ dt: 0.016, t: 1, camera: cameraAt(x, 30, z), focus: [x, 0, z] });
const meshesOf = (object) => {
  const list = [];
  object.traverse((child) => child.isInstancedMesh && list.push(child));
  return list;
};

test("one instanced mesh per plant, part and chunk, with every planted tree in one", () => {
  const layer = createForestLayer(plan, options());
  assert.ok(layer.chunks.length > 1, "several chunks");
  const seen = {};
  for (const chunk of layer.chunks) {
    const near = meshesOf(chunk.near);
    assert.ok(near.length >= 1);
    for (const mesh of near) assert.equal(mesh.count, chunk.count, chunk.id);
    seen[chunk.id] = (seen[chunk.id] ?? 0) + chunk.count;
  }
  for (const [id, data] of Object.entries(plan.trees)) if (seen[id] !== undefined || data.length) assert.equal(seen[id], data.length / 5, id);
  layer.dispose();
});

test("cards near, hulls far, nothing beyond", () => {
  const { cards, hulls } = high.treeLod;
  const layer = createForestLayer(plan, options());
  const chunk = layer.chunks.find((c) => c.near.children.some((m) => m.material.alphaTest));
  assert.ok(chunk, "a chunk with leaf cards");
  const at = (distance) => {
    layer.update({ ...frameAt(chunk.x1 + distance, (chunk.z0 + chunk.z1) / 2) });
    return [chunk.near.visible, chunk.far.visible];
  };
  assert.deepEqual(at(cards - 1), [true, false]);
  assert.deepEqual(at(cards + 1), [false, true]);
  assert.deepEqual(at(hulls + 1), [false, false]);
  layer.dispose();
});

test("low has no leaf shadows, high has", () => {
  const cards = (settings) => {
    const layer = createForestLayer(plan, options(settings));
    const list = layer.chunks.flatMap((c) => meshesOf(c.near)).filter((m) => m.material.alphaTest);
    layer.dispose();
    return list;
  };
  const lowCards = cards(low);
  assert.ok(lowCards.length > 0);
  assert.ok(lowCards.every((m) => !m.castShadow));
  const highCards = cards(high);
  assert.ok(highCards.length > 0);
  assert.ok(highCards.every((m) => m.castShadow));
});

test("the roadside layer skips ids without an asset and draws plants and props", () => {
  const some = new Float32Array([10, 0, 10, 0.5, 1, 40, 0, 40, 1.5, 1]);
  const layer = createRoadsideLayer({ ...plan, roadside: { picketFence: some, teapot: some, olive: some } }, options());
  assert.deepEqual([...new Set(layer.chunks.map((c) => c.id))].sort(), ["olive", "picketFence"]);
  assert.equal(layer.chunks.reduce((sum, c) => sum + c.count, 0), 4);
  layer.dispose();
});

test("the roadside layer draws only within its reach", () => {
  const layer = createRoadsideLayer({ ...plan, roadside: { olive: new Float32Array([10, 0, 10, 0, 1]) } }, options());
  layer.update(frameAt(10 + high.roadsideReach - 20, 10));
  assert.equal(layer.chunks[0].near.visible, true);
  layer.update(frameAt(10 + high.roadsideReach + 50, 10));
  assert.equal(layer.chunks[0].near.visible, false);
  assert.equal(layer.chunks[0].far.visible, false);
  layer.dispose();
});

test("grass follows the camera", () => {
  const layer = createGrassLayer(ground, plan, options());
  assert.equal(layer.rings.length, high.grassRings.length);
  layer.update(frameAt(100, 200));
  layer.update(frameAt(600, -300));
  for (const ring of layer.rings) assert.deepEqual(ring.uniforms.uCam.value.toArray(), [600, 30, -300]);
  layer.dispose();
});

test("grass grows on meadow and the rim of fields, not on roads, field insides, beaches or cliffs", () => {
  const weights = grassWeights(ground.near, plan.masks);
  const { near } = ground;
  let meadow = 0;
  let besideRoad = 0;
  for (let k = 0; k < weights.length; k += 1) {
    const x = near.x0 + (k % near.columns) * near.cell;
    const z = near.z0 + Math.floor(k / near.columns) * near.cell;
    const mask = maskAt(plan.masks, x, z);
    const rim = mask === MASK.field && !insideField(plan.masks, x, z);
    if (mask !== MASK.free && mask !== MASK.verge && mask !== MASK.meadow && !rim) assert.equal(weights[k], 0, `mask at ${x},${z}`);
    if (mask === MASK.verge && weights[k] > 0) besideRoad += 1;
    if (near.heights[k] < near.water + 3) assert.equal(weights[k], 0, "beach");
    if (near.normals[k * 3 + 1] < 0.8) assert.equal(weights[k], 0, "cliff");
    if (weights[k] > 0.99) meadow += 1;
  }
  assert.ok(meadow > 100, "some meadow");
  assert.ok(besideRoad > 20, "grass grows right up to the road's edge");
});

test("the grass is a carpet up to the road: dense rings, and the verge strip is green grass at full weight", () => {
  // the reference's high rings (roots per square metre): ours are at least as dense
  const reference = { low: [26, 8, 1.5, 0.3], medium: [33, 10, 2, 0.38], high: [40, 12, 2.4, 0.45], ultra: [52, 14, 2.8, 0.55] };
  for (const [level, dens] of Object.entries(reference)) {
    qualitySettings(level).grassRings.forEach((ring, i) => assert.ok(ring.dens >= dens[i], `${level} ring ${i}`));
  }
  const weights = grassWeights(ground.near, plan.masks);
  const { near } = ground;
  let verge = 0;
  let full = 0;
  for (let k = 0; k < weights.length; k += 1) {
    const x = near.x0 + (k % near.columns) * near.cell;
    const z = near.z0 + Math.floor(k / near.columns) * near.cell;
    if (maskAt(plan.masks, x, z) !== MASK.verge || near.heights[k] < near.water + 4 || near.normals[k * 3 + 1] < 0.9) continue;
    verge += 1;
    const [r, g, b] = near.colors.subarray(k * 3, k * 3 + 3);
    if (weights[k] > 0.99 && g > r && g > b) full += 1;
  }
  assert.ok(verge > 20, "verge cells on the fixture");
  assert.ok(full / verge > 0.8, `${full} of ${verge} verge cells are full green grass`);
});

test("the height sampler agrees with the grid at its vertices and between them", () => {
  const { near } = ground;
  const at = heightSampler(near);
  const k = near.columns * 5 + 7;
  assert.ok(Math.abs(at(near.x0 + 7 * near.cell, near.z0 + 5 * near.cell) - near.heights[k]) < 1e-4);
  const mid = at(near.x0 + 7.25 * near.cell, near.z0 + 5.25 * near.cell);
  const [lo, hi] = [Math.min(near.heights[k], near.heights[k + 1], near.heights[k + near.columns]), Math.max(near.heights[k], near.heights[k + 1], near.heights[k + near.columns])];
  assert.ok(mid >= lo - 1e-4 && mid <= hi + 1e-4);
});

test("one crop mesh per field, laid inside the field's corners", () => {
  assert.ok(plan.fields.length > 0, "the fixture has fields");
  const layer = createCropLayer(plan, { ...options(), ground });
  assert.equal(layer.fields.length, plan.fields.length);
  layer.fields.forEach((mesh, i) => {
    const box = new THREE.Box3().setFromObject(mesh);
    const { corners } = plan.fields[i];
    const xs = [0, 3, 6, 9].map((k) => corners[k]);
    const zs = [0, 3, 6, 9].map((k) => corners[k + 2]);
    assert.ok(box.min.x >= Math.min(...xs) - 1 && box.max.x <= Math.max(...xs) + 1, `field ${i} x`);
    assert.ok(box.min.z >= Math.min(...zs) - 1 && box.max.z <= Math.max(...zs) + 1, `field ${i} z`);
  });
  layer.dispose();
});

test("field extras are grouped by area so the camera culls them", () => {
  const field = (x) => ({ width: 120, depth: 80, x, z: 0, yaw: 0, crop: "pumpkin" });
  const fields = [field(0), field(2000)];
  const layer = createCropLayer({ fields }, { ...options(low), ground });
  const meshes = [];
  layer.object.traverse((o) => o.isInstancedMesh && o.name === "pumpkins" && meshes.push(o));
  assert.ok(meshes.length >= 2, "one mesh per area");
  for (const mesh of meshes) assert.ok(mesh.boundingSphere.radius < 400, "a small bounding sphere");
  const SEED = 0x51f15e;
  const random = seededRandom(SEED);
  const heightAt = heightSampler(ground.near);
  const expected = fields.reduce((n, f) => n + fieldExtras({ ...f, heightAt, random }).pumpkins.length, 0);
  assert.ok(expected > 0);
  assert.equal(meshes.reduce((n, m) => n + m.count, 0), expected);
  layer.dispose();
});

test("bales and pumpkins are drawn only within the quality's reach of the camera", () => {
  const field = (x, crop) => ({ width: 120, depth: 80, x, z: 0, yaw: 0, crop });
  const layer = createCropLayer({ fields: [field(0, "pumpkin"), field(1000, "pumpkin"), field(0, "stubble"), field(1000, "stubble")] }, { ...options(low), ground });
  const extras = [];
  layer.object.traverse((o) => o.isInstancedMesh && ["pumpkins", "bales"].includes(o.name) && extras.push(o));
  assert.ok(extras.length >= 4, "cells of both kinds");
  assert.equal(low.cropExtras.reach, 300);
  layer.update(frameAt(100, 0));
  for (const mesh of extras) {
    const { center, radius } = mesh.boundingSphere;
    const gap = Math.hypot(center.x - 100, center.z) - radius;
    if (gap < 300 - 1) assert.equal(mesh.visible, true, `${mesh.name} at ${Math.round(center.x)} is near`);
    if (gap > 300 + 1) assert.equal(mesh.visible, false, `${mesh.name} at ${Math.round(center.x)} is far`);
  }
  assert.ok(extras.some((m) => m.visible) && extras.some((m) => !m.visible), "near ones drawn, far ones not");
  layer.update(frameAt(1000, 0));
  assert.ok(extras.some((m) => m.visible && m.boundingSphere.center.x > 500), "the far cells come back near");
  layer.dispose();
});

test("every plant layer frees what it made", () => {
  const tracker = createTracker();
  const layers = [
    createForestLayer(plan, options(high, { track: tracker.track })),
    createRoadsideLayer(plan, options(high, { track: tracker.track })),
    createGrassLayer(ground, plan, options(high, { track: tracker.track })),
    createCropLayer(plan, { ...options(high, { track: tracker.track }), ground }),
  ];
  assert.ok(tracker.live() > 0);
  for (const layer of layers) layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("the world scene draws the plan, and a season switch rebuilds without leaking", () => {
  const tracker = createTracker();
  const scene = createWorldScene({ ground, plan, season: "summer" }, { settings: high, track: tracker.track });
  scene.setEnvironment(environmentAt(resolvePreset("day"), "summer"));
  for (const name of ["forest", "crops", "roadside", "grass"]) assert.ok(scene.scene.getObjectByName(name), name);
  const before = tracker.live();
  const forest = scene.scene.getObjectByName("forest");
  scene.setSeason("summer", plan);
  assert.equal(tracker.live(), before, "same season, same resources");
  scene.setSeason("winter", plan);
  assert.notEqual(scene.scene.getObjectByName("forest"), forest, "forest replaced");
  assert.ok(tracker.live() > 0);
  scene.update(frameAt(0, 0));
  scene.dispose();
  assert.equal(tracker.live(), 0);
});

test("a quality change rebuilds the plant layers to the new level", () => {
  const tracker = createTracker();
  const scene = createWorldScene({ ground, plan, season: "summer" }, { settings: high, track: tracker.track });
  const blades = () => scene.scene.getObjectByName("grass").children.reduce((sum, ring) => sum + ring.geometry.instanceCount, 0);
  const wanted = (settings) => settings.grassRings.reduce((sum, ring) => sum + Math.max(1, Math.round(ring.dens * ring.r * 2 * ring.r * 2)), 0);
  assert.equal(blades(), wanted(high));
  scene.setQuality(low);
  assert.equal(blades(), wanted(low));
  scene.dispose();
  assert.equal(tracker.live(), 0);
});

test("a world without a plan still builds", () => {
  const scene = createWorldScene({ ground }, { settings: high, track: createTracker().track });
  assert.equal(scene.scene.getObjectByName("forest"), undefined);
  scene.setSeason("autumn", undefined);
  scene.dispose();
});

test("grass grows on a pasture parcel's cells and not on an arable parcel's", () => {
  const cell = 4;
  const masks = { cell, x0: -200, z0: -200, columns: 100, rows: 100, data: new Uint8Array(100 * 100) };
  stampField(masks, { x: -100, z: 0, width: 120, depth: 120, yaw: 0 }, MASK.meadow);
  stampField(masks, { x: 100, z: 0, width: 120, depth: 120, yaw: 0 });
  const grid = { x0: -200, z0: -200, cell, columns: 100, rows: 100, heights: new Float32Array(10000).fill(20), normals: Float32Array.from({ length: 30000 }, (_, k) => (k % 3 === 1 ? 1 : 0)), water: 0 };
  const weights = grassWeights(grid, masks);
  const at = (x, z) => weights[Math.round((z + 200) / cell) * 100 + Math.round((x + 200) / cell)];
  assert.equal(at(-100, 0), 1, "pasture");
  assert.equal(at(100, 0), 0, "arable");
});
