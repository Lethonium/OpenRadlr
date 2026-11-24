/**
 * The island's farms and wind turbines: per farm one near mesh (farmstead, paddock fence, windpump tower) and
 * one far twin, shown by the camera's distance to the yard (`settings.buildings`); the windpump's wheel and each
 * turbine's rotor turn by `t × speed + phase` within `buildings.near` and stand still beyond. Turbines share their
 * geometry and show their full tower near, a plain one far, and are never hidden by distance (they are the island's
 * tallest things).
 */
import * as THREE from "../../three.js";
import { BUILDINGS } from "../assets/buildings/index.js";
import { heightSampler } from "./grassField.js";
import { createBuildingMaterials, createCollector, createLod, createScratch, createTurners, setGlow } from "./buildingMerge.js";
import { paddockFence } from "./paddockFence.js";
import { createOwner } from "./tracker.js";

/** Rotation speed of a windpump's wheel, radians a second. */
const WHEEL = 1.4;
/** Rotor speed of a turbine at factor 1, radians a second. */
const ROTOR = 1.1;

/**
 * @param {{farms: import("../../world/plan/farms.js").Farm[], turbines: import("../../world/plan/turbines.js").Turbine[]}} plan
 * @param {{season?: string, settings: import("../quality.js").QualitySettings, uniforms: object, track: import("./tracker.js").Tracker["track"],
 *   grain?: import("../../three.js").Texture, ground?: {near: import("../../world/groundGrid.js").GroundGrid}}} options
 */
export function createFarmLayer(plan, { season = "summer", settings, uniforms, track, grain, ground }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "farms";
  const materials = createBuildingMaterials({ uniforms, grain, own });
  const reach = settings.buildings;
  const detail = settings.detail;
  const heightAt = ground && heightSampler(ground.near);
  const turners = createTurners(object, materials.solid);
  const scratch = createScratch();
  const part = (asset, options) => asset.parts({ season, detail, ...options, own: scratch.own });

  const farms = plan.farms.map((farm, i) => {
    const collector = createCollector();
    const at = { x: farm.x, z: farm.z, y: farm.y, yaw: Math.PI / 2 - farm.yaw };
    collector.add(part(BUILDINGS.farmstead, { style: farm.style ?? "cottage", seed: i + 1, silos: farm.silos }), at);
    const ground = (x, z) => heightAt?.(x, z) ?? farm.y;
    if (farm.paddock) collector.addWorld(paddockFence(farm.paddock, farm, ground));
    let wheel = null;
    if (farm.pump) {
      const pump = part(BUILDINGS.windpump, { seed: i + 1 });
      const stand = { x: farm.pump.x, z: farm.pump.z, y: ground(farm.pump.x, farm.pump.z), yaw: at.yaw };
      collector.add(pump, stand);
      wheel = turners.add(pump.movers.wheel, stand, { speed: WHEEL, phase: i, far: reach.far });
    }
    const lod = createLod(collector.merged(own), { materials, centre: [farm.x, farm.z], reach, name: `farm-${i}` });
    object.add(lod.object);
    return { x: farm.x, z: farm.z, near: lod.near, far: lod.far, glow: lod.glow, wheel, lod };
  });

  const asset = plan.turbines.length ? BUILDINGS.windTurbine.parts({ season, detail, own }) : null;
  const turbines = plan.turbines.map((turbine) => {
    const at = { x: turbine.x, y: turbine.y, z: turbine.z, yaw: turbine.yaw + Math.PI / 2 };
    const [near, far] = [asset.near, asset.far].map((list) => {
      const mesh = new THREE.Mesh(list[0].geometry, materials.solid);
      mesh.position.set(at.x, at.y, at.z);
      mesh.rotation.y = at.yaw;
      mesh.castShadow = list === asset.near;
      mesh.visible = false;
      object.add(mesh);
      return mesh;
    });
    const rotor = turners.add(asset.movers.rotor, at, { speed: ROTOR * turbine.speed, phase: turbine.phase });
    return { x: turbine.x, z: turbine.z, near, far, rotor };
  });
  scratch.release();

  return {
    object,
    farms,
    turbines,
    update(frame) {
      for (const farm of farms) farm.lod.update(frame.camera);
      const { x, z } = frame.camera.position;
      for (const turbine of turbines) {
        const close = Math.hypot(x - turbine.x, z - turbine.z) < reach.near;
        turbine.near.visible = close;
        turbine.far.visible = !close;
      }
      turners.update(frame, reach);
    },
    setEnvironment(env) {
      const lit = setGlow(materials.glow, env.night);
      for (const farm of farms) farm.lod.light(lit);
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
