import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { asphaltTexture, kindColors } from "../public/js/view3d/assets/road.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createRiverLayer } from "../public/js/view3d/scene/riverLayer.js";
import { createRoadLayer } from "../public/js/view3d/scene/roadLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { buildBridges } from "../public/js/view3d/bridges.js";
import { roadStyle } from "../public/js/view3d/roadStyle.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { ROAD_LIFT, VERGE, roadHalfWidth } from "../public/js/world/roads.js";
import { riverStrips } from "../public/js/world/plan/riverStrips.js";
import { ROAD_KIND, roadStrips } from "../public/js/world/plan/roadStrips.js";
import { squareRoute } from "./helpers.js";
import { streetStrips } from "../public/js/world/plan/streetStrips.js";
import { planOf, tinyWorld, valleyWorld } from "./support/planFixture.js";

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

// Town streets (new world, part 3)
const valley = (() => {
  let cached;
  return () => {
    if (!cached) {
      const w = valleyWorld();
      cached = { world: w, plan: planOf(w) };
    }
    return cached;
  };
})();
const quadsOfKind = (strips, kind) => {
  const list = [];
  for (let q = 0; q < strips.kinds.length / 4; q += 1) {
    if (strips.kinds[q * 4] !== kind) continue;
    const corners = [0, 1, 2, 3].map((k) => Array.from(strips.positions.subarray((q * 4 + k) * 3, (q * 4 + k) * 3 + 3)));
    list.push({ corners, mid: [0, 1, 2].map((a) => corners.reduce((s, c) => s + c[a], 0) / 4) });
  }
  return list;
};
const distToLine = (points, [x, z]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, az] = points[i];
    const [dx, dz] = [points[i + 1][0] - ax, points[i + 1][1] - az];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
};

test("a town street sits on the ground, a few centimetres up", () => {
  const { world, plan } = valley();
  const strips = streetStrips(plan.settlements, world.terrain, {});
  assert.ok(strips.kinds.length > 0);
  assert.ok(quadsOfKind(strips, ROAD_KIND.asphalt).length > 0, "streets are laid in asphalt");
  for (let i = 0; i < strips.positions.length; i += 3) {
    const lift = strips.positions[i + 1] - world.terrain.height(strips.positions[i], strips.positions[i + 2]);
    assert.ok(lift > 0.01 && lift < 0.12, `lift ${lift}`);
  }
});

test("the main street gets pavements but no second asphalt", () => {
  const { world, plan } = valley();
  const strips = streetStrips(plan.settlements, world.terrain, {});
  let checked = 0;
  for (const settlement of plan.settlements) {
    const main = settlement.streets.find((s) => s.existing);
    if (!main) continue;
    const inner = roadHalfWidth(main.route.lanes) + VERGE;
    for (const { corners, mid } of quadsOfKind(strips, ROAD_KIND.pavement)) {
      const near = distToLine(main.points, [mid[0], mid[2]]);
      if (near > inner + 6) continue;
      checked += 1;
      for (const c of corners) assert.ok(distToLine(main.points, [c[0], c[2]]) > inner - 0.3, `pavement stays off the road ${distToLine(main.points, [c[0], c[2]])} ${inner}`);
    }
    for (const { mid } of quadsOfKind(strips, ROAD_KIND.asphalt)) {
      if (distToLine(main.points, [mid[0], mid[2]]) < 20) assert.ok(distToLine(main.points, [mid[0], mid[2]]) >= roadHalfWidth(main.route.lanes) - 0.1, "no asphalt over the road");
    }
  }
  assert.ok(checked > 0, "the main street has pavements");
});

test("a farm's drive is gravel and the square is paved", () => {
  const { world, plan } = valley();
  const none = streetStrips(plan.settlements, world.terrain, {});
  const withFarms = streetStrips(plan.settlements, world.terrain, { farms: plan.farms });
  assert.ok(plan.farms.length > 0);
  assert.ok(quadsOfKind(withFarms, ROAD_KIND.verge).length > 0);
  assert.equal(quadsOfKind(none, ROAD_KIND.verge).length, 0);
  assert.ok(plan.settlements.some((s) => s.square), "a town has a square");
  assert.ok(quadsOfKind(none, ROAD_KIND.pavement).length > 0);
});

test("the pavement kind has its own colour", () => {
  const colors = kindColors(roadStyle(biome));
  const pavement = colors[ROAD_KIND.pavement];
  assert.equal(pavement.length, 3);
  for (const other of [ROAD_KIND.asphalt, ROAD_KIND.verge]) assert.notDeepEqual(pavement, colors[other]);
});
