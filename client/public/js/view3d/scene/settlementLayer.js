/**
 * The island's towns, villages and harbours: per settlement one near mesh (houses, lamps, benches, the city's
 * cathedral, a harbour's quay and boats) and one far twin, shown by the camera's distance to the settlement's
 * centre (`settings.buildings`), and one glow mesh of lit windows and lamp heads that follows the night. The
 * parts come from the building kit; placement is the plan's.
 */
import * as THREE from "../../three.js";
import { box, colour } from "../assets/geom.js";
import { BUILDINGS } from "../assets/buildings/index.js";
import { PROPS } from "../assets/props/index.js";
import { hash } from "../../world/plan/settlements/lines.js";
import { heightSampler } from "./grassField.js";
import { createBuildingMaterials, createCollector, createLod, createScratch, createTurners, placed, setGlow } from "./buildingMerge.js";
import { createOwner } from "./tracker.js";

/** A plot at least this big (metres) may carry a big house in a city. */
const BIG_PLOT = Object.freeze({ width: 13, depth: 10.5 });
/** Every this many city plots (by seed) one is a big house. */
const BIG_EVERY = 4;
/** Metres between a house's front and its plot's street edge. */
const FRONT_GAP = 1.5;
/** The cathedral stands this many metres further out than the church spot, its west front toward the square. */
const CATHEDRAL_SETBACK = 10;
/** Rotation speed of a windmill's sails, radians a second. */
const SAILS = 0.35;
const DECK = Object.freeze({ stone: colour("#9c9486"), planks: colour("#7a6a52"), top: 0.7, thick: 1.6 });

/**
 * @typedef {object} SettlementEntry
 * @property {string} id
 * @property {string} kind
 * @property {import("../../three.js").Mesh|null} near
 * @property {import("../../three.js").Mesh|null} far
 * @property {import("../../three.js").Mesh|null} glow
 * @property {{plot: number, x: number, z: number, yaw: number, door: {x: number, y: number, z: number}}[]} houses
 * @property {{x: number, z: number, yaw: number, door: {x: number, y: number, z: number}}|null} cathedral
 */

/** The church spot of a settlement's props, if it has one. */
const churchOf = (settlement) => settlement.props.find((prop) => prop.role === "church");

/**
 * @param {{settlements: import("../../world/plan/settlements/plan.js").Settlement[]}} plan
 * @param {{season?: string, settings: import("../quality.js").QualitySettings, uniforms: object, track: import("./tracker.js").Tracker["track"],
 *   grain?: import("../../three.js").Texture, ground?: {near: import("../../world/groundGrid.js").GroundGrid}}} options
 *   `ground` gives the height lamps and benches stand on and the sea level the quay and boats float on
 */
export function createSettlementLayer(plan, { season = "summer", settings, uniforms, track, grain, ground }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "settlements";
  const materials = createBuildingMaterials({ uniforms, grain, own });
  const reach = settings.buildings;
  const detail = settings.detail;
  const heightAt = ground && heightSampler(ground.near);
  const water = ground?.near.water;
  const turners = createTurners(object, materials.solid, own);
  const scratch = createScratch();
  const part = (asset, options) => asset.parts({ season, detail, ...options, own: scratch.own });

  /** @type {SettlementEntry[]} */
  const settlements = [];
  for (const settlement of plan.settlements) {
    const { id, center } = settlement;
    const collector = createCollector();
    const seed = hash(id);
    const average = settlement.ground.length ? settlement.ground.reduce((a, b) => a + b, 0) / settlement.ground.length : 0;
    const heightOf = (x, z) => heightAt?.(x, z) ?? average;
    const houses = [];
    settlement.plots.forEach((plot, i) => {
      const big = settlement.kind === "city" && plot.width >= BIG_PLOT.width && plot.depth >= BIG_PLOT.depth && (seed + i) % BIG_EVERY === 0;
      const house = part(BUILDINGS.house, { style: settlement.houses, seed: ((seed + i * 7919) >>> 0) || 1, big });
      const scale = Math.min(1, plot.width / house.width);
      const shift = Math.max(0, (plot.depth - house.depth * scale) / 2 - FRONT_GAP);
      const at = { x: plot.x + plot.facing[0] * shift, z: plot.z + plot.facing[1] * shift, y: settlement.ground[i], yaw: plot.yaw + Math.PI, scale };
      collector.add(house, at);
      houses.push({ plot: i, x: at.x, z: at.z, yaw: at.yaw, door: { x: house.door.x * scale, y: house.door.y * scale, z: house.door.z * scale } });
    });
    const lamp = part(BUILDINGS.streetLamp, {});
    for (const each of settlement.lamps) collector.add(lamp, { x: each.x, z: each.z, y: heightOf(each.x, each.z), yaw: each.yaw ?? 0 });
    const bench = PROPS.bench.parts({ season, detail, uniforms, own: scratch.own });
    for (const each of settlement.props) {
      if (each.role === "benches") for (const { geometry } of bench.near) collector.addWorld([placed(geometry, { x: each.x, z: each.z, y: heightOf(each.x, each.z), yaw: each.yaw })]);
    }
    let cathedral = null;
    const church = settlement.kind === "city" ? churchOf(settlement) : null;
    if (church) {
      const asset = part(BUILDINGS.cathedral, { seed: 1 });
      const yaw = church.yaw + Math.PI;
      const at = { x: church.x - Math.sin(yaw) * CATHEDRAL_SETBACK, z: church.z - Math.cos(yaw) * CATHEDRAL_SETBACK, yaw };
      at.y = heightOf(at.x, at.z);
      collector.add(asset, at);
      cathedral = { x: at.x, z: at.z, yaw, door: asset.door };
    }
    settlement.props.filter((each) => each.role === "windmills").forEach((each, k) => {
      const mill = part(BUILDINGS.windmill, { seed: seed + k + 1 });
      const at = { x: each.x, z: each.z, y: heightOf(each.x, each.z), yaw: each.yaw };
      collector.add(mill, at);
      turners.add(mill.movers.sails, at, { speed: SAILS, phase: k, far: reach.far });
    });
    if (settlement.quay && water !== undefined) {
      const { quay } = settlement;
      const deck = [box(quay.width, DECK.thick, quay.length, DECK.stone, 0, water + DECK.top - DECK.thick / 2, 0), box(quay.width - 0.6, 0.06, quay.length - 0.6, DECK.planks, 0, water + DECK.top + 0.03, 0)];
      collector.addWorld(deck.map((geometry) => placed(geometry, { x: quay.x, z: quay.z, y: 0, yaw: quay.yaw })), { far: true });
      settlement.boats.forEach((each, k) => collector.add(part(BUILDINGS.boat, { seed: seed + k + 1 }), { x: each.x, z: each.z, y: water, yaw: each.yaw }));
    }
    const lod = createLod(collector.merged(own), { materials, centre: center, reach, name: `settlement-${id}` });
    object.add(lod.object);
    settlements.push({ id, kind: settlement.kind, near: lod.near, far: lod.far, glow: lod.glow, houses, cathedral, lod });
  }
  scratch.release();

  return {
    object,
    settlements,
    update(frame) {
      for (const entry of settlements) entry.lod.update(frame.camera);
      turners.update(frame, reach);
    },
    setEnvironment(env) {
      const lit = setGlow(materials.glow, env.night);
      for (const entry of settlements) entry.lod.light(lit);
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
