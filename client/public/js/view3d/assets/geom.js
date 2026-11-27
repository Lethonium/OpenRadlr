/**
 * Small geometry kit for the plant assets: vertex-coloured, non-indexed,
 * no UVs, ground at y = 0. Every function returns a fresh geometry.
 */
import * as THREE from "../../three.js";
import { mergeGeometries } from "../../../vendor/three/addons/utils/BufferGeometryUtils.js";

/** A sRGB hex or CSS colour as linear RGB, the space vertex colours are in. */
export const colour = (value) => new THREE.Color(value);

/**
 * Non-indexed, no UVs, with a flat vertex colour.
 * @param {import("../../three.js").BufferGeometry} source
 * @param {import("../../three.js").Color} color
 * @returns {import("../../three.js").BufferGeometry}
 */
export function paint(source, color) {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  geometry.deleteAttribute("uv");
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) array.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(array, 3));
  return geometry;
}

const placed = (geometry, x, y, z) => geometry.translate(x, y, z);

/** A cylinder standing on `y` (its centre), optionally without end caps. */
export const cylinder = (top, bottom, height, segments, color, x = 0, y = 0, z = 0, open = false) =>
  placed(paint(new THREE.CylinderGeometry(top, bottom, height, segments, 1, open), color), x, y, z);

export const cone = (radius, height, segments, color, x = 0, y = 0, z = 0, open = false) => placed(paint(new THREE.ConeGeometry(radius, height, segments, 1, open), color), x, y, z);

export const ico = (radius, detail, color, x = 0, y = 0, z = 0) => placed(paint(new THREE.IcosahedronGeometry(radius, detail), color), x, y, z);

export const box = (width, height, depth, color, x = 0, y = 0, z = 0) => placed(paint(new THREE.BoxGeometry(width, height, depth), color), x, y, z);

/**
 * A box spanned by three edge vectors (full lengths) around `center`, not necessarily at right angles: a sloping
 * deck, a limb between two points. A left-handed set is turned round (the box is the same) so its faces point out.
 */
export function orientedBox(center, u, v, w, color) {
  const edges = [u, v, w].map((edge) => new THREE.Vector3(...edge));
  const matrix = new THREE.Matrix4().makeBasis(...edges);
  if (matrix.determinant() < 0) matrix.makeBasis(edges[0], edges[1], edges[2].negate());
  matrix.setPosition(...center);
  return paint(new THREE.BoxGeometry(1, 1, 1), color).applyMatrix4(matrix);
}

/** A thin cylinder between two points. */
export function rod(from, to, radius, color, segments = 5, open = false) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const geometry = paint(new THREE.CylinderGeometry(radius, radius, 1, segments, 1, open), color);
  const matrix = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()), new THREE.Vector3(1, a.distanceTo(b), 1));
  return geometry.applyMatrix4(matrix);
}

/** Darkens vertex colours towards the bottom: factor `low` at `minY`, `high` at `maxY`. */
export function shadeY(geometry, low, high, minY, maxY) {
  const position = geometry.attributes.position;
  const color = geometry.attributes.color;
  for (let i = 0; i < position.count; i += 1) {
    const t = Math.min(1, Math.max(0, (position.getY(i) - minY) / (maxY - minY)));
    const f = low + (high - low) * t;
    color.setXYZ(i, color.getX(i) * f, color.getY(i) * f, color.getZ(i) * f);
  }
  return geometry;
}

/** Multiplies every vertex colour of a geometry. */
export function tint(geometry, color) {
  const array = geometry.attributes.color;
  for (let i = 0; i < array.count; i += 1) array.setXYZ(i, array.getX(i) * color.r, array.getY(i) * color.g, array.getZ(i) * color.b);
  return geometry;
}

/** Lumpy surface: moves vertices along smooth waves, so a sphere becomes a canopy. */
export function lumpy(geometry, amount = 0.06) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.9 - y * 2.3) + 0.5 * Math.sin(x * 7.3 - z * 6.1 + y * 5.2);
    p.setXYZ(i, x * (1 + amount * n), y + amount * 1.6 * n, z * (1 + amount * n));
  }
  return geometry;
}

/**
 * Merges geometries with the same attributes and disposes of the inputs.
 * @param {import("../../three.js").BufferGeometry[]} list
 * @returns {import("../../three.js").BufferGeometry}
 */
export function merge(list) {
  const merged = mergeGeometries(list, false);
  for (const geometry of list) geometry.dispose();
  return merged;
}

/** Triangles in a geometry, indexed or not. */
export const triangleCount = (geometry) => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

/** `count` entries of `list`, evenly spread from first to last. */
export function spread(list, count) {
  if (list.length <= count) return list;
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
}

/** Freezes a table and everything in it. */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * Moves geometries together so the lowest point of all of them is on y = 0.
 * @param {import("../../three.js").BufferGeometry[]} list
 * @returns {import("../../three.js").BufferGeometry[]} the same geometries
 */
export function groundAll(list) {
  const lowest = Math.min(...list.map((geometry) => (geometry.computeBoundingBox(), geometry.boundingBox.min.y)));
  for (const geometry of list) geometry.translate(0, -lowest, 0);
  return list;
}
