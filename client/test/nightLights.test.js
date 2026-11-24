import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { QUALITY_LEVELS, qualitySettings } from "../public/js/view3d/quality.js";
import { createLandmarkLayer } from "../public/js/view3d/scene/landmarkLayer.js";
import { createNightLights } from "../public/js/view3d/scene/nightLights.js";
import { createSettlementLayer } from "../public/js/view3d/scene/settlementLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { planOf, valleyWorld } from "./support/planFixture.js";

const world = valleyWorld();
const plan = planOf(world);
const ground = buildGroundGrids(world.terrain, groundExtent(world.terrain), { season: "summer", long: false, regions: world.regions, masks: plan.masks });
const day = environmentAt(resolvePreset("day"), "summer");
const night = environmentAt(resolvePreset("night"), "summer");
const lamps = plan.settlements.flatMap((s) => s.lamps);

const make = (level = "high", track = createTracker().track) =>
  createNightLights(plan, { settings: qualitySettings(level), uniforms: createSharedUniforms(), track, ground });
const frameAt = (x, z, extra = {}) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, 40, z);
  camera.updateMatrixWorld();
  return { dt: 0.016, t: 1, camera, focus: [x, 0, z], ...extra };
};
const options = (level = "high", track = createTracker().track) => ({ season: "summer", settings: qualitySettings(level), uniforms: createSharedUniforms(), track, ground });

test("lamp pools sit under the planned lamps", () => {
  const layer = make();
  const pools = layer.object.getObjectByName("lamp-pools");
  const position = pools.geometry.getAttribute("position");
  assert.equal(position.count, lamps.length * 4, "one quad per lamp");
  lamps.forEach((lamp, i) => {
    const xs = [0, 1, 2, 3].map((k) => position.getX(i * 4 + k));
    const zs = [0, 1, 2, 3].map((k) => position.getZ(i * 4 + k));
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - lamp.x) < 0.01, "centred on x");
    assert.ok(Math.abs((Math.min(...zs) + Math.max(...zs)) / 2 - lamp.z) < 0.01, "centred on z");
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 11) < 0.01, "11 m wide");
  });
  layer.setEnvironment(night);
  assert.ok(Math.abs(pools.material.opacity - 0.6) < 0.01, "full strength at night");
  layer.setEnvironment(day);
  assert.equal(pools.material.opacity, 0, "none by day");
  layer.dispose();
});

test("the headlight is on at night at every level and off by day", () => {
  for (const level of QUALITY_LEVELS) {
    const layer = make(level);
    layer.setEnvironment(night);
    assert.ok(layer.headlight.intensity > 0, `${level} lit at night`);
    layer.setEnvironment(day);
    assert.equal(layer.headlight.intensity, 0, `${level} dark by day`);
    layer.dispose();
  }
});

test("the headlight points along the heading", () => {
  const layer = make();
  layer.setEnvironment(night);
  layer.update(frameAt(10, 20, { focus: [10, 5, 20], heading: [0, 1] }));
  const { headlight } = layer;
  assert.deepEqual(headlight.position.toArray(), [10, 5 + 1.1, 20], "1.1 m above the focus");
  assert.ok(Math.abs(headlight.target.position.x - 10) < 1e-6 && Math.abs(headlight.target.position.z - 45) < 1e-6, "25 m ahead");
  assert.equal(headlight.angle, 0.5);
  assert.equal(headlight.penumbra, 0.6);
  layer.dispose();
});

test("only the nearest lamps get lights", () => {
  const layer = make("high");
  layer.setEnvironment(night);
  const city = plan.settlements.find((s) => s.kind === "city");
  const [cx, cz] = city.center;
  layer.update(frameAt(cx, cz));
  assert.equal(layer.lights.length, qualitySettings("high").lampLights);
  const want = [...lamps].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, layer.lights.length);
  const got = layer.lights.map((light) => `${light.position.x.toFixed(2)},${light.position.z.toFixed(2)}`).sort();
  assert.deepEqual(got, want.map((l) => `${l.x.toFixed(2)},${l.z.toFixed(2)}`).sort());
  for (const light of layer.lights) assert.ok(light.intensity > 0 && light.distance === 22);
  layer.setEnvironment(day);
  for (const light of layer.lights) assert.equal(light.intensity, 0, "dark by day");
  layer.dispose();
});

test("low has no lamp lights and each level has more than the one below", () => {
  assert.equal(make("low").lights.length, 0);
  assert.deepEqual(QUALITY_LEVELS.map((l) => qualitySettings(l).lampLights), [0, 4, 8, 12]);
  assert.deepEqual(QUALITY_LEVELS.map((l) => qualitySettings(l).headlightShadows), [false, false, true, true]);
  assert.equal(make("high").headlight.castShadow, true);
  assert.equal(make("medium").headlight.castShadow, false);
});

test("far towns glow at night", () => {
  const { near, far } = qualitySettings("high").buildings;
  const layer = createSettlementLayer(plan, { ...options(), ground });
  const city = plan.settlements.find((s) => s.kind === "city");
  const entry = layer.settlements.find((s) => s.id === city.id);
  layer.setEnvironment(night);
  layer.update(frameAt(city.center[0] + (near + far) / 2, city.center[1]));
  assert.equal(entry.near.visible, false);
  assert.ok(entry.far.visible && entry.glow.visible, "lit windows show beside the far twin");
  layer.update(frameAt(city.center[0] + far + 1, city.center[1]));
  assert.equal(entry.glow.visible, false, "nothing beyond the reach");
  layer.setEnvironment(day);
  layer.update(frameAt(city.center[0] + (near + far) / 2, city.center[1]));
  assert.equal(entry.glow.visible, false, "dark by day");
  layer.dispose();
});

test("the lighthouse beam turns and shows only at night", () => {
  const layer = createLandmarkLayer(plan, options());
  const light = layer.landmarks.find((l) => l.kind === "lighthouse");
  assert.ok(light.beam, "a beam");
  assert.equal(light.beam.children.length, 2, "two cones");
  layer.setEnvironment(day);
  layer.update(frameAt(light.x + 30, light.z, { t: 1 }));
  assert.equal(light.beam.visible, false);
  layer.setEnvironment(night);
  layer.update(frameAt(light.x + 30, light.z, { t: 1 }));
  assert.equal(light.beam.visible, true);
  const a = light.beam.rotation.y;
  layer.update(frameAt(light.x + 30, light.z, { t: 3.5 }));
  assert.ok(Math.abs(light.beam.rotation.y - a - Math.PI / 2) < 1e-6, "a quarter turn in 2.5 s");
  layer.update(frameAt(light.x + 30, light.z, { t: 11 }));
  assert.ok(Math.abs(Math.cos(light.beam.rotation.y - a) - 1) < 1e-6, "once round in 10 s");
  layer.dispose();
});

test("the lighthouse beam is a faint additive shaft that fades along its length and at its edges", () => {
  const layer = createLandmarkLayer(plan, options());
  const light = layer.landmarks.find((l) => l.kind === "lighthouse");
  const material = light.beam.children[0].material;
  assert.equal(material.isShaderMaterial, true, "a shader fades it");
  assert.equal(material.blending, THREE.AdditiveBlending);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.fog, true, "the shader reads the scene's fog");
  assert.ok(material.uniforms.uOpacity.value <= 0.35, "faint even at the lamp");
  assert.match(material.fragmentShader, /vAlong/, "fades along its length");
  assert.match(material.fragmentShader, /vEdge/, "fades at its edges");
  layer.dispose();
});

test("night lights dispose everything", () => {
  const tracker = createTracker();
  const layer = make("high", tracker.track);
  layer.setEnvironment(night);
  layer.update(frameAt(0, 0));
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
