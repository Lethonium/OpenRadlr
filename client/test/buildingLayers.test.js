import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { BUILDINGS, HOUSE_STYLES } from "../public/js/view3d/assets/buildings/index.js";
import { triangleCount } from "../public/js/view3d/assets/geom.js";
import { createScratch, createTurners } from "../public/js/view3d/scene/buildingMerge.js";
import { createFarmLayer } from "../public/js/view3d/scene/farmLayer.js";
import { createSettlementLayer } from "../public/js/view3d/scene/settlementLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { QUALITY_LEVELS, qualitySettings } from "../public/js/view3d/quality.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { REGION_STYLE } from "../public/js/world/regionKinds.js";
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
const city = plan.settlements.find((s) => s.kind === "city");
const tris = (mesh) => (mesh ? triangleCount(mesh.geometry) : 0);

/** Distance from (x, z) to the polyline of street `id` of a settlement. */
function streetDistance(settlement, x, z, id) {
  let best = Infinity;
  for (const street of settlement.streets.filter((each) => each.id === id)) {
    for (let i = 1; i < street.points.length; i += 1) {
      const [ax, az] = street.points[i - 1];
      const [bx, bz] = street.points[i];
      const length2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / length2));
      best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)));
    }
  }
  return best;
}

test("a settlement shows its near mesh close and its far twin far away", () => {
  const { near, far } = qualitySettings("high").buildings;
  const layer = createSettlementLayer(plan, options());
  const entry = layer.settlements.find((s) => s.id === city.id);
  const at = (d) => {
    layer.update(frameAt(city.center[0] + d, city.center[1]));
    return [entry.near.visible, entry.far.visible];
  };
  assert.deepEqual(at(near - 1), [true, false]);
  assert.deepEqual(at(near + 1), [false, true]);
  assert.deepEqual(at(far + 1), [false, false]);
  layer.dispose();
});

test("every house door faces its street", () => {
  const sample = plan.settlements.flatMap((s) => s.plots.map((plot) => ({ s, plot }))).filter((_, i) => i % 7 === 0);
  assert.ok(sample.length > 20);
  for (const { s, plot } of sample) {
    const { x, z, yaw, depth } = plot;
    const door = [x + Math.sin(yaw + Math.PI) * depth * 0.5, z + Math.cos(yaw + Math.PI) * depth * 0.5];
    assert.ok(streetDistance(s, ...door, plot.street) < streetDistance(s, x, z, plot.street), `${s.id} plot at ${x.toFixed(0)},${z.toFixed(0)}`);
  }
  const layer = createSettlementLayer(plan, options());
  for (const entry of layer.settlements) for (const house of entry.houses) {
    const s = plan.settlements.find((each) => each.id === entry.id);
    const plot = s.plots[house.plot];
    const door = [house.x + Math.sin(house.yaw) * house.door.z + Math.cos(house.yaw) * house.door.x, house.z + Math.cos(house.yaw) * house.door.z - Math.sin(house.yaw) * house.door.x];
    assert.ok(streetDistance(s, ...door, plot.street) < streetDistance(s, plot.x, plot.z, plot.street), `${entry.id} house ${house.plot}`);
  }
  layer.dispose();
});

test("the city's cathedral turns its west front to the square", () => {
  const layer = createSettlementLayer(plan, options());
  const entry = layer.settlements.find((s) => s.id === city.id);
  assert.ok(entry.cathedral, "a cathedral");
  const { x, z, yaw, door } = entry.cathedral;
  const world = [x + Math.sin(yaw) * door.z, z + Math.cos(yaw) * door.z];
  const square = city.square.center;
  assert.ok(Math.hypot(world[0] - square[0], world[1] - square[1]) < Math.hypot(x - square[0], z - square[1]));
  layer.dispose();
});

test("far buildings stay within the level's budget on the valley", () => {
  const measured = {};
  for (const level of QUALITY_LEVELS) {
    const settlements = createSettlementLayer(plan, options(level));
    const farms = createFarmLayer(plan, options(level));
    const far = [...settlements.settlements, ...farms.farms].reduce((sum, entry) => sum + tris(entry.far), 0);
    const nearCity = tris(settlements.settlements.find((s) => s.id === city.id).near);
    const nearAll = [...settlements.settlements, ...farms.farms].reduce((sum, entry) => sum + tris(entry.near), 0);
    measured[level] = { far, nearCity, nearAll };
    settlements.dispose();
    farms.dispose();
  }
  console.log("valley buildings", JSON.stringify(measured)); // i18n-ok
  assert.ok(measured.low.far > 0);
  assert.ok(measured.low.far <= 60000, `low far ${measured.low.far}`);
  assert.ok(measured.ultra.far <= 200000, `ultra far ${measured.ultra.far}`);
  assert.ok(measured.low.nearCity <= 400000, `low city ${measured.low.nearCity}`);
  assert.ok(measured.low.nearCity < measured.medium.nearCity);
});

test("each level has building reaches that grow with it", () => {
  const reaches = QUALITY_LEVELS.map((level) => qualitySettings(level).buildings);
  assert.deepEqual(reaches.map((r) => r.near), [250, 400, 600, 900]);
  assert.deepEqual(reaches.map((r) => r.far), [1500, 2500, 4000, 6000]);
});

test("windows glow only at night", () => {
  const layer = createSettlementLayer(plan, options());
  const glow = layer.settlements.find((s) => s.id === city.id).glow;
  assert.ok(glow, "a glow mesh");
  layer.update(frameAt(...city.center));
  layer.setEnvironment(day);
  assert.equal(glow.material.color.getHex(), 0x000000);
  layer.setEnvironment(night);
  assert.ok(glow.material.color.r > 0.1 && glow.visible);
  assert.equal(glow.material.fog, true);
  layer.dispose();
});

test("turbine rotors stop beyond reach", () => {
  const { near } = qualitySettings("high").buildings;
  const layer = createFarmLayer(plan, options());
  const rotor = layer.turbines[0].rotor;
  const turbine = plan.turbines[0];
  const spin = (distance) => {
    layer.update(frameAt(turbine.x + distance, turbine.z, 1));
    const a = rotor.quaternion.clone();
    layer.update(frameAt(turbine.x + distance, turbine.z, 2));
    return a.angleTo(rotor.quaternion);
  };
  assert.ok(spin(near - 20) > 0.01, "turns within reach");
  assert.equal(spin(near + 20), 0, "still beyond");
  layer.dispose();
});

test("a farmstead's house follows its region's style", () => {
  assert.ok(plan.farms.length > 0);
  for (const farm of plan.farms) assert.ok(HOUSE_STYLES.includes(farm.style), farm.style);
  assert.ok(Object.values(REGION_STYLE).every((style) => HOUSE_STYLES.includes(style.houses)));
  const sum = (parts) => parts.near[0].geometry.attributes.color.array.reduce((a, b) => a + b, 0);
  assert.notEqual(sum(BUILDINGS.farmstead.parts({ style: "stone", season: "summer" })), sum(BUILDINGS.farmstead.parts({ style: "timber", season: "summer" })));
});

test("settlement and farm layers dispose everything after a season and a quality switch", () => {
  const tracker = createTracker();
  const scene = createWorldScene({ ground, plan, season: "summer" }, { settings: qualitySettings("high"), track: tracker.track });
  scene.setEnvironment(day);
  for (const name of ["settlements", "farms"]) assert.ok(scene.scene.getObjectByName(name), name);
  scene.update({ ...frameAt(...city.center), focus: [city.center[0], 0, city.center[1]] });
  const before = tracker.live();
  scene.setSeason("winter", plan);
  scene.setQuality(qualitySettings("low"));
  scene.setQuality(qualitySettings("high"));
  scene.setSeason("summer", plan);
  assert.equal(tracker.live(), before, "a switch frees what it replaced");
  scene.dispose();
  assert.equal(tracker.live(), 0);
});

test("a turning part keeps its own copy of the geometry when the build's scratch is freed", () => {
  const scratch = createScratch();
  const kept = [];
  const turners = createTurners(new THREE.Group(), new THREE.MeshBasicMaterial(), (resource) => (kept.push(resource), resource));
  const sails = scratch.own(new THREE.BoxGeometry(1, 1, 1));
  const mesh = turners.add({ geometry: sails, x: 0, y: 0, z: 0, axis: [0, 0, 1] }, { x: 0, y: 0, z: 0, yaw: 0 });
  let disposed = false;
  mesh.geometry.addEventListener("dispose", () => (disposed = true));
  scratch.release();
  assert.notEqual(mesh.geometry, sails);
  assert.equal(disposed, false, "the copy outlives the scratch");
  assert.deepEqual(kept, [mesh.geometry], "the layer owns the copy");
});
