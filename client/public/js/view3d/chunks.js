/**
 * Chunked meshes: the static world split into square tiles so that only
 * tiles near the camera are drawn, and only tiles near the rider cast
 * shadows. Procedural triangles are baked as before. Repeated imported models
 * can instead stay as one shared mesh plus a transform per instance (#117).
 */
import { MeshBuilder } from "./meshBuilder.js";
import { transformPoint } from "./math.js";

export const CHUNK_SIZE = 300;

/** The unique meshes shared by every instanced chunk group in one world. */
export class InstanceCatalog {
  #ids = new Map();
  #models = [];

  /** Returns a stable numeric id and registers the model at most once. */
  register(mesh) {
    if (this.#ids.has(mesh)) return this.#ids.get(mesh);
    const id = this.#models.length;
    this.#ids.set(mesh, id);
    this.#models.push({ mesh, bounds: boxOf(mesh.positions) });
    return id;
  }

  model(id) {
    return this.#models[id];
  }

  get length() {
    return this.#models.length;
  }

  /** Plain transferable data: the model mesh and its local bounding box. */
  build() {
    return this.#models;
  }
}

export class ChunkedMesh extends MeshBuilder {
  #chunks = new Map();

  constructor(size = CHUNK_SIZE, catalog = new InstanceCatalog()) {
    super();
    this.size = size;
    this.catalog = catalog;
  }

  #entry(x, z) {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let entry = this.#chunks.get(key);
    if (!entry) {
      entry = { builder: new MeshBuilder(), batches: new Map(), min: null, max: null };
      this.#chunks.set(key, entry);
    }
    return entry;
  }

  triangle(a, b, c, color) {
    this.#entry((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3).builder.triangle(a, b, c, color);
  }

  append(mesh, matrix) {
    const placed = new MeshBuilder();
    placed.append(mesh, matrix);
    const positions = placed.positions.data;
    const normals = placed.normals.data;
    const colors = placed.colors.data;
    for (let v = 0; v < placed.vertexCount; v += 3) {
      const p = v * 3;
      const target = this.#entry((positions[p] + positions[p + 3] + positions[p + 6]) / 3, (positions[p + 2] + positions[p + 5] + positions[p + 8]) / 3).builder;
      target.positions.pushRange(positions, p, p + 9);
      target.normals.pushRange(normals, p, p + 9);
      target.colors.pushRange(colors, v * 4, v * 4 + 12);
    }
  }

  /**
   * Places a shared model without expanding its vertices. The instance's
   * translation owns the chunk, while its transformed bounds keep conservative
   * culling even where the model reaches across a tile boundary.
   */
  instance(mesh, matrix) {
    const model = this.catalog.register(mesh);
    const entry = this.#entry(matrix[12], matrix[14]);
    let batch = entry.batches.get(model);
    if (!batch) {
      batch = { model, matrices: [] };
      entry.batches.set(model, batch);
    }
    for (const value of matrix) batch.matrices.push(value);

    const { min, max } = this.catalog.model(model).bounds;
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const p = transformPoint(matrix, [x, y, z]);
          if (!entry.min) {
            entry.min = p.slice(0, 3);
            entry.max = p.slice(0, 3);
          } else {
            for (let k = 0; k < 3; k += 1) {
              entry.min[k] = Math.min(entry.min[k], p[k]);
              entry.max[k] = Math.max(entry.max[k], p[k]);
            }
          }
        }
      }
    }
  }

  get vertexCount() {
    let count = 0;
    for (const entry of this.#chunks.values()) {
      count += entry.builder.vertexCount;
      for (const batch of entry.batches.values()) {
        count += this.catalog.model(batch.model).mesh.vertexCount * batch.matrices.length / 16;
      }
    }
    return count;
  }

  /** @returns {{mesh: object, batches?: object[], center: number[], radius: number}[]} */
  build() {
    const chunks = [];
    for (const entry of this.#chunks.values()) {
      const hasBatches = entry.batches.size > 0;
      if (entry.builder.vertexCount === 0 && !hasBatches) continue;
      const mesh = entry.builder.build();
      entry.builder.release();
      let box = mesh.vertexCount ? boxOf(mesh.positions) : null;
      if (entry.min) box = box ? mergeBoxes(box, { min: entry.min, max: entry.max }) : { min: entry.min, max: entry.max };
      const chunk = { mesh, ...sphereOfBox(box) };
      if (hasBatches) {
        chunk.batches = [...entry.batches.values()].map((batch) => ({ model: batch.model, matrices: Float32Array.from(batch.matrices) }));
      }
      chunks.push(chunk);
    }
    return chunks;
  }
}

function boxOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max };
}

function mergeBoxes(a, b) {
  return { min: a.min.map((v, i) => Math.min(v, b.min[i])), max: a.max.map((v, i) => Math.max(v, b.max[i])) };
}

function sphereOfBox({ min, max }) {
  const center = min.map((v, i) => (v + max[i]) / 2);
  const radius = Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]);
  return { center, radius };
}

/** Bounding sphere (centre of the box, radius to its farthest corner). */
export function bounds(positions) {
  return sphereOfBox(boxOf(positions));
}

/**
 * True if a chunk can be seen: within `maxDistance` and not completely
 * behind the camera (`forward` is the normalised view direction).
 */
export function chunkVisible(chunk, eye, forward, maxDistance) {
  const dx = chunk.center[0] - eye[0];
  const dy = chunk.center[1] - eye[1];
  const dz = chunk.center[2] - eye[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance - chunk.radius > maxDistance) return false;
  if (distance <= chunk.radius) return true;
  const along = (dx * forward[0] + dy * forward[1] + dz * forward[2]) / distance;
  // Behind the camera unless the sphere reaches into the view cone.
  return along > -chunk.radius / distance - 0.2;
}

/** True if a chunk reaches within `range` (horizontally) of `focus`. */
export function chunkNear(chunk, focus, range) {
  return Math.hypot(chunk.center[0] - focus[0], chunk.center[2] - focus[2]) - chunk.radius <= range;
}
