/**
 * Small, pure tools shared by the biomes. Like the biomes themselves, these
 * run in the world worker and under `node --test`: no canvas, no I/O.
 */

/** Linear blend of two RGB(A) colours; `t = 0` is `a`, `t = 1` is `b`. */
export function mix(a, b, t) {
  return a.map((c, i) => c + (b[i] - c) * t);
}

/**
 * Snow lying on a built model. Returns a copy of `mesh` with the colours of
 * upward-facing vertices blended towards `color` and those vertices lifted a
 * touch, so frost reads as a layer without changing the model's silhouette
 * much. Alpha is a jersey tint mask and is left alone.
 *
 * @param {{positions: Float32Array, normals: Float32Array, colors: Float32Array}} mesh
 */
export function frost(mesh, { color = [0.94, 0.96, 0.99], from = 0.35, amount = 0.85, lift = 0.02 } = {}) {
  const positions = mesh.positions.slice();
  const normals = mesh.normals.slice();
  const colors = mesh.colors.slice();
  for (let v = 0; v < positions.length / 3; v += 1) {
    const up = normals[v * 3 + 1];
    if (up <= from) continue;
    const t = Math.min(1, (up - from) / (1 - from)) * amount;
    for (let i = 0; i < 3; i += 1) {
      colors[v * 4 + i] = colors[v * 4 + i] * (1 - t) + color[i] * t;
    }
    positions[v * 3 + 1] += lift * t;
  }
  return { positions, normals, colors, vertexCount: mesh.vertexCount };
}
