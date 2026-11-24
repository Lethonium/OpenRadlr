/**
 * The road: asphalt, verges, banks and ruts in one material, lane lines in
 * another drawn on top, the roadside posts and (with the rivers) the bridges.
 * The quads from the worker are cut into chunks of consecutive quads, so a
 * long route is frustum-culled piece by piece. The road receives the sun's
 * shadows and the drifting clouds.
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, heightFog } from "../assets/materials.js";
import { asphaltTexture, kindColors } from "../assets/road.js";
import { ROAD_KIND } from "../../world/plan/roadStrips.js";
import { createOwner } from "./tracker.js";

/** Quads per chunk: about 400 m of road with its verges. */
export const CHUNK_QUADS = 300;
const MARK_KINDS = new Set([ROAD_KIND.marking, ROAD_KIND.edge, ROAD_KIND.rut]);
/** The surface sits just in front of the ground; marks and ruts in front of that. */
const SURFACE_OFFSET = Object.freeze({ factor: -2, units: -4 });
const MARK_OFFSET = Object.freeze({ factor: -4, units: -8 });

/**
 * The quads of `strips` for which `keep(kind)` holds, as geometries of up to `CHUNK_QUADS` consecutive quads.
 * @param {import("../../world/plan/strips.js").Strips} strips
 * @param {(kind: number) => boolean} keep
 * @param {number[][]} palette colour per kind
 * @returns {import("../../three.js").BufferGeometry[]}
 */
export function chunkGeometries(strips, keep, palette) {
  const quads = strips.kinds.length / 4;
  const geometries = [];
  let list = [];
  const flush = () => {
    if (list.length === 0) return;
    const positions = new Float32Array(list.length * 12);
    const uvs = new Float32Array(list.length * 8);
    const colors = new Float32Array(list.length * 12);
    list.forEach((q, n) => {
      positions.set(strips.positions.subarray(q * 12, q * 12 + 12), n * 12);
      uvs.set(strips.uvs.subarray(q * 8, q * 8 + 8), n * 8);
      const color = palette[strips.kinds[q * 4]];
      for (let k = 0; k < 4; k += 1) {
        const shade = strips.shades[q * 4 + k];
        colors.set([color[0] * shade, color[1] * shade, color[2] * shade], n * 12 + k * 3);
      }
    });
    const indices = new Uint16Array(list.length * 6);
    list.forEach((q, n) => {
      for (let k = 0; k < 6; k += 1) indices[n * 6 + k] = strips.indices[q * 6 + k] - q * 4 + n * 4;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometries.push(geometry);
    list = [];
  };
  for (let q = 0; q < quads; q += 1) {
    if (!keep(strips.kinds[q * 4])) continue;
    list.push(q);
    if (list.length === CHUNK_QUADS) flush();
  }
  flush();
  return geometries;
}

/**
 * A built flat-shaded mesh (the adapter's format: positions, normals, rgba colours) as a geometry.
 * @param {{positions: Float32Array, normals: Float32Array, colors: Float32Array, vertexCount: number}} mesh
 */
export function meshGeometry(mesh) {
  const colors = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i += 1) colors.set(mesh.colors.subarray(i * 4, i * 4 + 3), i * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {{strips: import("../../world/plan/strips.js").Strips, style: import("../roadStyle.js").RoadStyle,
 *   posts?: {positions: Float32Array, normals: Float32Array, colors: Float32Array, vertexCount: number} | null}} roads
 * @param {{uniforms: ReturnType<typeof import("../assets/materials.js").createSharedUniforms>, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createRoadLayer(roads, { uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const group = new THREE.Group();
  group.name = "roads";
  const palette = kindColors(roads.style);
  const material = (offset, map) => {
    const made = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: offset.factor, polygonOffsetUnits: offset.units, ...(map ? { map } : {}) }));
    addHook(made, cloudShadows(uniforms));
    addHook(made, heightFog(uniforms));
    return made;
  };
  const surface = material(SURFACE_OFFSET, own(asphaltTexture()));
  const marks = material(MARK_OFFSET, null);
  for (const [name, keep, made] of [
    ["road-surface", (kind) => !MARK_KINDS.has(kind), surface],
    ["road-marks", (kind) => MARK_KINDS.has(kind), marks],
  ]) {
    for (const geometry of chunkGeometries(roads.strips, keep, palette)) {
      const mesh = new THREE.Mesh(own(geometry), made);
      mesh.name = name;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (roads.posts?.vertexCount) {
    const posts = new THREE.Mesh(own(meshGeometry(roads.posts)), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })));
    posts.name = "road-posts";
    posts.castShadow = posts.receiveShadow = true;
    group.add(posts);
  }
  return {
    object: group,
    update() {},
    setEnvironment() {},
    dispose() {
      group.clear();
      disposeAll();
    },
  };
}
