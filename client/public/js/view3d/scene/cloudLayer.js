/**
 * The puffy low-poly clouds high above the island, one merged mesh: they give the drone's view its sense of
 * scale. Unlit and fogged; the environment tints them (white by day, warm at sunset, dark by night, grey under
 * cloud). They cast no shadow and float far above the road, out of the rider's way.
 */
import * as THREE from "../../three.js";
import { cloudGeometry } from "../assets/cloud.js";
import { createOwner } from "./tracker.js";

/** The sun's height (its y) below which it tints the clouds, and above which they stay white. */
const WARM_BELOW = Object.freeze([0.2, 0.6]);
/** How far the low sun's colour tints a cloud, and the grey and strength overcast pulls it to. */
const SUN_TINT = 0.85;
const OVERCAST_GREY = Object.freeze([0.55, 0.58, 0.64]);
const OVERCAST_PULL = 0.5;
/** The darkest a night cloud is, per channel (a dim moonlit blue). */
const NIGHT_CEILING = 0.3;
/** Rings and segments of a puff when the quality draws no fine detail. */
const COARSE = Object.freeze([3, 6]);

/**
 * The tint of the clouds in `env`, linear RGB.
 * @param {import("../../world/daylight.js").Environment} env
 * @returns {number[]}
 */
export function cloudTint(env) {
  const [r, g, b] = env.sunColor;
  const top = Math.max(r, g, b, 1e-6);
  const t = Math.min(1, Math.max(0, (env.sun[1] - WARM_BELOW[0]) / (WARM_BELOW[1] - WARM_BELOW[0])));
  const warmth = (1 - t * t * (3 - 2 * t)) * SUN_TINT;
  const day = [r, g, b].map((v) => 1 + (v / top - 1) * warmth);
  const peak = Math.max(...env.skyHorizon, 1e-6);
  const dark = env.skyHorizon.map((v) => (v / peak) * NIGHT_CEILING);
  const pull = (env.overcast ?? 0) * OVERCAST_PULL;
  return day.map((v, i) => (v + (dark[i] - v) * env.night) * (1 - pull) + OVERCAST_GREY[i] * pull * (1 - env.night * 0.7));
}

/**
 * @param {import("../../world/clouds.js").CloudPlan | undefined} plan
 * @param {{settings: import("../quality.js").QualitySettings, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createCloudLayer(plan, { settings, track }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "clouds";
  const geometry = plan ? cloudGeometry(plan, settings.detail ? {} : { segments: COARSE }) : null;
  const material = own(new THREE.MeshBasicMaterial({ vertexColors: true, flatShading: true, fog: true }));
  if (geometry) {
    const mesh = new THREE.Mesh(own(geometry), material);
    mesh.name = "clouds-puffs";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    object.add(mesh);
  }

  return {
    object,
    update() {},
    setEnvironment(env) {
      material.color.setRGB(...cloudTint(env));
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
