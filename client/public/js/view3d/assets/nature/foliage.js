/**
 * Leaf cards and the materials that draw them. Cards are double-sided,
 * alpha-tested quads whose normals point away from the canopy centre, which
 * lights a crown softly instead of in flat facets. Restyled from the
 * reference's `_foliage.js`: no texture cache, textures are data textures.
 */
import * as THREE from "../../../three.js";
import { addHook, cloudShadows, noFlip, translucent, windify } from "../materials.js";

const ALPHA_CUT = 0.42;

/**
 * Alpha-tested, wind-swayed, translucent foliage material (vertex colours tint the map).
 * @param {import("../../../three.js").Texture} map
 * @param {{wind?: number, uniforms: ReturnType<typeof import("../materials.js").createSharedUniforms>}} options
 * @returns {import("../../../three.js").MeshStandardMaterial}
 */
export function foliageMaterial(map, { wind = 0.02, uniforms }) {
  const material = new THREE.MeshStandardMaterial({ map, alphaTest: ALPHA_CUT, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, vertexColors: true });
  return addHook(noFlip(translucent(windify(material, wind, uniforms), 0.8, uniforms)), cloudShadows(uniforms));
}

/**
 * Vertex-coloured, wind-swayed material for trunks, hulls and rocks.
 * @param {ReturnType<typeof import("../materials.js").createSharedUniforms>} uniforms
 * @param {number} [wind] sway; 0 for rigid things
 * @param {number} [roughness]
 */
export function bodyMaterial(uniforms, wind = 0.02, roughness = 0.85) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  return addHook(wind > 0 ? windify(material, wind, uniforms) : material, cloudShadows(uniforms));
}

/** The shadow-map twin of a foliage material: casts the leaf outlines, not the quads. */
export const foliageDepth = (map) => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: ALPHA_CUT, side: THREE.DoubleSide });

/**
 * Cards scattered over spherical clusters.
 * @param {() => number} random
 * @param {{x: number, y: number, z: number, r: number, n: number}[]} clusters `n` cards around (x, y, z) within radius `r`
 * @param {{size: [number, number], center: import("../../../three.js").Vector3, up: number, palette: import("../../../three.js").Color[]}} options
 *   `center` is where normals radiate from, `up` leans them skyward, `palette` the colours cards pick from
 * @returns {import("../../../three.js").BufferGeometry} non-indexed, with uv, normal and colour
 */
export function leafCards(random, clusters, { size, center, up, palette }) {
  const range = (a, b) => a + random() * (b - a);
  const position = [];
  const normal = [];
  const uv = [];
  const color = [];
  const v = new THREE.Vector3();
  const right = new THREE.Vector3();
  const upAxis = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.n; i += 1) {
      v.set(range(-1, 1), range(-0.6, 1), range(-1, 1)).normalize();
      const p = new THREE.Vector3(cluster.x, cluster.y, cluster.z).addScaledVector(v, cluster.r * range(0.45, 0.95));
      const s = range(size[0], size[1]);
      tmp.set(range(-1, 1), range(-1, 1), range(-1, 1)).normalize();
      right.crossVectors(v, tmp).normalize();
      upAxis.crossVectors(right, v).normalize();
      n.copy(p).sub(center).normalize();
      n.y += up;
      n.normalize();
      const base = palette[Math.floor(random() * palette.length)];
      const shade = 0.62 + 0.38 * (v.y * 0.5 + 0.5) * range(0.85, 1.1);
      for (const [a, b, u, w] of corners) {
        position.push(p.x + ((right.x * a + upAxis.x * b) * s) / 2, p.y + ((right.y * a + upAxis.y * b) * s) / 2, p.z + ((right.z * a + upAxis.z * b) * s) / 2);
        normal.push(n.x, n.y, n.z);
        uv.push(u, w);
        color.push(base.r * shade, base.g * shade, base.b * shade);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  return geometry;
}
