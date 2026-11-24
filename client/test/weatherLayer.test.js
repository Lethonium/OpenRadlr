import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { ROAD_LIFT } from "../public/js/world/roads.js";
import { roadStrips } from "../public/js/world/plan/roadStrips.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { roadStyle } from "../public/js/view3d/roadStyle.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createRoadLayer } from "../public/js/view3d/scene/roadLayer.js";
import { createSky } from "../public/js/view3d/scene/sky.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWeatherLayer } from "../public/js/view3d/scene/weatherLayer.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { squareRoute } from "./helpers.js";
import { groundFixture } from "./support/groundFixture.js";

const preset = resolvePreset("day");
const env = (kind, strength = 1, precipitation) => environmentAt(preset, kind === "snow" ? "winter" : "summer", { weather: { kind, strength }, precipitation });
const make = (level = "high") => {
  const tracker = createTracker();
  const layer = createWeatherLayer({ settings: qualitySettings(level), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const named = (layer, name) => layer.object.getObjectByName(name);
const drawn = (layer, name) => {
  const part = named(layer, name);
  return part.visible ? part.geometry.drawRange.count : 0;
};
const camera = () => new THREE.PerspectiveCamera(60, 1.5, 1, 9000);
const frame = (t, dt = 0.05) => ({ dt, t, camera: camera(), focus: [0, 0, 0] });

test("no drops are drawn in clear weather", () => {
  const { layer } = make();
  layer.setEnvironment(env("clear"));
  assert.equal(drawn(layer, "rain"), 0);
  assert.equal(drawn(layer, "snow"), 0);
});

test("rain draws its share of the level's drops", () => {
  const { layer } = make("high");
  layer.setEnvironment(env("rain", 0.5));
  assert.equal(drawn(layer, "rain"), Math.floor(qualitySettings("high").weather.rain * 0.5) * 2, "two vertices per streak");
  assert.equal(drawn(layer, "snow"), 0);
});

test("snow falls only when it snows", () => {
  const { layer } = make("high");
  layer.setEnvironment(env("snow", 1));
  assert.equal(drawn(layer, "snow"), qualitySettings("high").weather.snow);
  assert.equal(drawn(layer, "rain"), 0);
  layer.setEnvironment(env("rain", 1));
  assert.equal(drawn(layer, "snow"), 0);
});

test("low draws fewer drops than medium", () => {
  const low = make("low").layer;
  const medium = make("medium").layer;
  for (const layer of [low, medium]) layer.setEnvironment(env("storm", 1));
  assert.ok(drawn(low, "rain") < drawn(medium, "rain"));
  assert.ok(qualitySettings("low").weather.snow < qualitySettings("medium").weather.snow);
});

test("a storm flashes and fades", () => {
  const { layer } = make();
  layer.setEnvironment(env("storm", 1));
  const seen = [];
  for (let t = 0; t < 40; t += 0.05) {
    layer.update(frame(t));
    seen.push(layer.flash);
  }
  assert.equal(Math.max(...seen), 1, "a bolt");
  assert.ok(seen.some((f) => f > 0 && f < 1), "that fades over several frames");
  assert.equal(seen[0], 0, "not at once");
  const flashes = seen.filter((f, i) => f === 1 && seen[i - 1] !== 1).length;
  assert.ok(flashes >= 2 && flashes <= 7, `one every 6-14 s (${flashes})`);
  layer.setEnvironment(env("rain", 1));
  layer.update(frame(41));
  layer.update(frame(42));
  assert.equal(layer.flash, 0, "no thunder without a storm");
});

test("the weather layer disposes everything", () => {
  const { layer, tracker } = make();
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("wet roads are darker", () => {
  const tracker = createTracker();
  const roads = { strips: roadStrips(squareRoute(), { lift: ROAD_LIFT.ridden }), style: roadStyle(resolveBiome("temperate")), posts: null };
  const layer = createRoadLayer(roads, { uniforms: createSharedUniforms(), track: tracker.track });
  const surface = layer.object.children.find((m) => m.name === "road-surface").material;
  layer.setEnvironment(env("clear"));
  const dry = { luminance: surface.color.r + surface.color.g + surface.color.b, roughness: surface.roughness };
  layer.setEnvironment(env("rain", 1));
  assert.ok(surface.color.r + surface.color.g + surface.color.b < dry.luminance, "darker");
  assert.ok(surface.roughness < dry.roughness, "glossier");
  layer.dispose();
});

test("the sky clouds over with the weather", () => {
  const tracker = createTracker();
  const sky = createSky({ uniforms: createSharedUniforms(), track: tracker.track });
  sky.setEnvironment(env("clear"));
  assert.equal(sky.object.material.uniforms.uCloudy.value, 0);
  const storm = env("storm", 1);
  sky.setEnvironment(storm);
  assert.equal(sky.object.material.uniforms.uCloudy.value, storm.overcast);
  sky.dispose();
});

test("a lightning flash brightens the hemisphere for a moment", () => {
  const world = createWorldScene({ ground: groundFixture("summer") }, { settings: qualitySettings("low"), track: createTracker().track });
  world.setEnvironment(env("storm", 1));
  const hemisphere = world.scene.getObjectByName("hemisphere");
  const base = hemisphere.intensity;
  let peak = base;
  for (let t = 0; t < 30; t += 0.05) {
    world.update({ dt: 0.05, t, camera: camera(), focus: [0, 0, 0] });
    peak = Math.max(peak, hemisphere.intensity);
  }
  assert.ok(peak > base, "flash");
  world.update({ dt: 0.05, t: 31, camera: camera(), focus: [0, 0, 0] });
  world.setEnvironment(env("clear"));
  world.update({ dt: 1, t: 33, camera: camera(), focus: [0, 0, 0] });
  assert.equal(hemisphere.intensity, base, "back to normal");
  world.dispose();
});
