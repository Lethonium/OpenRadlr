/** Fauna layer: instanced animals that are re-posed only near the camera. */
import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { QUALITY_LEVELS, qualitySettings } from "../public/js/view3d/quality.js";
import { createFaunaLayer } from "../public/js/view3d/scene/faunaLayer.js";
import { butterflyPose, dolphinPose, flockPose, grazePose } from "../public/js/view3d/scene/faunaMotion.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const world = valleyWorld();
const plan = planOf(world);
const ground = buildGroundGrids(world.terrain, groundExtent(world.terrain), { season: "summer", long: false, regions: world.regions, masks: plan.masks });
const day = environmentAt(resolvePreset("day"), "summer");
const night = environmentAt(resolvePreset("night"), "summer");
const rain = environmentAt(resolvePreset("day"), "summer", { weather: { kind: "rain", strength: 1 }, precipitation: 1 });

const make = (level = "high", track = createTracker().track) =>
  createFaunaLayer(plan, { season: "summer", settings: qualitySettings(level), uniforms: createSharedUniforms(), track, ground });
const frameAt = (x, z, extra = {}) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, 30, z);
  camera.updateMatrixWorld();
  return { dt: 0.016, t: 1, camera, focus: [x, 0, z], ...extra };
};
const meshes = (layer) => layer.object.children.filter((child) => child.isInstancedMesh);
const bodyOf = (layer, kind) => layer.object.getObjectByName(`${kind}-body`);

test("a grazing cow stays inside its herd radius", () => {
  const herd = { kind: "cow", x: 100, z: -50, radius: 12, count: 6, seed: 7 };
  for (let i = 0; i < 6; i += 1) {
    for (let t = 0; t < 3000; t += 7.3) {
      const pose = grazePose({ ...herd, seed: herd.seed + i, speed: 0.8 }, t);
      assert.ok(Math.hypot(pose.x - herd.x, pose.z - herd.z) <= herd.radius, `animal ${i} at t=${t}`);
    }
  }
});

test("poses are pure functions of time", () => {
  const animal = { kind: "sheep", x: 1, z: 2, radius: 10, seed: 3, speed: 0.6 };
  assert.deepEqual(grazePose(animal, 41.5), grazePose(animal, 41.5));
  const flock = { x: 0, z: 0, altitude: 60, radius: 30, count: 6, seed: 4 };
  assert.deepEqual(flockPose(flock, 2, 9, 12), flockPose(flock, 2, 9, 12));
  assert.deepEqual(dolphinPose({ x: 0, z: 0, seed: 5 }, 17), dolphinPose({ x: 0, z: 0, seed: 5 }, 17));
  assert.deepEqual(butterflyPose({ x: 0, z: 0, seed: 6 }, 3), butterflyPose({ x: 0, z: 0, seed: 6 }, 3));
});

test("a dolphin jumps above the water and dives below it", () => {
  const heights = [];
  for (let t = 0; t < 60; t += 0.25) heights.push(dolphinPose({ x: 0, z: 0, seed: 5 }, t).y);
  assert.ok(Math.max(...heights) > 1, "clears the surface");
  assert.ok(Math.min(...heights) < 0, "dives under it");
});

test("only nearby animals are re-posed", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  const herd = plan.fauna.herds[0];
  layer.update(frameAt(herd.x, herd.z, { t: 1 }));
  assert.ok(layer.posed > 0, "the first frame poses the animals near the camera");
  const reach = qualitySettings("high").animals.animateReach;
  const total = layer.total;
  assert.ok(layer.posed < total, "not every animal");
  layer.update(frameAt(herd.x, herd.z, { t: 1.5 }));
  const near = layer.posed;
  layer.update(frameAt(1e6, 1e6, { t: 2 }));
  assert.equal(layer.posed, 0, `nothing within ${reach} m of a far camera`);
  assert.ok(near > 0);
  layer.dispose();
});

test("animals stand on the ground", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  const herd = plan.fauna.herds[0];
  layer.update(frameAt(herd.x, herd.z));
  const body = bodyOf(layer, herd.kind);
  const m = new THREE.Matrix4();
  body.getMatrixAt(0, m);
  const y = new THREE.Vector3().setFromMatrixPosition(m).y;
  assert.ok(Math.abs(y - layer.groundAt(new THREE.Vector3().setFromMatrixPosition(m).x, new THREE.Vector3().setFromMatrixPosition(m).z)) < 0.01);
  layer.dispose();
});

test("butterflies and birds rest at night, walkers sleep, dolphins swim on", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  const visible = (kind) => bodyOf(layer, kind)?.visible;
  assert.equal(visible("bird"), true);
  assert.equal(visible("cow"), true);
  layer.setEnvironment(night);
  assert.equal(visible("bird"), false);
  assert.equal(visible("butterfly") ?? false, false);
  assert.equal(visible("cow"), false);
  assert.equal(visible("dolphin"), true);
  layer.setEnvironment(rain);
  assert.equal(visible("bird"), false, "birds shelter in rain");
  assert.equal(visible("cow"), true);
  layer.dispose();
});

test("each level re-poses a wider ring and low keeps the fewest animals", () => {
  assert.deepEqual(QUALITY_LEVELS.map((l) => qualitySettings(l).animals.animateReach), [60, 120, 200, 300]);
  const totals = ["low", "medium"].map((detail) => createFaunaLayer(planOf(world, { detail }), { season: "summer", settings: qualitySettings(detail), track: createTracker().track, ground }).total);
  assert.ok(totals[0] < totals[1], `low ${totals[0]} < medium ${totals[1]}`);
});

test("the fauna layer disposes everything after a season and quality switch", () => {
  const tracker = createTracker();
  const layer = make("high", tracker.track);
  layer.setEnvironment(day);
  layer.update(frameAt(plan.fauna.herds[0].x, plan.fauna.herds[0].z));
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
  assert.ok(meshes(layer).length === 0);
});
