import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createIslandLayer } from "../public/js/view3d/scene/islandLayer.js";
import { createLandmarkLayer } from "../public/js/view3d/scene/landmarkLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const world = valleyWorld();
const plan = planOf(world);
const ground = buildGroundGrids(world.terrain, groundExtent(world.terrain), { season: "summer", long: false, regions: world.regions, masks: plan.masks });
const day = environmentAt(resolvePreset("day"), "summer");
const night = environmentAt(resolvePreset("night"), "summer");

const options = (level = "high", extra = {}) => ({ season: "summer", settings: qualitySettings(level), uniforms: createSharedUniforms(), track: extra.track ?? createTracker().track, ground, ...extra });
const frameAt = (x, z, t = 1) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, 40, z);
  camera.updateMatrixWorld();
  return { dt: 0.016, t, camera, focus: [x, 0, z] };
};
const of = (kind) => plan.landmarks.find((l) => l.kind === kind);

test("balloons move with the clock and repeat", () => {
  const layer = createLandmarkLayer(plan, options());
  assert.equal(layer.balloons.length, of("balloons").members.length);
  const balloon = layer.balloons[0];
  const member = of("balloons").members[0];
  const at = (t) => {
    layer.update(frameAt(0, 0, t));
    return balloon.mesh.position.clone();
  };
  const first = at(10);
  const later = at(60);
  assert.ok(Math.hypot(later.x - first.x, later.z - first.z) > 10, "it drifts");
  const lap = (2 * Math.PI) / Math.abs(member.speed);
  const again = at(10 + lap);
  assert.ok(Math.hypot(again.x - first.x, again.z - first.z) < 0.5, "a lap later it is back");
  assert.ok(first.y > 200 && first.y < 500, "it flies high");
  layer.dispose();
});

test("a windmill's sails turn and the lighthouse lamp glows by night", () => {
  const layer = createLandmarkLayer(plan, options());
  const mill = of("windmills").members[0];
  layer.update(frameAt(mill.x + 40, mill.z, 1));
  const sails = layer.turners[0].mesh;
  const a = sails.quaternion.clone();
  layer.update(frameAt(mill.x + 40, mill.z, 2));
  assert.ok(a.angleTo(sails.quaternion) > 0.01, "the sails turn");
  const light = layer.landmarks.find((l) => l.kind === "lighthouse");
  layer.setEnvironment(day);
  layer.update(frameAt(light.x + 30, light.z, 1));
  assert.equal(light.glow.visible, false);
  layer.setEnvironment(night);
  layer.update(frameAt(light.x + 30, light.z, 1));
  assert.ok(light.glow.visible && light.glow.material.color.r > 0.1, "lit at night");
  layer.dispose();
});

test("the scene has towns, farms, landmarks and islands on the valley", () => {
  const scene = createWorldScene({ ground, plan, season: "summer" }, { settings: qualitySettings("high"), track: createTracker().track });
  for (const name of ["settlements", "farms", "landmarks", "islands"]) assert.ok(scene.scene.getObjectByName(name), name);
  assert.ok(plan.islands.length >= 8);
  assert.equal(scene.scene.getObjectByName("islands").children.length > 0, true);
  scene.dispose();
});

test("the world no longer carries rotors or island meshes", async () => {
  const { buildWorld } = await import("../public/js/view3d/world.js");
  const { sceneOf } = await import("../public/js/view3d/worldScene.js");
  const { RouteGeometry } = await import("../public/js/route/geometry.js");
  const tiny = new RouteGeometry({ id: "tiny", name: "Tiny", lanes: 2, seed: 3, points: [[0, 0, 50], [400, 0, 50], [400, 400, 55], [0, 400, 55]], zones: [] });
  const built = buildWorld(tiny);
  assert.equal("rotors" in built, false);
  assert.equal("islands" in built, false);
  assert.equal("rotors" in sceneOf(built), false);
});

test("landmark and island layers dispose everything", () => {
  const tracker = createTracker();
  const scene = createWorldScene({ ground, plan, season: "summer" }, { settings: qualitySettings("high"), track: tracker.track });
  scene.setEnvironment(day);
  const [cx, cz] = plan.settlements.find((s) => s.kind === "city").center;
  scene.update({ ...frameAt(cx, cz, 3), focus: [cx, 0, cz] });
  const before = tracker.live();
  scene.setSeason("winter", plan);
  scene.setQuality(qualitySettings("low"));
  scene.setQuality(qualitySettings("high"));
  scene.setSeason("summer", plan);
  assert.equal(tracker.live(), before, "a switch frees what it replaced");
  scene.dispose();
  assert.equal(tracker.live(), 0);
  for (const make of [createLandmarkLayer, createIslandLayer]) {
    const own = createTracker();
    const layer = make(plan, options("medium", { track: own.track }));
    layer.dispose();
    assert.equal(own.live(), 0, make.name);
  }
});
