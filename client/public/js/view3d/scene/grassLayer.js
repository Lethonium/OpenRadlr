/**
 * Grass around the camera: the quality's rings of blades, over height and
 * colour textures baked from the near ground grid and the plan's masks.
 */
import * as THREE from "../../three.js";
import { seededRandom } from "../../world/noise.js";
import { createGrassRing, ringSet } from "../assets/nature/grass.js";
import { bakeGroundTextures, grassWeights } from "./grassField.js";
import { createOwner } from "./tracker.js";

/** Seed of the blade roots. */
const SEED = 0x6a55;

/** A square float texture, read without filtering (the shader interpolates itself). */
function dataTexture(data, res, format) {
  const texture = new THREE.DataTexture(data, res, res, format, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {{near: import("../../world/groundGrid.js").GroundGrid}} ground
 * @param {{masks?: import("../../world/plan/masks.js").Masks}} [plan]
 * @param {{settings: import("../quality.js").QualitySettings, uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createGrassLayer(ground, plan, { settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "grass";
  const baked = bakeGroundTextures(ground.near, grassWeights(ground.near, plan?.masks));
  const heightTex = own(dataTexture(baked.heights, baked.res, THREE.RedFormat));
  const colorTex = own(dataTexture(baked.colors, baked.res, THREE.RGBAFormat));
  const random = seededRandom(SEED);
  const rings = ringSet(settings.grassRings).map((ring) => createGrassRing({ ring, world: baked.world, res: baked.res, heightTex, colorTex, uniforms, random, track: own }));
  for (const ring of rings) object.add(ring.object);
  return {
    object,
    rings,
    /** Re-centres every ring on the camera; the blades wrap around, so nothing is rebuilt. */
    update(frame) {
      for (const ring of rings) ring.update(frame.camera.position);
    },
    setEnvironment() {},
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
