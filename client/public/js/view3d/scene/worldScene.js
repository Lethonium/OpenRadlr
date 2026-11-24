/**
 * The world as one Three.js scene: terrain, sea and sky layers, a hemisphere
 * light and the sun (or, at night, the moon) with a shadow box that follows
 * the camera's focus. It owns no look of its own: colours and directions
 * arrive through `setEnvironment`, positions through `update`.
 */
import * as THREE from "../../three.js";
import { createGrainTexture, createSharedUniforms } from "../assets/materials.js";
import { createSea } from "./sea.js";
import { createSky } from "./sky.js";
import { createTerrainLayer } from "./terrainLayer.js";
import { createOwner } from "./tracker.js";

/** Sun placement and shadow box, in metres. */
export const SUN = Object.freeze({ distance: 1800, shadowHalf: 130, near: 10, far: 4000, bias: -0.00025, normalBias: 0.35 });
/** Strength of the drifting cloud shadows by day. */
const CLOUD_SHADOW = 0.24;

/**
 * @typedef {object} Frame
 * @property {number} dt seconds since the last frame
 * @property {number} t seconds on the scene's clock
 * @property {import("../../three.js").Camera} camera
 * @property {number[]} focus world point the shadow box is centred on
 * @property {number} [shadowHalf] half the shadow box's edge, metres
 * @property {boolean} [shadows] false switches the sun's shadow off for this frame (the drone)
 */

/**
 * Builds the scene for a built world.
 * @param {{ground?: {near: object, far: object}}} world the scene object from `buildScene`
 * @param {{settings: import("../quality.js").QualitySettings, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createWorldScene(world, { settings, track }) {
  const { own, disposeAll } = createOwner(track);
  const uniforms = createSharedUniforms();
  const grain = own(createGrainTexture());
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.0002);

  const layers = [createSky({ uniforms, track })];
  if (world.ground) {
    uniforms.fogBase.value = world.ground.near.water;
    layers.push(createSea(world.ground, { uniforms, track }), createTerrainLayer(world.ground, { uniforms, settings, track, grain }));
  }
  for (const layer of layers) scene.add(layer.object);

  const hemisphere = new THREE.HemisphereLight();
  hemisphere.name = "hemisphere";
  scene.add(hemisphere);
  const sun = own(new THREE.DirectionalLight(0xffffff, 3));
  sun.name = "sun";
  sun.shadow.bias = SUN.bias;
  sun.shadow.normalBias = SUN.normalBias;
  sun.shadow.camera.near = SUN.near;
  sun.shadow.camera.far = SUN.far;
  scene.add(sun, sun.target);

  const keyDirection = new THREE.Vector3(0, 1, 0);
  let shadowSize = 0;
  let shadowsOn = true;

  /** Applies the quality's shadow map: its size, or none. */
  const setQuality = (next) => {
    const size = next.shadowMapSize;
    if (size !== shadowSize) {
      shadowSize = size;
      sun.shadow.mapSize.set(Math.max(1, size), Math.max(1, size));
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = size > 0 && shadowsOn;
  };
  setQuality(settings);

  /** Puts the sun on its ray from `focus`, the shadow box snapped to shadow texels so it does not shimmer. */
  const placeSun = (focus, half) => {
    const texel = shadowSize > 0 ? (2 * half) / shadowSize : 0;
    const snap = (v) => (texel > 0 ? Math.round(v / texel) * texel : v);
    sun.target.position.set(snap(focus[0]), focus[1], snap(focus[2]));
    sun.position.copy(sun.target.position).addScaledVector(keyDirection, SUN.distance);
    sun.target.updateMatrixWorld();
  };
  const lastFocus = [0, 0, 0];
  placeSun(lastFocus, SUN.shadowHalf);

  return {
    scene,
    sun,
    setQuality,
    /** @param {Frame} frame */
    update(frame) {
      uniforms.time.value += frame.dt;
      shadowsOn = frame.shadows !== false;
      sun.castShadow = shadowSize > 0 && shadowsOn;
      const half = frame.shadowHalf ?? SUN.shadowHalf;
      const box = sun.shadow.camera;
      if (Math.abs(box.right - half) > 1) {
        box.left = -half;
        box.right = half;
        box.top = half;
        box.bottom = -half;
        box.updateProjectionMatrix();
      }
      lastFocus[0] = frame.focus[0];
      lastFocus[1] = frame.focus[1];
      lastFocus[2] = frame.focus[2];
      placeSun(lastFocus, half);
      for (const layer of layers) layer.update(frame);
    },
    setEnvironment(env) {
      const key = env.night ? env.moon : env.sun;
      keyDirection.fromArray(key);
      sun.color.setRGB(...env.sunColor);
      sun.intensity = env.sunIntensity;
      hemisphere.color.setRGB(...env.hemiSky);
      hemisphere.groundColor.setRGB(...env.hemiGround);
      hemisphere.intensity = env.hemiIntensity;
      scene.fog.color.setRGB(...env.fogColor);
      scene.fog.density = env.fogDensity;
      uniforms.cloudShadow.value = (1 - env.night) * CLOUD_SHADOW;
      placeSun(lastFocus, sun.shadow.camera.right);
      for (const layer of layers) layer.setEnvironment(env);
    },
    dispose() {
      for (const layer of layers) layer.dispose();
      scene.clear();
      disposeAll();
    },
  };
}
