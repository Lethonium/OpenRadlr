import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { asphaltTexture } from "../public/js/view3d/assets/road.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createRiverLayer } from "../public/js/view3d/scene/riverLayer.js";
import { createRoadLayer } from "../public/js/view3d/scene/roadLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { buildBridges } from "../public/js/view3d/bridges.js";
import { roadStyle } from "../public/js/view3d/roadStyle.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { ROAD_LIFT } from "../public/js/world/roads.js";
import { riverStrips } from "../public/js/world/plan/riverStrips.js";
import { roadStrips } from "../public/js/world/plan/roadStrips.js";
import { squareRoute } from "./helpers.js";
import { tinyWorld } from "./support/planFixture.js";

const high = qualitySettings("high");
const biome = resolveBiome("temperate");
const world = tinyWorld();
const roads = () => ({ strips: roadStrips(squareRoute(), { lift: ROAD_LIFT.ridden }), style: roadStyle(biome), posts: null });
const rivers = (b = biome) => ({ strips: riverStrips(world.rivers), bridges: buildBridges(world.rivers, world.terrain, b), style: { ...b.river, color: b.river?.color ?? [0.22, 0.45, 0.6] } });
const options = (track) => ({ settings: high, uniforms: createSharedUniforms(), track });

test("textures are data textures, never a canvas", () => {
  const texture = asphaltTexture();
  assert.ok(texture.isDataTexture);
  assert.ok(texture.image.data instanceof Uint8Array);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.deepEqual(Array.from(asphaltTexture().image.data.slice(0, 64)), Array.from(texture.image.data.slice(0, 64)), "deterministic");
  texture.dispose();
});

test("the road is cut into chunks, markings drawn on top of the asphalt", () => {
  const tracker = createTracker();
  const layer = createRoadLayer(roads(), options(tracker.track));
  assert.ok(layer.object.children.length > 2, "several chunks");
  const meshes = layer.object.children;
  const surface = meshes.find((m) => m.name === "road-surface");
  const marks = meshes.find((m) => m.name === "road-marks");
  assert.ok(surface.receiveShadow && marks.material.polygonOffsetUnits < surface.material.polygonOffsetUnits);
  assert.ok(surface.material.map.isDataTexture);
  const quads = meshes.reduce((sum, m) => sum + m.geometry.index.count / 6, 0);
  assert.equal(quads, roads().strips.indices.length / 6, "every quad is in exactly one chunk");
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("the river is blended and after the opaque; ice is opaque", () => {
  const tracker = createTracker();
  const layer = createRiverLayer(rivers(), options(tracker.track));
  layer.setEnvironment(environmentAt(resolvePreset("day"), "summer"));
  const water = layer.object.getObjectByName("river-water");
  assert.ok(water.material.transparent && !water.material.depthWrite);
  assert.ok(layer.object.getObjectByName("river-bridges"));
  layer.update({ dt: 0.016, t: 1, camera: new THREE.PerspectiveCamera(), focus: [0, 0, 0] });
  layer.dispose();
  assert.equal(tracker.live(), 0);
  const winter = resolveBiome("winter");
  const frozen = createRiverLayer(rivers(winter), options(createTracker().track));
  assert.equal(frozen.object.getObjectByName("river-water").material.transparent, false);
  frozen.dispose();
});

test("the world scene draws roads and rivers and frees them", () => {
  const tracker = createTracker();
  const scene = createWorldScene({ roads: roads(), rivers: rivers(), season: "summer" }, { settings: high, track: tracker.track });
  scene.setEnvironment(environmentAt(resolvePreset("day"), "summer"));
  assert.ok(scene.scene.getObjectByName("roads") && scene.scene.getObjectByName("rivers"));
  scene.dispose();
  assert.equal(tracker.live(), 0);
});
