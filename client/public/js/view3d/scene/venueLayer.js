/**
 * The bike cafés and the outdoor gyms from the placements the world's worker made (`world.cafeSites`, `world.gyms`):
 * each café standing on its site with its front turned to the road (snow on the roofs in winter), the cafés'
 * paved forecourts along the road as one mesh, and each gym's pad, mat and rig. Static, casting and receiving shadows.
 * The cafés' glass and string lights glow a little more at dusk and night (`env.night`). The forecourt's colours are
 * the biome's palette.
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { createBikeCafe } from "../assets/buildings/bikeCafe.js";
import { createOutdoorGym } from "../assets/props/outdoorGym.js";
import { resolveBiome } from "../biomes/index.js";
import { createOwner } from "./tracker.js";

/** How much the glass gives off of its own colour by day, and the most it adds at night. */
const GLOW = Object.freeze({ day: 0.05, night: 0.7 });
/** How far the forecourt's kerb reaches below its surface (metres). */
const KERB = 0.4;

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);

/**
 * The paving of every site as one geometry: for each 2 m step a surface quad from the road's edge outwards and the
 * kerb face beside the road, all facing the way they should whichever way the points run.
 */
function forecourtGeometry(sites, palette) {
  const positions = [];
  const normals = [];
  const colors = [];
  const stone = linear(palette.forecourt);
  const edge = linear(palette.forecourtEdge);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const triangle = (a, b, c, color, toward) => {
    const u = sub(b, a);
    const v = sub(c, a);
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    n = n.map((value) => value / length);
    const flip = n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] < 0;
    const corners = flip ? [a, c, b] : [a, b, c];
    if (flip) n = n.map((value) => -value);
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...n);
      colors.push(color.r, color.g, color.b);
    }
  };
  const down = (point) => [point[0], point[1] - KERB, point[2]];
  for (const { forecourt } of sites) {
    const { inner, outer } = forecourt;
    for (let i = 0; i + 1 < inner.length; i += 1) {
      triangle(inner[i], outer[i], outer[i + 1], stone, [0, 1, 0]);
      triangle(inner[i], outer[i + 1], inner[i + 1], stone, [0, 1, 0]);
      // The kerb faces the road: away from the paving.
      const toRoad = [inner[i][0] - outer[i][0], 0, inner[i][2] - outer[i][2]];
      triangle(inner[i], inner[i + 1], down(inner[i + 1]), edge, toRoad);
      triangle(inner[i], down(inner[i + 1]), down(inner[i]), edge, toRoad);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * @param {{biome?: string, cafeSites?: {id: string | null, name: string, style: string, position: number[], yaw: number, forecourt: {inner: number[][], outer: number[][]}}[],
 *   gyms?: {position: number[], yaw: number, drop: number, signLift: number}[]}} world
 * @param {{season?: string, settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"],
 *   biome?: import("../biomes/index.js").Biome}} options
 */
export function createVenueLayer(world, { season = "summer", settings, uniforms, track, biome = resolveBiome(world.biome) }) {
  const { own, disposeAll } = createOwner(track);
  const { cafeSites = [], gyms = [] } = world;
  const object = new THREE.Group();
  object.name = "venues";
  const hook = (material) => (uniforms ? addHook(addHook(material, cloudShadows(uniforms)), heightFog(uniforms)) : material);
  const glows = [];

  cafeSites.forEach((site, i) => {
    const cafe = createBikeCafe({ style: site.style, name: site.name, snow: season === "winter", own, uniforms });
    cafe.name = `cafe-${site.id ?? i}`;
    // The café's front is its +z; the site's yaw turns the model's -z to the road, so the front turns half a circle more.
    cafe.position.fromArray(site.position);
    cafe.rotation.y = site.yaw + Math.PI;
    glows.push(cafe.userData.glow);
    object.add(cafe);
  });

  if (cafeSites.length > 0) {
    const paving = new THREE.Mesh(own(forecourtGeometry(cafeSites, biome.palette)), hook(own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))));
    paving.name = "forecourts";
    paving.receiveShadow = true;
    object.add(paving);
  }

  gyms.forEach((gym, i) => {
    const pad = createOutdoorGym({ drop: gym.drop, signLift: gym.signLift, own, uniforms });
    pad.name = `gym-${i}`;
    pad.position.fromArray(gym.position);
    pad.rotation.y = gym.yaw;
    object.add(pad);
  });

  object.traverse((child) => {
    if (child.isMesh) child.castShadow = child.castShadow && settings.shadows;
  });

  return {
    object,
    update() {},
    setEnvironment(env) {
      const night = Math.min(1, Math.max(0, env.night ?? 0));
      for (const glow of glows) glow.emissiveIntensity = GLOW.day + GLOW.night * night;
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
