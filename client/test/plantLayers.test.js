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
import { MASK, maskAt } from "../public/js/world/plan/masks.js";
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

test("the roadside layer skips props without a plant and draws the rest", () => {
  const some = new Float32Array([10, 0, 10, 0.5, 1, 40, 0, 40, 1.5, 1]);
  const layer = createRoadsideLayer({ ...plan, roadside: { picketFence: some, mailbox: some, olive: some } }, options());
  assert.deepEqual([...new Set(layer.chunks.map((c) => c.id))], ["olive"]);
  assert.equal(layer.chunks.reduce((sum, c) => sum + c.count, 0), 2);
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

test("grass grows on meadow, not on roads, fields, beaches or cliffs", () => {
  const weights = grassWeights(ground.near, plan.masks);
  const { near } = ground;
  let meadow = 0;
  for (let k = 0; k < weights.length; k += 1) {
    const x = near.x0 + (k % near.columns) * near.cell;
    const z = near.z0 + Math.floor(k / near.columns) * near.cell;
    if (maskAt(plan.masks, x, z) !== MASK.free) assert.equal(weights[k], 0, `mask at ${x},${z}`);
    if (near.heights[k] < near.water + 3) assert.equal(weights[k], 0, "beach");
    if (near.normals[k * 3 + 1] < 0.8) assert.equal(weights[k], 0, "cliff");
    if (weights[k] > 0.99) meadow += 1;
  }
  assert.ok(meadow > 100, "some meadow");
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
