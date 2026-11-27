/**
 * Rain and snow in a box round the camera, falling on the GPU (see
 * `fallShader.js`): only the draw range changes with the weather. A storm adds
 * a seeded lightning flash every 6 to 14 seconds of the scene's clock, exposed
 * as `flash` (1 at the bolt, 0 after `FLASH_S`).
 */
import * as THREE from "../../three.js";
import { seededRandom } from "../../world/noise.js";
import { FALL_BOX, createFallUniforms, fallMaterial } from "./fallShader.js";
import { createOwner } from "./tracker.js";

/** Seed of the drops and of the lightning. */
const SEED = 0x7a1d;
/** Seconds a flash lasts, and the gap between bolts. */
export const FLASH_S = 0.15;
const BOLT_GAP = Object.freeze([6, 14]);
/** Rain's streaks and snow's flakes: sizes and the opacity of full rain. */
const RAIN_OPACITY = 0.6;
const FLAKE_SIZE = 0.45;
/** Rain is a streak below this strength of fall; above it, full opacity. */
const FULL_RAIN = 0.45;

/** A soft white disc as a data texture, for the flakes. */
function discTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, Math.min(1, (1 - d) / 0.45));
      data.set([255, 255, 255, Math.round(255 * a)], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {{settings: import("../quality.js").QualitySettings, uniforms: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createWeatherLayer({ settings, track }) {
  const { own, disposeAll } = createOwner(track);
  const random = seededRandom(SEED);
  const shared = createFallUniforms();
  const box = () => [(random() - 0.5) * FALL_BOX, (random() - 0.5) * 80, (random() - 0.5) * FALL_BOX];
  const group = new THREE.Group();
  group.name = "weather";

  const rainCount = settings.weather.rain;
  const rainPositions = new Float32Array(rainCount * 6);
  const rainSpeed = new Float32Array(rainCount * 2);
  const rainEnd = new Float32Array(rainCount * 2);
  for (let i = 0; i < rainCount; i += 1) {
    const at = box();
    const speed = 0.85 + random() * 0.3;
    rainPositions.set([...at, ...at], i * 6);
    rainSpeed[i * 2] = rainSpeed[i * 2 + 1] = speed;
    rainEnd[i * 2 + 1] = 1;
  }
  const rainGeometry = own(new THREE.BufferGeometry());
  rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  rainGeometry.setAttribute("aV", new THREE.BufferAttribute(rainSpeed, 1));
  rainGeometry.setAttribute("aEnd", new THREE.BufferAttribute(rainEnd, 1));
  const rainMaterial = own(fallMaterial(new THREE.LineBasicMaterial({ color: 0xaabbd0, transparent: true, opacity: RAIN_OPACITY, depthWrite: false }), { fall: 38, sway: 0, spin: 0, drift: 1, line: true }, shared));
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.name = "rain";

  const snowCount = settings.weather.snow;
  const snowPositions = new Float32Array(snowCount * 3);
  const snowSpeed = new Float32Array(snowCount);
  for (let i = 0; i < snowCount; i += 1) {
    snowPositions.set(box(), i * 3);
    snowSpeed[i] = 0.7 + random() * 0.6;
  }
  const snowGeometry = own(new THREE.BufferGeometry());
  snowGeometry.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  snowGeometry.setAttribute("aV", new THREE.BufferAttribute(snowSpeed, 1));
  const snowMaterial = own(fallMaterial(new THREE.PointsMaterial({ size: FLAKE_SIZE, map: own(discTexture()), color: 0xffffff, transparent: true, depthWrite: false }), { fall: 3.2, sway: 0.6, spin: 1.3, drift: 0.4 }, shared));
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.name = "snow";

  for (const part of [rain, snow]) {
    part.frustumCulled = false;
    part.visible = false;
    group.add(part);
  }

  const gap = () => BOLT_GAP[0] + random() * (BOLT_GAP[1] - BOLT_GAP[0]);
  let storm = false;
  let nextBolt = null;
  let boltAt = -Infinity;

  return {
    object: group,
    /** 1 at a lightning bolt, fading to 0 within `FLASH_S`. */
    flash: 0,
    update(frame) {
      const { x, y, z } = frame.camera.position;
      Object.assign(shared.uCam.value, { x, y, z });
      shared.uT.value = frame.t % 600;
      shared.uWOff.value.x = (shared.uWOff.value.x + Math.sin(frame.t * 0.1) * 3 * frame.dt) % FALL_BOX;
      shared.uWOff.value.y = (shared.uWOff.value.y + Math.cos(frame.t * 0.13) * 2 * frame.dt) % FALL_BOX;
      if (!storm) {
        this.flash = 0;
        nextBolt = null;
        return;
      }
      // A clock that jumps back (a restart) must not leave the next bolt far in the future.
      if (nextBolt === null || nextBolt > frame.t + BOLT_GAP[1]) nextBolt = frame.t + gap();
      if (frame.t >= nextBolt) {
        boltAt = frame.t;
        nextBolt = frame.t + gap();
      }
      this.flash = Math.max(0, 1 - (frame.t - boltAt) / FLASH_S);
    },
    setEnvironment(env) {
      const falling = Math.min(1, Math.max(0, env.precipitation));
      storm = env.storm === true;
      const snowing = env.snowing === true && falling > 0;
      snow.visible = snowing;
      rain.visible = !snowing && falling > 0;
      if (snowing) snowGeometry.setDrawRange(0, Math.floor(snowCount * falling));
      else rainGeometry.setDrawRange(0, Math.floor(rainCount * falling) * 2);
      rainMaterial.opacity = RAIN_OPACITY * Math.min(1, falling / FULL_RAIN);
    },
    dispose() {
      group.clear();
      disposeAll();
    },
  };
}
