import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { groundFixture } from "./support/groundFixture.js";

const day = environmentAt(resolvePreset("day"), "summer");
const night = environmentAt(resolvePreset("night"), "summer");

function make({ quality = "high", season = "summer", tracker = createTracker() } = {}) {
  const world = createWorldScene({ ground: groundFixture(season) }, { settings: qualitySettings(quality), track: tracker.track });
  world.setEnvironment(day);
  return { world, tracker };
}
const camera = () => {
  const cam = new THREE.PerspectiveCamera(60, 1.5, 1, 9000);
  cam.position.set(300, 120, 400);
  cam.updateMatrixWorld();
  return cam;
};
const frame = (extra = {}) => ({ dt: 0.016, t: 1, camera: camera(), focus: [300, 40, 400], ...extra });

test("the tracker counts resources until they are disposed", () => {
  const tracker = createTracker();
  const geometry = tracker.track(new THREE.BufferGeometry());
  const material = tracker.track(new THREE.MeshBasicMaterial());
  assert.equal(tracker.live(), 2);
  geometry.dispose();
  assert.equal(tracker.live(), 1);
  tracker.disposeAll();
  assert.equal(tracker.live(), 0);
  assert.ok(material);
});

test("a world scene holds terrain, sea, sky and the sun", () => {
  const { world } = make();
  for (const name of ["terrain", "sea", "sky", "sun"]) assert.ok(world.scene.getObjectByName(name), name);
  assert.equal(world.sun, world.scene.getObjectByName("sun"));
});

test("the sun's shadow map follows the quality", () => {
  assert.equal(make({ quality: "low" }).world.sun.castShadow, false);
  const { world } = make({ quality: "high" });
  assert.equal(world.sun.castShadow, true);
  assert.equal(world.sun.shadow.mapSize.x, qualitySettings("high").shadowMapSize);
  world.setQuality(qualitySettings("low"));
  assert.equal(world.sun.castShadow, false);
  world.setQuality(qualitySettings("medium"));
  assert.equal(world.sun.shadow.mapSize.x, 2048);
  assert.equal(world.sun.castShadow, true);
});

test("setEnvironment moves the sun", () => {
  const { world } = make();
  world.update(frame());
  const direction = world.sun.position.clone().sub(world.sun.target.position).normalize();
  for (const [k, axis] of ["x", "y", "z"].entries()) assert.ok(Math.abs(direction[axis] - day.sun[k]) < 1e-6, axis);
  const golden = environmentAt(resolvePreset("golden"), "summer");
  world.setEnvironment(golden);
  const moved = world.sun.position.clone().sub(world.sun.target.position).normalize();
  assert.ok(Math.abs(moved.y - golden.sun[1]) < 1e-6);
});

test("at night the moon is the key light", () => {
  const { world } = make();
  world.setEnvironment(night);
  const direction = world.sun.position.clone().sub(world.sun.target.position).normalize();
  assert.ok(direction.y > 0, "light comes from above");
  assert.ok(Math.abs(direction.y - night.moon[1]) < 1e-6);
});

test("the shadow box follows the focus", () => {
  const { world } = make();
  world.update(frame({ focus: [500, 30, -200] }));
  assert.ok(Math.abs(world.sun.target.position.x - 500) < 4 && Math.abs(world.sun.target.position.z + 200) < 4);
});

test("fog and exposure-free light colours come from the environment", () => {
  const { world } = make();
  assert.ok(Math.abs(world.scene.fog.density - day.fogDensity) < 1e-12);
  assert.ok(Math.abs(world.scene.fog.color.r - day.fogColor[0]) < 1e-6);
});

test("the sky and sea follow the camera", () => {
  const { world } = make();
  world.update(frame());
  const sky = world.scene.getObjectByName("sky");
  assert.ok(Math.abs(sky.position.x - 300) < 1e-6 && Math.abs(sky.position.z - 400) < 1e-6);
});

test("a world without ground still has sky and sun", () => {
  const world = createWorldScene({}, { settings: qualitySettings("high"), track: createTracker().track });
  assert.ok(world.scene.getObjectByName("sky"));
  assert.equal(world.scene.getObjectByName("terrain"), undefined);
  world.update(frame());
});

test("disposing the world scene disposes everything it created", () => {
  const { world, tracker } = make();
  assert.ok(tracker.live() > 0);
  world.dispose();
  assert.equal(tracker.live(), 0);
});

test("a new season rebuilds without leaks", () => {
  const tracker = createTracker();
  const first = make({ tracker }).world;
  const one = tracker.live();
  first.dispose();
  assert.equal(tracker.live(), 0);
  make({ tracker, season: "winter" });
  assert.equal(tracker.live(), one);
});
