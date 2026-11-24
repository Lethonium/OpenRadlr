/**
 * The island's landmarks: per landmark one near mesh and one far twin (lighthouse, castle ruin, sea arch, a row of
 * windmills), shown by the camera's distance (`settings.buildings`). The windmills' sails turn by `t` within
 * `buildings.near`, the lighthouse lamp glows by `env.night` and is seen from as far as the building reaches. The
 * balloons are loose meshes flown round their loops by the scene's clock (#127's formula): visual only, clients
 * need not agree.
 */
import * as THREE from "../../three.js";
import { BUILDINGS } from "../assets/buildings/index.js";
import { createBuildingMaterials, createCollector, createLod, createScratch, createTurners, setGlow } from "./buildingMerge.js";
import { createOwner } from "./tracker.js";

/** Balloons are drawn larger than life (about 50 m tall) so they still read from a few kilometres. */
const BALLOON_SIZE = 1.7;
/** A balloon shows its modelled envelope within this many times `buildings.near`, a few cheap rings beyond. */
const BALLOON_NEAR = 2;
/** Metres a balloon bobs up and down, and the clock rates of the bob. */
const BOB = Object.freeze({ height: 3, rate: 0.21, phase: 3 });
/** The sails' turning speed, radians a second: 0.28 to 0.4 by mill. */
const SAILS = Object.freeze({ base: 0.28, spread: 0.12 });
/** The building each landmark kind stands as. */
const ASSET = Object.freeze({ lighthouse: "lighthouse", castle: "castle", seaArch: "seaArch", windmills: "windmill" });

/**
 * Where a balloon is at `t` seconds on the clock, as [x, y, z]: round its loop, bobbing a few metres.
 * @param {{x: number, z: number, y: number, radius: number, phase: number, speed: number}} balloon a balloon member of the plan's landmark
 * @param {number} t
 */
export function balloonAt({ x, z, y, radius, phase, speed }, t) {
  const angle = phase + t * speed;
  return [x + Math.cos(angle) * radius, y + Math.sin(t * BOB.rate + phase * BOB.phase) * BOB.height, z + Math.sin(angle) * radius];
}

/**
 * @param {{landmarks: import("../../world/plan/landmarks.js").Landmark[]}} plan
 * @param {{season?: string, settings: import("../quality.js").QualitySettings, uniforms: object, track: import("./tracker.js").Tracker["track"],
 *   grain?: import("../../three.js").Texture}} options
 */
export function createLandmarkLayer(plan, { season = "summer", settings, uniforms, track, grain }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "landmarks";
  const materials = createBuildingMaterials({ uniforms, grain, own });
  const reach = settings.buildings;
  const detail = settings.detail;
  const turners = createTurners(object, materials.solid);
  const scratch = createScratch();
  const part = (asset, options) => asset.parts({ season, detail, ...options, own: scratch.own });

  const landmarks = plan.landmarks.filter((landmark) => ASSET[landmark.kind]).map((landmark, i) => {
    const asset = BUILDINGS[ASSET[landmark.kind]];
    const collector = createCollector();
    landmark.members.forEach((member, k) => {
      const parts = part(asset, { seed: i * 16 + k + 1 });
      const at = { x: member.x, y: member.y, z: member.z, yaw: member.yaw };
      collector.add(parts, at);
      if (parts.movers.sails) turners.add(parts.movers.sails, at, { speed: SAILS.base + SAILS.spread * ((k * 0.37) % 1), phase: k * 1.3, far: reach.far });
    });
    const lod = createLod(collector.merged(own), { materials, centre: [landmark.x, landmark.z], reach, name: `landmark-${landmark.id}` });
    object.add(lod.object);
    return { id: landmark.id, kind: landmark.kind, x: landmark.x, z: landmark.z, near: lod.near, far: lod.far, glow: lod.glow, lod };
  });

  const flights = plan.landmarks.filter((landmark) => landmark.kind === "balloons").flatMap((landmark) => landmark.members);
  const shapes = new Map();
  const shapeOf = (palette) => {
    if (!shapes.has(palette)) {
      const parts = BUILDINGS.balloon.parts({ season, detail, seed: palette + 1, own });
      shapes.set(palette, { near: parts.near[0].geometry, far: parts.far[0].geometry, glow: parts.glows[0] });
    }
    return shapes.get(palette);
  };
  const balloons = flights.map((flight) => {
    const shape = shapeOf(flight.palette);
    const mesh = new THREE.Mesh(shape.near, materials.solid);
    mesh.scale.setScalar(BALLOON_SIZE);
    mesh.castShadow = false;
    const burner = new THREE.Mesh(shape.glow, materials.glow);
    burner.visible = false;
    mesh.add(burner);
    object.add(mesh);
    return { mesh, flight, shape, burner };
  });
  scratch.release();

  let lit = false;
  return {
    object,
    landmarks,
    balloons,
    turners: turners.list,
    update(frame) {
      const { x, z } = frame.camera.position;
      for (const entry of landmarks) {
        entry.lod.update(frame.camera);
        if (entry.kind === "lighthouse" && entry.glow) entry.glow.visible = lit && Math.hypot(x - entry.x, z - entry.z) < reach.far;
      }
      for (const balloon of balloons) {
        const [bx, by, bz] = balloonAt(balloon.flight, frame.t);
        balloon.mesh.position.set(bx, by, bz);
        const close = Math.hypot(x - bx, z - bz) < reach.near * BALLOON_NEAR;
        balloon.mesh.geometry = close ? balloon.shape.near : balloon.shape.far;
        balloon.burner.visible = close && lit;
      }
      turners.update(frame, reach);
    },
    setEnvironment(env) {
      lit = setGlow(materials.glow, env.night);
      for (const entry of landmarks) entry.lod.light(lit);
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
