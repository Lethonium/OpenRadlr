/**
 * Shapes the buildings share: a gabled roof, flat quads that sit on a wall,
 * and moving a list of geometries. Everything is vertex-coloured through
 * `paint`, in local space with the front facing +z.
 */
import * as THREE from "../../../three.js";
import { paint } from "../geom.js";

/**
 * A gabled roof prism on y = 0: the ridge runs along x, the slopes fall toward +z and -z.
 * @param {number} width along the ridge
 * @param {number} depth across the slopes
 * @param {number} height ridge height
 * @param {import("../../../three.js").Color} color
 * @returns {import("../../../three.js").BufferGeometry}
 */
export function gable(width, depth, height, color) {
  const [a, b] = [width / 2, depth / 2];
  const corners = {
    fl: [-a, 0, b], fr: [a, 0, b], bl: [-a, 0, -b], br: [a, 0, -b], rl: [-a, height, 0], rr: [a, height, 0],
  };
  const faces = [
    ["fl", "fr", "rr"], ["fl", "rr", "rl"], // front slope
    ["br", "bl", "rl"], ["br", "rl", "rr"], // back slope
    ["bl", "fl", "rl"], ["fr", "br", "rr"], // gable ends
    ["fl", "bl", "br"], ["fl", "br", "fr"], // underside
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(faces.flat().flatMap((key) => corners[key]), 3));
  geometry.computeVertexNormals();
  return paint(geometry, color);
}

/**
 * A flat quad at (x, y, z) facing +z, turned by `yaw` about y (π faces -z, π/2 faces +x).
 * @returns {import("../../../three.js").BufferGeometry}
 */
export function quad(width, height, color, x, y, z, yaw = 0) {
  return paint(new THREE.PlaneGeometry(width, height), color).rotateY(yaw).translate(x, y, z);
}

/**
 * Turns a geometry built facing +z at the origin onto a wall: yaw about y, then to (x, y, z).
 * @template {import("../../../three.js").BufferGeometry} G
 * @param {G} geometry
 * @returns {G}
 */
export const onWall = (geometry, x, y, z, yaw = 0) => geometry.rotateY(yaw).translate(x, y, z);

/** The wall's outward step for a yaw: (sin yaw, cos yaw) in x/z. */
export const facing = (yaw) => [Math.sin(yaw), Math.cos(yaw)];

/** Moves every geometry of a list by (x, y, z) and returns the list. */
export function shift(list, x, y, z) {
  for (const geometry of list) geometry.translate(x, y, z);
  return list;
}

/** Turns every geometry of a list about y, then moves it. */
export function place(list, x, y, z, yaw = 0) {
  for (const geometry of list) geometry.rotateY(yaw).translate(x, y, z);
  return list;
}

/** The seeded helpers a builder wants: pick from a list, a number in a range, a coin. */
export function dice(random) {
  return {
    pick: (list) => list[Math.floor(random() * list.length)],
    range: (low, high) => low + (high - low) * random(),
    chance: (probability) => random() < probability,
  };
}
