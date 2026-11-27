/**
 * Grass around the camera: the quality's rings of blades, over height and
 * colour textures baked from the near ground grid and the plan's masks.
 */
import * as THREE from "../../three.js";
import { seededRandom } from "../../world/noise.js";
import { createGrassRing, ringSet } from "../assets/nature/grass.js";
import { bakeGrassClear, bakeGroundTextures, grassWeights } from "./grassField.js";
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

/** Where blade roots may stand (`bakeGrassClear`), byte per texel, nearest; no masks: everywhere. */
function clearTexture(masks) {
  const clear = masks ? bakeGrassClear(masks) : { x0: -1e6, z0: -1e6, width: 2e6, depth: 2e6, columns: 1, rows: 1, data: Uint8Array.of(255) };
  const texture = new THREE.DataTexture(clear.data, clear.columns, clear.rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // Rows of single bytes are not 4-aligned.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { texture, box: new THREE.Vector4(clear.x0, clear.z0, clear.width, clear.depth) };
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
  const clear = clearTexture(plan?.masks);
  own(clear.texture);
  const random = seededRandom(SEED);
  const rings = ringSet(settings.grassRings).map((ring) => createGrassRing({ ring, world: baked.world, res: baked.res, heightTex, colorTex, clearTex: clear.texture, clearBox: clear.box, uniforms, random, track: own }));
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
