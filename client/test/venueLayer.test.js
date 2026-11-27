/** Venue layer: cafés turn their front to the road, gyms' mats meet the athletes' spots, every style builds, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createBikeCafe, CAFE_STYLES } from "../public/js/view3d/assets/buildings/bikeCafe.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createVenueLayer } from "../public/js/view3d/scene/venueLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { GYM_TOP } from "../public/js/world/venues.js";

const forecourt = { inner: [[0, 0.1, 0], [2, 0.1, 0], [4, 0.1, 0]], outer: [[0, 0.1, 10], [2, 0.1, 10], [4, 0.1, 10]] };
const site = (style, extra = {}) => ({ id: `${style}-cafe`, name: "Test Café", style, position: [10, 5, 20], yaw: 0.7, forecourt, ...extra });
const gym = { center: [30, 21, 5], yaw: 0.3, spots: [], cafeId: null, statueRow: { position: [0, 0, 0], yaw: 0 }, position: [30, 20, 5], base: 20, drop: 1.4, signLift: 0.6 };

const make = (world, season = "summer") => {
  const tracker = createTracker();
  const layer = createVenueLayer({ biome: "temperate", season, ...world }, { season, settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track, biome: resolveBiome(season === "winter" ? "winter" : "temperate") });
  return { layer, tracker };
};
const verticesOf = (object) => {
  let count = 0;
  object.traverse((child) => { if (child.isMesh) count += child.geometry.attributes.position.count; });
  return count;
};

test("a café faces the road", () => {
  const { layer } = make({ cafeSites: [site("valley")], gyms: [] });
  const cafe = layer.object.getObjectByName("cafe-valley-cafe");
  assert.ok(cafe);
  layer.object.updateMatrixWorld(true);
  const front = new THREE.Vector3(0, 0, 1).transformDirection(cafe.matrixWorld);
  const toRoad = [-Math.sin(0.7), -Math.cos(0.7)];
  assert.ok(front.x * toRoad[0] + front.z * toRoad[1] > 0.9, `front ${front.x.toFixed(2)}, ${front.z.toFixed(2)}`);
  assert.ok(Math.abs(cafe.position.y - 5) < 1e-6 && cafe.position.x === 10, "it stands on its site");
});

test("the gym's mat top meets the spots", () => {
  const { layer } = make({ cafeSites: [], gyms: [gym] });
  const pad = layer.object.getObjectByName("gym-0");
  assert.ok(pad);
  layer.object.updateMatrixWorld(true);
  const solid = pad.children.find((child) => child.isMesh && child.geometry.attributes.color);
  const position = solid.geometry.attributes.position;
  const at = new THREE.Vector3();
  let top = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    at.fromBufferAttribute(position, i);
    if (Math.abs(at.x) <= 4.1 && Math.abs(at.z) <= 2.6) top = Math.max(top, at.applyMatrix4(solid.matrixWorld).y);
  }
  assert.ok(Math.abs(top - (gym.base + GYM_TOP)) < 0.02, `mat top ${top}`);
});

test("each style builds and they differ", () => {
  assert.deepEqual([...CAFE_STYLES].sort(), ["beach", "hilltop", "hut", "valley"]);
  const counts = CAFE_STYLES.map((style) => {
    const tracker = createTracker();
    const group = createBikeCafe({ style, name: "A Café", snow: false, own: tracker.track, uniforms: createSharedUniforms() });
    assert.ok(group.getObjectByName("bikes"), `${style} has parked bikes`);
    assert.ok(group.getObjectByName("name-board"), `${style} has a name board`);
    return verticesOf(group);
  });
  assert.equal(new Set(counts).size, 4, `vertex counts ${counts}`);
});

test("snow lies on the hut in winter", () => {
  const tracker = createTracker();
  const [plain, snowy] = [false, true].map((snow) => createBikeCafe({ style: "hut", name: "Hut", snow, own: tracker.track, uniforms: createSharedUniforms() }));
  assert.ok(verticesOf(snowy) > verticesOf(plain));
});

test("a layer draws every site, one forecourt mesh, and every gym", () => {
  const { layer } = make({ cafeSites: [site("valley"), site("hut", { id: "forge-hut" })], gyms: [gym, { ...gym, position: [50, 20, 5] }] });
  assert.equal(layer.object.children.filter((child) => child.name.startsWith("cafe-")).length, 2);
  assert.equal(layer.object.children.filter((child) => child.name.startsWith("gym-")).length, 2);
  assert.equal(layer.object.children.filter((child) => child.name === "forecourts").length, 1);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make({ cafeSites: [site("valley"), site("beach")], gyms: [gym] });
  assert.ok(tracker.live() > 0);
  layer.update({});
  layer.setEnvironment({ night: 0.5 });
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
