/** Fauna layer: instanced animals that are re-posed only near the camera. */
import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "../public/js/three.js";
import { CREATURES } from "../public/js/view3d/assets/creatures/index.js";
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
const bodiesOf = (layer, kind) => layer.object.children.filter((child) => child.isInstancedMesh && new RegExp(`^${kind}-(\\d-)?body$`).test(child.name));
const bodyOf = (layer, kind) => bodiesOf(layer, kind)[0];
const solid = (mesh, i) => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return m.elements[12] !== 0 || m.elements[14] !== 0; // a fresh instance is the identity, at the origin
};

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

test("a dolphin jumps clear of the water now and then", () => {
  const heights = [];
  for (let t = 0; t < 60; t += 0.25) heights.push(dolphinPose({ x: 0, z: 0, seed: 5 }, t).y);
  assert.ok(Math.max(...heights) > 1, "clears the surface");
});

test("a dolphin swims along the surface: most of the time its back is above the water", () => {
  const { body } = CREATURES.dolphin.parts({ detail: true });
  body.computeBoundingBox();
  const half = (body.boundingBox.max.y - body.boundingBox.min.y) / 2;
  for (const seed of [5, 11, 23]) {
    let above = 0;
    let samples = 0;
    for (let t = 0; t < 120; t += 0.25) {
      samples += 1;
      if (dolphinPose({ x: 0, z: 0, seed }, t).y + half > 0.25) above += 1;
    }
    assert.ok(above / samples >= 0.6, `seed ${seed}: ${above}/${samples}`);
  }
});

test("a group of animals all far from the camera has its meshes hidden, one near is drawn and culled by a sphere round its animals", () => {
  const layer = make("low");
  layer.setEnvironment(day);
  const herd = plan.fauna.herds[0];
  layer.update(frameAt(1e5, 1e5));
  for (const mesh of meshes(layer)) assert.equal(mesh.visible, false, `${mesh.name} far away`);
  layer.update(frameAt(herd.x, herd.z));
  const bodies = bodiesOf(layer, herd.kind).filter((mesh) => mesh.visible);
  assert.ok(bodies.length > 0, "the herd's kind is drawn near");
  for (const body of bodies) {
    assert.equal(body.frustumCulled, true, body.name);
    const sphere = body.boundingSphere;
    assert.ok(sphere, `${body.name} has a sphere`);
    const m = new THREE.Matrix4();
    for (let i = 0; i < body.count; i += 1) {
      body.getMatrixAt(i, m);
      const at = new THREE.Vector3().setFromMatrixPosition(m);
      assert.ok(sphere.center.distanceTo(at) <= sphere.radius + 1e-6, `${body.name} animal ${i} inside`);
    }
  }
  assert.ok(meshes(layer).some((mesh) => !mesh.visible), "groups far from this herd stay hidden");
  layer.dispose();
});

test("above Low the animals are drawn from any distance", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  layer.update(frameAt(1e6, 1e6));
  assert.ok(meshes(layer).every((mesh) => mesh.visible));
  layer.dispose();
});

test("night still hides a group that is near", () => {
  const layer = make("low");
  const herd = plan.fauna.herds[0];
  layer.setEnvironment(night);
  layer.update(frameAt(herd.x, herd.z));
  for (const mesh of bodiesOf(layer, herd.kind)) assert.equal(mesh.visible, false);
  layer.dispose();
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

test("every animal is drawn from the start, far ones too", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  const bodies = layer.object.children.filter((child) => child.isInstancedMesh && child.name.endsWith("body"));
  assert.equal(bodies.reduce((sum, mesh) => sum + mesh.count, 0), layer.total);
  for (const mesh of bodies) for (let i = 0; i < mesh.count; i += 1) assert.ok(solid(mesh, i), `${mesh.name} ${i}`);
  layer.dispose();
});

test("a kind with coats is split over at most three instanced groups", () => {
  const layer = make("high");
  for (const kind of ["cow", "sheep", "horse", "pig", "chicken", "deer", "bird"]) {
    const groups = bodiesOf(layer, kind).length;
    assert.ok(groups <= (["deer", "bird"].includes(kind) ? 1 : 3), `${kind}: ${groups}`);
  }
  assert.ok(bodiesOf(layer, "cow").length > 1, "cows come in more than one coat");
  layer.dispose();
});

test("animals stand on the ground", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  const herd = plan.fauna.herds[0];
  layer.update(frameAt(herd.x, herd.z));
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const body of bodiesOf(layer, herd.kind)) {
    for (let i = 0; i < body.count; i += 1) {
      body.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      assert.ok(Math.abs(p.y - layer.groundAt(p.x, p.z)) < 0.01);
    }
  }
  layer.dispose();
});

test("butterflies and birds rest at night, walkers sleep, dolphins swim on", () => {
  const layer = make("high");
  layer.setEnvironment(day);
  const visible = (kind) => bodyOf(layer, kind)?.visible;
  assert.ok(bodiesOf(layer, "cow").every((mesh) => mesh.visible === true));
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
  assert.deepEqual(QUALITY_LEVELS.map((l) => qualitySettings(l).animals.drawReach), [250, Infinity, Infinity, Infinity]);
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

test("dolphins swim in pods, a few to each spot", () => {
  const fauna = { dolphins: [{ x: 0, z: 0, seed: 7 }] };
  const layer = createFaunaLayer({ fauna }, { season: "summer", settings: qualitySettings("high"), track: createTracker().track, ground });
  assert.equal(layer.total, 3);
});
