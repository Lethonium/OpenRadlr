/**
 * A golden lemon floating over the road (see ride/lemons.js): a stretched ellipsoid with a nub at each end and a leaf,
 * centred on the origin with its long axis along x, about 1 m long (easy to spot close up, a yellow dot further on:
 * an easter egg, not a beacon). Vertex colours; the layer makes it glow.
 */
import * as THREE from "../../../three.js";
import { createOwner } from "../owner.js";
import { merge, paint } from "../geom.js";

export const LEMON_COLORS = Object.freeze({ peel: [1.0, 0.8, 0.08], nub: [0.92, 0.68, 0.06], leaf: [0.24, 0.62, 0.22] });

const linear = ([r, g, b]) => new THREE.Color().setRGB(r, g, b);

/** An ellipsoid of `radii` at `centre`, flat-shaded, in `rgb`. */
function ellipsoid(centre, radii, rgb, rings, segments) {
  const geometry = paint(new THREE.SphereGeometry(1, segments, rings), linear(rgb));
  geometry.scale(...radii);
  geometry.translate(...centre);
  geometry.computeVertexNormals();
  return geometry;
}

/** The lemon's merged, vertex-coloured geometry (long axis along x, centred on the origin). */
export function lemonGeometry() {
  const parts = [ellipsoid([0, 0, 0], [0.44, 0.3, 0.3], LEMON_COLORS.peel, 5, 10)];
  for (const side of [-1, 1]) parts.push(ellipsoid([side * 0.45, 0, 0], [0.08, 0.08, 0.08], LEMON_COLORS.nub, 3, 6));
  parts.push(ellipsoid([0.3, 0.25, 0], [0.16, 0.03, 0.08], LEMON_COLORS.leaf, 2, 6));
  return merge(parts);
}

export const meta = Object.freeze({
  id: "lemon",
  name: "Golden lemon", // i18n-ok
  category: "nature", // i18n-ok
  description: "A golden lemon that floats over the road: a glowing yellow ellipsoid with a nub at each end and a leaf.", // i18n-ok
  options: Object.freeze({}),
});

/** @param {{track?: (resource: any) => any}} [options] */
export function create({ track } = {}) {
  const owner = createOwner(track);
  const material = owner.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: linear(LEMON_COLORS.peel).multiplyScalar(0.5) }));
  const mesh = new THREE.Mesh(owner.own(lemonGeometry()), material);
  mesh.castShadow = true;
  const object = new THREE.Group();
  object.add(mesh);
  return { object, update() {}, dispose: () => owner.disposeAll() };
}
