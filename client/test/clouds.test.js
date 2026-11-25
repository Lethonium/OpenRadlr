/** The puffy clouds: seeded placement high above the route, the geometry built from it, and the layer that draws them. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { planClouds } from "../public/js/world/clouds.js";
import { cloudGeometry } from "../public/js/view3d/assets/cloud.js";
import { cloudTint, createCloudLayer } from "../public/js/view3d/scene/cloudLayer.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { sceneOf, transferList } from "../public/js/view3d/worldScene.js";
import { temperate } from "../public/js/view3d/biomes/index.js";
import { winter } from "../public/js/view3d/biomes/winter/index.js";
import { groundFixture } from "./support/groundFixture.js";
import { squareRoute } from "./helpers.js";

const world = buildWorld(squareRoute());
const { index } = world.terrain;
const plan = (biome, extra = {}) => planClouds({ seed: 7, center: index.center, meanElevation: index.meanElevation, style: biome.sky.clouds, ...extra });
const vertices = (geometry) => geometry.attributes.position.count;
const env = (key, options) => environmentAt(resolvePreset(key), "summer", options);

test("cloud placement is seeded: the same map gets the same sky", () => {
  assert.deepEqual(plan(temperate), plan(temperate));
  assert.notDeepEqual(plan(temperate), planClouds({ seed: 8, center: index.center, meanElevation: index.meanElevation, style: temperate.sky.clouds }));
});

test("clouds float high above the route, out of a rider's reach", () => {
  const built = plan(temperate);
  assert.equal(built.shapes.length, temperate.sky.clouds.count);
  for (const { puffs } of built.shapes) {
    for (const { at, radii } of puffs) assert.ok(at[1] - radii[1] > index.meanElevation + 200, "well above the road");
  }
  const geometry = cloudGeometry(built);
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.min.y > index.meanElevation + 200);
  geometry.dispose();
});

test("winter builds more cloud shapes", () => {
  const warm = cloudGeometry(plan(temperate, { count: 4 }));
  const cold = cloudGeometry(plan(winter, { count: 4 }));
  assert.ok(vertices(cold) > vertices(warm));
  assert.ok(plan(winter).shapes.length > plan(temperate).shapes.length, "and more clouds");
});

test("the world's scene carries its clouds across the worker", () => {
  const scene = sceneOf(world);
  assert.ok(scene.clouds.shapes.length > 0);
  assert.doesNotThrow(() => structuredClone(scene.clouds));
  assert.ok(transferList(scene).every((b) => b instanceof ArrayBuffer));
  assert.deepEqual(scene.clouds, buildWorld(squareRoute()).clouds, "the same map gives the same clouds");
});

test("the cloud layer is one mesh, one draw call, and casts no shadow", () => {
  const tracker = createTracker();
  const layer = createCloudLayer(plan(temperate), { settings: qualitySettings("high"), track: tracker.track });
  const meshes = [];
  layer.object.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].castShadow, false);
  assert.equal(meshes[0].material.fog, true, "fogged");
  layer.dispose();
  assert.equal(tracker.live(), 0, "nothing leaks");
});

test("the environment tints the clouds: white by day, warm at sunset, dark by night, grey under cloud", () => {
  const sum = (c) => c[0] + c[1] + c[2];
  const day = cloudTint(env("day"));
  assert.ok(day.every((v) => v > 0.95), "white by day");
  const golden = cloudTint(env("golden"));
  assert.ok(golden[0] > golden[2], "warm at sunset");
  assert.ok(sum(cloudTint(env("night"))) < sum(day) * 0.4, "dark by night");
  const grey = cloudTint(env("day", { weather: { kind: "rain", strength: 1 } }));
  assert.ok(sum(grey) < sum(day), "greyer under cloud");
  const tracker = createTracker();
  const layer = createCloudLayer(plan(temperate), { settings: qualitySettings("high"), track: tracker.track });
  layer.setEnvironment(env("night"));
  const mesh = layer.object.children[0];
  assert.ok(mesh.material.color.r < 0.4);
  layer.dispose();
});

test("a world scene draws the clouds, and rebuilds them with the quality", () => {
  const tracker = createTracker();
  const scene = createWorldScene({ ground: groundFixture(), clouds: plan(temperate) }, { settings: qualitySettings("high"), track: tracker.track });
  scene.setEnvironment(env("day"));
  const count = () => scene.scene.getObjectByName("clouds").children[0].geometry.attributes.position.count;
  const fine = count();
  scene.setQuality(qualitySettings("low"));
  assert.ok(count() < fine, "a cheaper cloud on slow machines");
  scene.dispose();
  const bare = createWorldScene({ ground: groundFixture() }, { settings: qualitySettings("high"), track: createTracker().track });
  assert.equal(bare.scene.getObjectByName("clouds").children.length, 0, "no clouds planned, none drawn");
});
