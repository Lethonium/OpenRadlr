/**
 * Geometry and raw WebGL buffer-upload costs of a built scene.
 *
 * Pure data inspection, shared by benchmarks and tests. Bytes are the typed
 * arrays submitted to the GPU, not driver overhead, shadow maps or shaders.
 */

/** Bytes in a mesh's position, normal and colour arrays. */
export function meshByteLength(mesh) {
  return (mesh?.positions?.byteLength ?? 0) + (mesh?.normals?.byteLength ?? 0) + (mesh?.colors?.byteLength ?? 0);
}

const emptyStats = () => ({ meshes: 0, vertices: 0, triangles: 0, bytes: 0 });

function addMesh(stats, mesh) {
  if (!mesh) return;
  const vertices = mesh.vertexCount ?? (mesh.positions?.length ?? 0) / 3;
  stats.meshes += 1;
  stats.vertices += vertices;
  stats.triangles += vertices / 3;
  stats.bytes += meshByteLength(mesh);
}

function addInto(groups, total, name, mesh) {
  const group = (groups[name] ??= emptyStats());
  addMesh(group, mesh);
  addMesh(total, mesh);
}

/** Counts chunk groups, standalone meshes and the separate weather buffer. */
export function sceneStats(scene) {
  const groups = {};
  const total = emptyStats();
  for (const [name, chunks] of Object.entries(scene.chunks ?? {})) {
    groups[name] ??= emptyStats();
    for (const chunk of chunks) addInto(groups, total, name, chunk.mesh);
  }
  for (const [name, mesh] of Object.entries(scene.meshes ?? {})) addInto(groups, total, name, mesh);
  if (scene.clouds) addInto(groups, total, "clouds", scene.clouds);
  if (scene.water) addInto(groups, total, "water", scene.water);
  if (scene.rivers) addInto(groups, total, "rivers", scene.rivers);
  if (scene.spectatorMeshes) {
    groups.spectatorMeshes = emptyStats();
    for (const mesh of scene.spectatorMeshes) addInto(groups, total, "spectatorMeshes", mesh);
  }
  const weather = { vertices: (scene.weather?.data?.length ?? 0) / 6, bytes: scene.weather?.data?.byteLength ?? 0 };
  return { groups, total, weather };
}
