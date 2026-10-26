/**
 * Chunked meshes: the static world split into square tiles so that only
 * tiles near the camera are drawn, and only tiles near the rider cast
 * shadows. `ChunkedMesh` is a drop-in MeshBuilder — every primitive ends up
 * in `triangle()`, which routes the triangle into the tile of its centroid.
 */
import { MeshBuilder } from "./meshBuilder.js";

export const CHUNK_SIZE = 300;

export class ChunkedMesh extends MeshBuilder {
  #chunks = new Map();

  constructor(size = CHUNK_SIZE) {
    super();
    this.size = size;
  }

  #builder(x, z) {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let builder = this.#chunks.get(key);
    if (!builder) {
      builder = new MeshBuilder();
      this.#chunks.set(key, builder);
    }
    return builder;
  }

  triangle(a, b, c, color) {
    this.#builder((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3).triangle(a, b, c, color);
  }

  append(mesh, matrix) {
    const placed = new MeshBuilder();
    placed.append(mesh, matrix);
    const positions = placed.positions.data;
    const normals = placed.normals.data;
    const colors = placed.colors.data;
    for (let v = 0; v < placed.vertexCount; v += 3) {
      const p = v * 3;
      const target = this.#builder((positions[p] + positions[p + 3] + positions[p + 6]) / 3, (positions[p + 2] + positions[p + 5] + positions[p + 8]) / 3);
      target.positions.pushRange(positions, p, p + 9);
      target.normals.pushRange(normals, p, p + 9);
      target.colors.pushRange(colors, v * 4, v * 4 + 12);
    }
  }

  get vertexCount() {
    let count = 0;
    for (const builder of this.#chunks.values()) count += builder.vertexCount;
    return count;
  }

  /** @returns {{mesh: object, center: number[], radius: number}[]} */
  build() {
    return [...this.#chunks.values()].filter((b) => b.vertexCount > 0).map((builder) => {
      const mesh = builder.build();
      builder.release();
      return { mesh, ...bounds(mesh.positions) };
    });
  }
}

/** Bounding sphere (centre of the box, radius to its farthest corner). */
export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const radius = Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]);
  return { center, radius };
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
