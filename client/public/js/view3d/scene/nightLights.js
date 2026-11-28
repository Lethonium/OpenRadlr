/**
 * Light for the night: a soft pool on the ground under every planned street lamp (one merged additive mesh), the
 * nearest `settings.lampLights` lamps as warm point lights, and the rider's headlight, a spot on the front of the bike
 * aimed along the heading, on at every level so the road stays readable. All strengths follow `env.night`. By day
 * the lights are hidden, not only dimmed: a hidden light is left out of every lit material's shader, where even at
 * strength 0 each one costs every fragment its loop (and the headlight its shadow pass). Dusk changes those shaders
 * once; `showNightState` lets the view prepare them ahead (see `View3D`).
 */
import * as THREE from "../../three.js";
import { heightSampler } from "./grassField.js";
import { createOwner } from "./tracker.js";

/** Metres across a lamp's pool, its peak opacity at full night, and its lift above the ground. */
const POOL = Object.freeze({ size: 11, opacity: 0.6, lift: 0.12 });
/** Colour of lamp light, linear-ish warm. */
const WARM = Object.freeze([1, 0.78, 0.45]);
/** The lamp lights: how high above the ground, strength, reach in metres. */
const LAMP = Object.freeze({ height: 4.2, intensity: 60, distance: 22 });
/**
 * Where the headlight sits, from the focus (my bike's bottom bracket): `ahead` metres along the heading and `height`
 * up. A lamp on the bars shines forward from in front of them, so nothing of the bike may be inside its cone: the
 * light sits just ahead of the furthest bars (time-trial extensions) and front hub of any bike, or its shadow map
 * would throw the bars and hands onto the road.
 */
export const HEADLIGHT_MOUNT = Object.freeze({ ahead: 0.95, height: 1 });
/** The headlight: metres ahead of the focus it aims, cone, strength, reach. */
const HEAD = Object.freeze({ aim: 25, angle: 0.5, penumbra: 0.6, intensity: 900, distance: 80, shadowMap: 1024 });

/** A soft round falloff as a data texture, for the pools. */
function poolTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.min(1, Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2);
      const a = (1 - d) ** 2;
      data.set([255, 255, 255, Math.round(255 * a)], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Every planned lamp as [x, y, z], the ground's height under it.
 * @param {{settlements?: {lamps: {x: number, z: number}[], ground?: number[]}[]}|undefined} plan
 * @param {{near: import("../../world/groundGrid.js").GroundGrid}} [ground]
 */
function lampSpots(plan, ground) {
  const heightAt = ground && heightSampler(ground.near);
  const spots = [];
  for (const settlement of plan?.settlements ?? []) {
    const average = settlement.ground?.length ? settlement.ground.reduce((a, b) => a + b, 0) / settlement.ground.length : 0;
    for (const { x, z } of settlement.lamps) spots.push([x, heightAt?.(x, z) ?? average, z]);
  }
  return spots;
}

/**
 * @param {{settlements?: object[]}|undefined} plan
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"], ground?: {near: object}}} options
 */
export function createNightLights(plan, { settings, track, ground }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "nightLights";
  const spots = lampSpots(plan, ground);

  const half = POOL.size / 2;
  const positions = new Float32Array(spots.length * 12);
  const uvs = new Float32Array(spots.length * 8);
  const indices = new Uint32Array(spots.length * 6);
  spots.forEach(([x, y, z], i) => {
    positions.set([x - half, y + POOL.lift, z - half, x + half, y + POOL.lift, z - half, x + half, y + POOL.lift, z + half, x - half, y + POOL.lift, z + half], i * 12);
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    indices.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
  });
  const geometry = own(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = own(new THREE.MeshBasicMaterial({ map: own(poolTexture()), color: new THREE.Color(...WARM), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const pools = new THREE.Mesh(geometry, material);
  pools.name = "lamp-pools";
  pools.frustumCulled = false;
  pools.renderOrder = 2;
  object.add(pools);

  const lights = Array.from({ length: Math.min(settings.lampLights, spots.length) }, () => {
    const light = new THREE.PointLight(new THREE.Color(...WARM), 0, LAMP.distance, 2);
    light.name = "lamp-light";
    object.add(light);
    return light;
  });

  const headlight = new THREE.SpotLight(0xfff2d8, 0, HEAD.distance, HEAD.angle, HEAD.penumbra, 1.5);
  headlight.name = "headlight";
  headlight.castShadow = settings.headlightShadows;
  if (headlight.castShadow) headlight.shadow.mapSize.set(HEAD.shadowMap, HEAD.shadowMap);
  object.add(headlight, headlight.target);

  let night = 0;
  const nearest = [];
  const all = [...lights, headlight];
  /** Lights take part in the lighting only while the night has begun. */
  const showLights = (on) => {
    for (const light of all) light.visible = on;
  };
  showLights(false);
  return {
    object,
    lights,
    headlight,
    update(frame) {
      const [fx, fy, fz] = frame.focus;
      const [hx, hz] = frame.heading ?? [0, -1];
      headlight.position.set(fx + hx * HEADLIGHT_MOUNT.ahead, fy + HEADLIGHT_MOUNT.height, fz + hz * HEADLIGHT_MOUNT.ahead);
      headlight.target.position.set(fx + hx * HEAD.aim, fy, fz + hz * HEAD.aim);
      headlight.target.updateMatrixWorld();
      if (!lights.length || night <= 0) return;
      // The `lights.length` lamps nearest the camera: a short sorted insertion list over every lamp.
      const { x, z } = frame.camera.position;
      nearest.length = 0;
      for (const spot of spots) {
        const d = (spot[0] - x) ** 2 + (spot[2] - z) ** 2;
        if (nearest.length === lights.length && d >= nearest[nearest.length - 1].d) continue;
        let at = nearest.length;
        while (at > 0 && nearest[at - 1].d > d) at -= 1;
        nearest.splice(at, 0, { d, spot });
        if (nearest.length > lights.length) nearest.pop();
      }
      lights.forEach((light, i) => light.position.set(nearest[i].spot[0], nearest[i].spot[1] + LAMP.height, nearest[i].spot[2]));
    },
    setEnvironment(env) {
      night = Math.min(1, Math.max(0, env.night));
      material.opacity = POOL.opacity * night;
      for (const light of lights) light.intensity = LAMP.intensity * night;
      headlight.intensity = HEAD.intensity * night;
      showLights(night > 0);
    },
    /** Whether the lights are on (the night has begun). */
    atNight: () => night > 0,
    /**
     * Shows the lights as at night (or, with `on` false, as by day) until the returned function puts them back: the
     * view compiles the other half of the day's shaders ahead with it.
     */
    showNightState(on = true) {
      const was = all.map((light) => light.visible);
      showLights(on);
      return () => all.forEach((light, i) => (light.visible = was[i]));
    },
    dispose() {
      object.clear();
      headlight.shadow.map?.dispose();
      disposeAll();
    },
  };
}
