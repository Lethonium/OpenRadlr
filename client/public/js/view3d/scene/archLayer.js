/**
 * The arches and banners over the road, from the placements the world's worker made (`world.arches`): one group per
 * placement, standing on the road at its spot and turned along it. Static, all casting shadows. Their colours are the
 * biome's.
 */
import * as THREE from "../../three.js";
import { createRouteArch } from "../assets/props/routeArch.js";
import { BANNERS } from "../banners.js";
import { createOwner } from "./tracker.js";

const DARK_INK = Object.freeze([0.12, 0.12, 0.14]);
const LIGHT_INK = Object.freeze([1, 1, 1]);
/** The biome's arch colour for each marker kind. */
const BEAM = Object.freeze({ start_finish: "start", climb: "climb", sprint: "sprint" });

/**
 * @param {{arches?: {kind: string, text: string, position: number[], yaw: number, halfWidth: number, height: number, banner: boolean}[]}} world
 * @param {{biome: import("../biomes/index.js").Biome, settings?: object, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createArchLayer(world, { biome, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "arches";
  for (const placement of world.arches ?? []) {
    const halfway = placement.kind === "halfway";
    const beam = placement.banner ? (halfway ? BANNERS.halfway : biome.arch.climb) : biome.arch[BEAM[placement.kind] ?? "climb"];
    const group = createRouteArch({
      kind: placement.kind,
      text: placement.text,
      halfWidth: placement.halfWidth,
      height: placement.height,
      banner: placement.banner,
      colors: { post: biome.arch.post, beam, ink: halfway ? DARK_INK : LIGHT_INK, chequer: biome.arch.chequer },
      own,
      uniforms,
    });
    group.position.fromArray(placement.position);
    group.rotation.y = placement.yaw;
    object.add(group);
  }
  return {
    object,
    update() {},
    setEnvironment() {},
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
