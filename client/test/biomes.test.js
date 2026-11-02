import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { BIOMES, BIOME_IDS, DEFAULT_BIOME, biomeChoices, resolveBiome } from "../public/js/view3d/biomes/index.js";
import { buildWorld } from "../public/js/view3d/world.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";

const route = JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url)));

const triangles = (scene) =>
  Object.fromEntries(Object.entries(scene.chunks).map(([name, chunks]) => [name, chunks.reduce((n, chunk) => n + chunk.mesh.positions.length / 9, 0)]));

test("the registry knows every biome and falls back to the default", () => {
  assert.ok(BIOMES[DEFAULT_BIOME], "the default is registered");
  assert.equal(DEFAULT_BIOME, "temperate", "new riders see the valley they know");
  assert.deepEqual(BIOME_IDS, ["temperate", "winter"]);
  assert.deepEqual(BIOME_IDS, Object.keys(BIOMES));
  assert.equal(resolveBiome("no-such-biome"), BIOMES[DEFAULT_BIOME]);
  assert.equal(resolveBiome(undefined), BIOMES[DEFAULT_BIOME]);
  assert.deepEqual(
    biomeChoices(),
    BIOME_IDS.map((id) => ({ id, label: BIOMES[id].label })),
  );
});

test("a biome brings everything the world draws with", () => {
  for (const id of BIOME_IDS) {
    const biome = resolveBiome(id);
    for (const key of ["id", "label", "road", "arch", "water", "cloud", "sand", "seaFloor", "palette", "models", "terrainColor", "flora"]) {
      assert.ok(biome[key] !== undefined, `${id} is missing ${key}`);
    }
    const spot = { x: 10, z: 20, height: 30, steep: 0.2, seed: 7, water: 0, riverDistance: Infinity, riverHalfWidth: 9 };
    const color = biome.terrainColor(spot);
    assert.equal(color.length, 3, `${id} returns an RGB colour`);
    assert.deepEqual(color, biome.terrainColor({ ...spot }), `${id} is deterministic`);
    for (const key of ["house", "church", "barn", "silo", "bale", "lamp", "warning", "villageSign", "cow", "cowBrown", "sheep", "cafe", "gym", "turbine"]) {
      assert.equal(typeof biome.models[key], "function", `${id} is missing model ${key}`);
    }
  }
});

test("winter brings ploughed banks, ruts and a frozen river", () => {
  const winter = resolveBiome("winter");
  assert.equal(winter.label, "biome.winter");
  assert.ok(winter.road.bank.height >= 0.2, "snow is ploughed to the verge");
  assert.ok(winter.road.rut.width > 0, "lanes show worn ruts");
  assert.ok(winter.road.postCap, "posts wear a cap of snow");
  assert.notDeepEqual(winter.river, resolveBiome("temperate").water, "the river freezes over");
  assert.equal(winter.flora.density.flowers, 0, "nothing flowers under the snow");
});

test("winter's roadside posts are snowmen, yellow-scarfed at every kilometre", () => {
  const winter = resolveBiome("winter");
  assert.equal(typeof winter.models.post, "function", "the posts have their own model");
  const ordinary = winter.models.post(false);
  const kilometre = winter.models.post(true);
  assert.ok(ordinary.positions.length > 0, "a snowman has geometry");
  assert.equal(ordinary.positions.length, kilometre.positions.length, "the same snowman, only re-dressed");
  assert.notDeepEqual(ordinary.colors, kilometre.colors, "the kilometre pair wears a yellow scarf");
  assert.equal(resolveBiome("temperate").models.post, undefined, "temperate keeps its plain posts");
});

test("winter changes the look, not the layout", () => {
  const temperate = buildWorld(new RouteGeometry(route), { biome: "temperate" });
  const winter = buildWorld(new RouteGeometry(route), { biome: "winter" });

  assert.deepEqual(winter.gyms, temperate.gyms, "workout riders stand on the same spots");
  assert.deepEqual(winter.cafes, temperate.cafes, "the café stays where it was");
  assert.deepEqual(winter.overview, temperate.overview, "the menu camera opens on the same island");
  assert.deepEqual(winter.zones, temperate.zones, "villages, farms, forests and rivers stay put");
  assert.equal(winter.waterLevel, temperate.waterLevel);
  assert.deepEqual(winter.meshes.arches.positions, temperate.meshes.arches.positions, "start and finish stay put");
  for (const [x, z] of [[0, 0], [1200, -400], [-800, 900], [route.points[15][0], route.points[15][1]]]) {
    assert.equal(winter.terrain.height(x, z), temperate.terrain.height(x, z), `terrain height at ${x},${z}`);
  }

  const total = (scene) => Object.values(triangles(scene)).reduce((a, b) => a + b, 0);
  const t = total(temperate);
  const w = total(winter);
  assert.notEqual(winter.chunks.road[0].mesh.positions.length, temperate.chunks.road[0].mesh.positions.length, "the road itself is reshaped");
  assert.ok(Math.abs(w - t) / t < 0.1, `winter stays within 10 % of temperate (${t} → ${w})`);
});

test("a season changes the look, not the layout", () => {
  const base = buildSceneNow(route, [], null, DEFAULT_BIOME);
  // An unknown id is the default biome, so the same world comes out exactly.
  const again = buildSceneNow(route, [], null, "no-such-biome");
  assert.deepEqual(triangles(again), triangles(base), "one triangle per place, either way");
  assert.deepEqual(again.gyms, base.gyms, "workout riders stand on the same spots");
  assert.deepEqual(again.overview, base.overview, "the menu camera opens on the same island");
  assert.deepEqual(again.meshes.arches.positions, base.meshes.arches.positions, "start and finish stay put");
});
