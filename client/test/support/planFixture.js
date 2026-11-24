import { RouteGeometry } from "../../public/js/route/geometry.js";
import { RoadNetwork } from "../../public/js/route/network.js";
import { RIVER, buildRiverPath, withRivers } from "../../public/js/world/rivers.js";
import { networkTerrain, terrainModel, waterLevel } from "../../public/js/world/roads.js";
import { groundExtent } from "../../public/js/view3d/world.js";
import { planWorld } from "../../public/js/world/plan/index.js";
import { readFileSync } from "node:fs";
import { tinyNetworkFile } from "../helpers.js";

/** The tiny island with two regions (olive terraces, deep wood), one river across the south road and two junctions. */
export function tinyWorld() {
  const file = { ...tinyNetworkFile(), regions: [
    { id: "olives", kind: "oliveTerraces", x: -300, y: 300, radius: 220 },
    { id: "wood", kind: "deepWood", x: 450, y: -450, radius: 220 },
  ] };
  const network = new RoadNetwork(file);
  const roads = network.roads();
  const base = networkTerrain(network, roads);
  const sea = waterLevel(base.index);
  const river = { ...buildRiverPath(roads[0], base, 250, 77, sea), route: roads[0] };
  const terrain = withRivers(base, [river], sea - RIVER.mouthDepth);
  return { terrain, roads: terrain.index, rivers: [river], regions: network.regions, seed: network.seed, bounds: groundExtent(terrain).bounds, centers: { olives: [-300, -300], wood: [450, 450], meadow: [-300, 450] } };
}

/** A 100 km loop on a procedural terrain: no network, no regions. */
export function longWorld() {
  const points = [];
  const [width, height] = [30000, 20000];
  for (let d = 0; d < 2 * (width + height); d += 200) {
    let x;
    let y;
    if (d < width) [x, y] = [d, 0];
    else if (d < width + height) [x, y] = [width, d - width];
    else if (d < 2 * width + height) [x, y] = [width - (d - width - height), height];
    else [x, y] = [0, height - (d - 2 * width - height)];
    points.push([x, y, 150 + 100 * Math.sin(d / 3000)]);
  }
  const route = new RouteGeometry({ id: "big", name: "Big", lanes: 4, seed: 9, points });
  const terrain = terrainModel(route);
  return { terrain, roads: terrain.index, rivers: [], regions: [], seed: terrain.seed, bounds: groundExtent(terrain).bounds };
}

/** `planWorld` on a fixture world; `options` override season and detail. */
export const planOf = (world, options = {}) => planWorld({ season: "summer", detail: "high", ...world, ...options });

/** The valley map (three settlements, five landmarks, no rivers) as a plan world; build once per test file, it is slow. */
export function valleyWorld() {
  const network = new RoadNetwork(JSON.parse(readFileSync(new URL("../../../routes/maps/valley.json", import.meta.url), "utf8")));
  const roads = network.roads();
  const terrain = networkTerrain(network, roads);
  return { network, terrain, roads: terrain.index, routes: roads, rivers: [], regions: network.regions, seed: network.seed, bounds: groundExtent(terrain).bounds, settlements: network.settlements, landmarks: network.landmarks };
}
