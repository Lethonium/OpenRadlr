/**
 * The ground as Three.js meshes: tiles of 64 x 64 cells cut from the near
 * grid (each frustum-culled on its own, none of open sea), and one mesh for
 * the far grid with a hole under the near one. Heights, normals and colours
 * come from the world worker (`world/groundGrid.js`).
 */
import * as THREE from "../../three.js";
import { addHook, cloudShadows, createGrainTexture, grain, heightFog, landPaint } from "../assets/materials.js";
import { grassFloor } from "./grassFloor.js";
import { grassWeights } from "./grassField.js";
import { createOwner } from "./tracker.js";

/** Cells per tile edge. */
export const TILE_CELLS = 64;
/** Tiles whose every vertex lies this far below the sea are left out; the sea hides them. */
export const SEA_SKIP_DEPTH = 3;
/** The grain's look on the ground (the reference's values). */
const GRAIN = Object.freeze({ scale: 0.32, strength: 0.42, scale2: 0.012, strength2: 0.55 });
/** Pushes the far mesh behind the near tiles where the two overlap at the hole's edge. */
const FAR_OFFSET = Object.freeze({ factor: 2, units: 2 });

/** Triangle corners of cell (i, j) in a grid `width` vertices wide, same diagonal as the terrain model. */
function cellTriangles(i, j, width, out) {
  const a = j * width + i;
  const b = a + width;
  const c = b + 1;
  const d = a + 1;
  out.push(a, b, d, b, c, d);
}

/** One tile's geometry: vertices `i0..i1` by `j0..j1` of the grid, or null when it is all deep sea. */
function tileGeometry(grid, grass, i0, j0, i1, j1) {
  const width = i1 - i0 + 1;
  const height = j1 - j0 + 1;
  const positions = new Float32Array(width * height * 3);
  const normals = new Float32Array(width * height * 3);
  const colors = new Float32Array(width * height * 3);
  const grasses = new Float32Array(width * height);
  let land = false;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const source = j * grid.columns + i;
      const target = (j - j0) * width + (i - i0);
      positions.set([grid.x0 + i * grid.cell, grid.heights[source], grid.z0 + j * grid.cell], target * 3);
      normals.set(grid.normals.subarray(source * 3, source * 3 + 3), target * 3);
      colors.set(grid.colors.subarray(source * 3, source * 3 + 3), target * 3);
      grasses[target] = grass[source];
      if (grid.heights[source] > grid.water - SEA_SKIP_DEPTH) land = true;
    }
  }
  if (!land) return null;
  const indices = [];
  for (let j = 0; j < height - 1; j += 1) for (let i = 0; i < width - 1; i += 1) cellTriangles(i, j, width, indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aGrass", new THREE.BufferAttribute(grasses, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The far grid as one geometry without the triangles centred inside the near grid or wholly under the sea. */
function farGeometry(far, grass, near) {
  const box = { x0: near.x0, z0: near.z0, x1: near.x0 + (near.columns - 1) * near.cell, z1: near.z0 + (near.rows - 1) * near.cell };
  const indices = [];
  const corners = [0, 0, 0];
  const keep = (a, b, c) => {
    corners[0] = a;
    corners[1] = b;
    corners[2] = c;
    const x = (corners.reduce((sum, k) => sum + far.x0 + (k % far.columns) * far.cell, 0)) / 3;
    const z = (corners.reduce((sum, k) => sum + far.z0 + Math.floor(k / far.columns) * far.cell, 0)) / 3;
    if (x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1) return false;
    return corners.some((k) => far.heights[k] > far.water - SEA_SKIP_DEPTH);
  };
  for (let j = 0; j < far.rows - 1; j += 1) {
    for (let i = 0; i < far.columns - 1; i += 1) {
      const a = j * far.columns + i;
      const b = a + far.columns;
      const c = b + 1;
      const d = a + 1;
      if (keep(a, b, d)) indices.push(a, b, d);
      if (keep(b, c, d)) indices.push(b, c, d);
    }
  }
  const positions = new Float32Array(far.columns * far.rows * 3);
  for (let k = 0; k < far.columns * far.rows; k += 1) {
    positions.set([far.x0 + (k % far.columns) * far.cell, far.heights[k], far.z0 + Math.floor(k / far.columns) * far.cell], k * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(far.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(far.colors, 3));
  geometry.setAttribute("aGrass", new THREE.BufferAttribute(grass, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The land-use paint as a texture: sRGB, smoothly filtered, row 0 at the box's first z. */
function paintTextureOf({ rgba, columns, rows }) {
  const texture = new THREE.DataTexture(rgba, columns, rows, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The terrain layer.
 * @param {{near: import("../../world/groundGrid.js").GroundGrid, far: import("../../world/groundGrid.js").GroundGrid}} ground
 * @param {{uniforms: ReturnType<typeof import("../assets/materials.js").createSharedUniforms>,
 *   settings: import("../quality.js").QualitySettings,
 *   track: import("./tracker.js").Tracker["track"],
 *   grain?: import("../../three.js").Texture,
 *   plan?: {masks?: import("../../world/plan/masks.js").Masks}}} options `grain` is the scene's shared grain
 *   texture; `plan.masks` keep the grass shading off roads, rivers and fields
 * @returns {{object: import("../../three.js").Group, update: (frame: object) => void,
 *   setQuality: (settings: import("../quality.js").QualitySettings) => void,
 *   setEnvironment: (env: object) => void, dispose: () => void}}
 */
export function createTerrainLayer(ground, { uniforms, settings, track, grain: grainTexture, plan }) {
  const { own, disposeAll } = createOwner(track);
  const texture = grainTexture ?? own(createGrainTexture());
  const group = new THREE.Group();
  group.name = "terrain";

  const outer = { value: 0 };
  const setQuality = (next) => {
    outer.value = next?.grassRings?.at(-1)?.r ?? 0;
  };
  setQuality(settings);

  const paint = ground.paint;
  const paintTexture = paint ? own(paintTextureOf(paint)) : null;
  const material = (offset) => {
    const made = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, ...(offset ? { polygonOffset: true, polygonOffsetFactor: offset.factor, polygonOffsetUnits: offset.units } : {}) }));
    addHook(made, grain({ texture, ...GRAIN }));
    addHook(made, cloudShadows(uniforms));
    addHook(made, grassFloor(uniforms, outer));
    if (paintTexture) addHook(made, landPaint({ texture: paintTexture, x0: paint.x0, z0: paint.z0, width: paint.columns * paint.cell, depth: paint.rows * paint.cell }));
    addHook(made, heightFog(uniforms));
    return made;
  };

  const near = ground.near;
  const nearGrass = grassWeights(near, plan?.masks);
  const nearMaterial = material(null);
  for (let j0 = 0; j0 < near.rows - 1; j0 += TILE_CELLS) {
    for (let i0 = 0; i0 < near.columns - 1; i0 += TILE_CELLS) {
      const geometry = tileGeometry(near, nearGrass, i0, j0, Math.min(i0 + TILE_CELLS, near.columns - 1), Math.min(j0 + TILE_CELLS, near.rows - 1));
      if (!geometry) continue;
      const tile = new THREE.Mesh(own(geometry), nearMaterial);
      tile.name = "terrain-tile";
      tile.receiveShadow = true;
      group.add(tile);
    }
  }
  if (ground.far) {
    const far = new THREE.Mesh(own(farGeometry(ground.far, grassWeights(ground.far), near)), material(FAR_OFFSET));
    far.name = "terrain-far";
    group.add(far);
  }

  return {
    object: group,
    update() {},
    setQuality,
    setEnvironment() {},
    dispose() {
      group.clear();
      disposeAll();
    },
  };
}
