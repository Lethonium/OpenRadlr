import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { environmentAt, resolvePreset } from "../public/js/world/daylight.js";
import { createWorldScene } from "../public/js/view3d/scene/worldScene.js";
import { hazeBand, hazeHeight } from "../public/js/view3d/scene/sky.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { groundFixture } from "./support/groundFixture.js";
import { planOf, valleyWorld } from "./support/planFixture.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";

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

test("the side view draws only the sky, ground and athletes, then restores every layer", () => {
  const { world } = make();
  const layers = world.scene.children.filter((child) => ["sky", "sea", "terrain", "athletes", "riders", "statues", "weather", "nightLights"].includes(child.name));
  const weather = world.scene.getObjectByName("weather");
  weather.visible = false; // hidden by quality before the side view
  const before = layers.map((layer) => layer.visible);
  world.isolateAthlete("me");
  const shown = layers.filter((layer) => layer.visible).map((layer) => layer.name).sort();
  assert.deepEqual(shown, ["athletes", "sea", "sky", "terrain"]);
  world.isolateAthlete(null);
  assert.deepEqual(layers.map((layer) => layer.visible), before);
});

test("a quality change keeps the arches, furniture, cafés and gyms", async () => {
  const { readFileSync } = await import("node:fs");
  const { buildSceneNow } = await import("../public/js/view3d/worldScene.js");
  const file = JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url)));
  const scene = buildSceneNow(file);
  const world = createWorldScene(scene, { settings: qualitySettings("high"), track: createTracker().track });
  world.setEnvironment(day);
  const counts = () =>
    Object.fromEntries(
      ["arches", "furniture", "venues"].map((name) => {
        let n = 0;
        world.scene.getObjectByName(name).traverse((o) => {
          n += o.isInstancedMesh ? o.count : 1;
        });
        return [name, n];
      }),
    );
  const before = counts();
  for (const name of Object.keys(before)) assert.ok(before[name] > 1, `${name} has something in it`);
  world.setQuality(qualitySettings("low"));
  world.setQuality(qualitySettings("high"));
  assert.deepEqual(counts(), before);
  world.dispose();
});

test("the haze band covers the horizon and thins with elevation", () => {
  for (const thickness of [0.2, 1.4, 3]) {
    assert.equal(hazeBand(0, thickness), 1, "full at the horizon");
    assert.equal(hazeBand(-0.3, thickness), 1, "and below it");
    assert.equal(hazeBand(1, thickness), 0, "none at the zenith");
    let last = 1;
    for (let e = 0; e <= 1; e += 0.02) {
      const band = hazeBand(e, thickness);
      assert.ok(band <= last + 1e-12, "never thicker higher up");
      last = band;
    }
  }
  assert.ok(hazeHeight(3) > hazeHeight(1.4) && hazeHeight(1.4) > hazeHeight(0.2), "thicker fog, taller band");
  assert.ok(hazeBand(0.2, 3) > hazeBand(0.2, 1.4), "so a given elevation is hazier in thick fog");
});

test("the sky takes the scene's fog colour and density from the environment", () => {
  const { world } = make();
  const sky = world.scene.getObjectByName("sky");
  assert.deepEqual(sky.material.uniforms.uFogColor.value.toArray().map((v) => +v.toFixed(5)), [...day.fogColor].map((v) => +v.toFixed(5)));
  assert.equal(sky.material.uniforms.uFogDensity.value, day.fogDensity);
  world.setEnvironment(night);
  assert.equal(sky.material.uniforms.uFogDensity.value, night.fogDensity);
  assert.deepEqual(sky.material.uniforms.uFogColor.value.toArray().map((v) => +v.toFixed(5)), [...night.fogColor].map((v) => +v.toFixed(5)));
  world.update(frame());
  assert.equal(sky.material.uniforms.uFar.value, 9000, "the band reads the lens's far plane");
});

/** A world scene over the valley fixture's plan: towns with lamps, woods, fields and verges. */
let valley = null;
function planned(quality = "high") {
  if (!valley) {
    const terrain = valleyWorld();
    const plan = planOf(terrain);
    const ground = buildGroundGrids(terrain.terrain, groundExtent(terrain.terrain), { season: "summer", long: false, regions: terrain.regions, masks: plan.masks });
    valley = { ground, plan, season: "summer" };
  }
  const world = createWorldScene(valley, { settings: qualitySettings(quality), track: createTracker().track });
  world.setEnvironment(day);
  return { world };
}

test("prepare warms the shaders as lit now, then as lit at night, and leaves the lights as they were", async () => {
  const { world } = planned();
  const lamps = () => world.scene.getObjectByName("nightLights").children.filter((c) => c.isLight);
  const seen = [];
  const warm = (scene) => {
    assert.equal(scene, world.scene);
    seen.push(lamps().every((light) => light.visible));
    return Promise.resolve();
  };
  assert.ok(lamps().length > 0, "the valley has lamps");
  await world.prepare(warm);
  assert.deepEqual(seen.slice(0, 1), [false], "the day's state first");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [false, true], "then the night's, in the background");
  assert.ok(lamps().every((light) => !light.visible), "back to day");
});

test("a scene disposed while warming warms nothing more", async () => {
  const { world } = make({ quality: "high" });
  let calls = 0;
  let release;
  const first = world.prepare(() => {
    calls += 1;
    return new Promise((resolve) => (release = resolve));
  });
  world.dispose();
  release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test("the plant layers do not walk their thousands of objects every frame", () => {
  const { world } = planned();
  for (const name of ["forest", "roadside", "scrub", "landRows", "fieldEdges"]) {
    const layer = world.scene.getObjectByName(name);
    assert.ok(layer, name);
    assert.equal(layer.matrixWorldAutoUpdate, false, `${name} is static`);
    // Placed once: every plant's world matrix is already its place.
    layer.traverse((object) => {
      const expected = object.parent ? object.parent.matrixWorld.clone().multiply(object.matrix) : object.matrix;
      assert.ok(object.matrixWorld.equals(expected), `${name}: ${object.name || object.type} placed`);
    });
  }
});

test("a static layer rebuilt for a new season or level is placed and static too", () => {
  const { world } = planned();
  world.setQuality(qualitySettings("medium"));
  world.setSeason("winter");
  for (const name of ["forest", "roadside", "scrub", "landRows", "fieldEdges"]) assert.equal(world.scene.getObjectByName(name).matrixWorldAutoUpdate, false, name);
});

/** A staged world scene over the valley: one layer built per frame (no time budget). */
function stagedValley(quality = "high", tracker = createTracker()) {
  planned();
  const world = createWorldScene(valley, { settings: qualitySettings(quality), track: tracker.track, stage: { budgetMs: 0, now: () => 0 } });
  world.setEnvironment(day);
  return { world, tracker };
}
const SEASON_LAYERS = ["islands", "forest", "crops", "roadside", "landRows", "scrub", "fieldEdges", "settlements", "farms", "landmarks", "fauna", "venues"];
const objectsOf = (world, names) => names.map((name) => world.scene.getObjectByName(name));

test("staged, a new season is built a layer per frame while the old layers stay, then swapped in at once", () => {
  const { world } = stagedValley();
  const before = objectsOf(world, SEASON_LAYERS);
  world.setSeason("winter");
  assert.deepEqual(objectsOf(world, SEASON_LAYERS), before, "nothing changes on the call itself");
  for (let i = 0; i < SEASON_LAYERS.length - 1; i += 1) {
    world.update(frame());
    assert.deepEqual(objectsOf(world, SEASON_LAYERS), before, `still the old world after ${i + 1} frames`);
  }
  world.update(frame());
  const after = objectsOf(world, SEASON_LAYERS);
  after.forEach((object, i) => assert.notEqual(object, before[i], `${SEASON_LAYERS[i]} is new`));
  before.forEach((object) => assert.equal(object.parent, null, "the old ones are gone"));
});

test("staged, each new layer's shaders are warmed, and the swap waits for all of them", async () => {
  const { world } = stagedValley();
  const releases = [];
  const roots = [];
  world.setWarm((root) => {
    roots.push(root);
    return new Promise((resolve) => releases.push(resolve));
  });
  const forest = world.scene.getObjectByName("forest");
  world.setSeason("winter");
  for (let i = 0; i < SEASON_LAYERS.length + 3; i += 1) world.update(frame());
  assert.ok(roots.some((root) => root.name === "forest" && root !== forest), "the new forest was warmed on its own");
  releases.slice(1).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(world.scene.getObjectByName("forest"), forest, "one layer still compiling holds the swap");
  releases[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(world.scene.getObjectByName("forest"), forest);
});

test("staged, a change while a rebuild is under way starts it over with the newest settings", () => {
  const { world } = stagedValley("high");
  world.setSeason("winter");
  world.update(frame());
  world.setQuality(qualitySettings("low"));
  for (let i = 0; i < 40; i += 1) world.update(frame());
  const grass = world.scene.getObjectByName("grass");
  const fresh = stagedValley("low").world.scene.getObjectByName("grass");
  assert.equal(grass.children.length, fresh.children.length, "the grass is the low level's");
  assert.equal(world.scene.getObjectByName("forest").matrixWorldAutoUpdate, false);
});

test("staged, the sun's shadow follows a new level at once", () => {
  const { world } = stagedValley("high");
  world.setQuality(qualitySettings("low"));
  assert.equal(world.sun.castShadow, false);
});

test("a staged scene disposed mid-rebuild frees what it had built", () => {
  const tracker = createTracker();
  const { world } = stagedValley("high", tracker);
  world.setSeason("winter");
  world.update(frame());
  world.update(frame());
  world.dispose();
  assert.equal(tracker.live(), 0);
});
