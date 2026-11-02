import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { BIOMES, BIOME_IDS, DEFAULT_BIOME, biomeChoices, resolveBiome } from "../public/js/view3d/biomes/index.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { buildRoad, buildWorld } from "../public/js/view3d/world.js";
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
    for (const key of ["id", "label", "road", "arch", "water", "cloud", "sand", "seaFloor", "palette", "models", "people", "terrainColor", "flora"]) {
      assert.ok(biome[key] !== undefined, `${id} is missing ${key}`);
    }
    assert.equal(typeof biome.people.model, "function", `${id} draws its own crowd`);
    assert.equal(typeof biome.people.motion, "string", `${id} says how the crowd moves`);
    const spot = { x: 10, z: 20, height: 30, steep: 0.2, seed: 7, water: 0, riverDistance: Infinity, riverHalfWidth: 9 };
    const color = biome.terrainColor(spot);
    assert.equal(color.length, 3, `${id} returns an RGB colour`);
    assert.deepEqual(color, biome.terrainColor({ ...spot }), `${id} is deterministic`);
    for (const key of ["house", "church", "barn", "silo", "bale", "lamp", "warning", "villageSign", "animal1", "animal2", "animal3", "cafe", "gym", "turbine"]) {
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

/** One tree at the origin with a deterministic random stream, for comparing biomes. */
const sampleTree = (biome, kind) => {
  const mesh = new MeshBuilder();
  let state = 1;
  const random = () => (state = (state * 48271) % 2147483647) / 2147483647;
  biome.flora.tree({ mesh, x: 0, y: 0, z: 0, kind, random });
  return mesh.build();
};

test("a biome grows its own trees and crowd", () => {
  const temperate = resolveBiome("temperate");
  const winter = resolveBiome("winter");
  assert.equal(temperate.people.motion, "jump", "people jump in summer");
  assert.equal(winter.people.motion, "clap", "penguins clap in winter");

  const idle = winter.people.model(false);
  const clap = winter.people.model(true);
  assert.ok(idle.vertexCount > 0, "the penguin has geometry");
  assert.notDeepEqual(clap.positions, idle.positions, "the flippers move");

  const leafy = sampleTree(temperate, 0.8);
  const birch = sampleTree(winter, 0.8);
  assert.ok(leafy.vertexCount > 0 && birch.vertexCount > 0);
  assert.notDeepEqual(birch.positions, leafy.positions, "winter grows a different tree");
});

test("a junction apron flattens winter's ploughed bank", () => {
  const winter = resolveBiome("winter");
  const road = new RouteGeometry({ id: "straight", name: "straight", lanes: 4, seed: 1, loop: false, points: [[0, 0, 10], [600, 0, 10]] });
  const highest = (mesh, from, to) => {
    let y = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i] >= from && mesh.positions[i] <= to) y = Math.max(y, mesh.positions[i + 1]);
    }
    return y;
  };
  const full = buildRoad(road, { biome: winter, clear: () => true });
  const apron = buildRoad(road, { biome: winter, clear: () => true, bankAt: (x) => (x > 100 && x < 200 ? 0 : 1) });
  assert.ok(highest(full, 110, 190) > 10.3, "the full bank stands above the road");
  assert.ok(highest(apron, 110, 190) < 10.1, "the junction apron is flat");
  assert.ok(highest(apron, 250, 350) > 10.3, "the bank comes back away from the junction");
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

  assert.deepEqual(winter.spectators.map((p) => p.position), temperate.spectators.map((p) => p.position), "the crowd stands on the same spots");
  assert.equal(temperate.spectators[0].motion, "jump");
  assert.equal(winter.spectators[0].motion, "clap", "the winter crowd claps");
  assert.notDeepEqual(winter.spectatorMeshes[0].positions, temperate.spectatorMeshes[0].positions, "winter's crowd is penguins");
  assert.notDeepEqual(winter.spectatorMeshes[1].positions, winter.spectatorMeshes[0].positions, "the clapping pose moves");

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
