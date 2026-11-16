/**
 * Geometry and raw WebGL buffer-upload costs of a built scene.
 *
 * Pure data inspection, shared by benchmarks and tests. Expanded group totals
 * preserve visual workload across baked/instanced builds; `uploadBytes` is the
 * actual unique geometry plus instance transforms and the weather buffer.
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
  return meshByteLength(mesh);
}

function addExpanded(stats, mesh, placements) {
  const bytes = meshByteLength(mesh);
  const vertices = (mesh.vertexCount ?? (mesh.positions?.length ?? 0) / 3) * placements;
  stats.vertices += vertices;
  stats.triangles += vertices / 3;
  stats.bytes += bytes * placements;
}

/** Counts chunk groups, standalone meshes, shared instances and weather. */
export function sceneStats(scene) {
  const groups = {};
  const total = emptyStats();
  const models = scene.instanceModels ?? [];
  const instances = { models: models.length, placements: 0, vertices: 0, bytes: 0, transformBytes: 0 };
  for (const { mesh } of models) {
    instances.vertices += mesh.vertexCount ?? (mesh.positions?.length ?? 0) / 3;
    instances.bytes += meshByteLength(mesh);
  }
  let staticBytes = 0;
  for (const [name, chunks] of Object.entries(scene.chunks ?? {})) {
    groups[name] ??= emptyStats();
    for (const chunk of chunks) {
      staticBytes += addInto(groups, total, name, chunk.mesh);
      for (const batch of chunk.batches ?? []) {
        const placements = batch.matrices.length / 16;
        const { mesh } = models[batch.model];
        addExpanded(groups[name], mesh, placements);
        addExpanded(total, mesh, placements);
        instances.placements += placements;
        instances.transformBytes += batch.matrices.byteLength;
      }
    }
  }
  for (const [name, mesh] of Object.entries(scene.meshes ?? {})) staticBytes += addInto(groups, total, name, mesh);
  if (scene.clouds) staticBytes += addInto(groups, total, "clouds", scene.clouds);
  if (scene.water) staticBytes += addInto(groups, total, "water", scene.water);
  if (scene.rivers) staticBytes += addInto(groups, total, "rivers", scene.rivers);
  if (scene.spectatorMeshes) {
    groups.spectatorMeshes = emptyStats();
    for (const mesh of scene.spectatorMeshes) staticBytes += addInto(groups, total, "spectatorMeshes", mesh);
  }
  const weather = { vertices: (scene.weather?.data?.length ?? 0) / 6, bytes: scene.weather?.data?.byteLength ?? 0 };
  const uploadBytes = staticBytes + instances.bytes + instances.transformBytes + weather.bytes;
  return { groups, total, weather, instances, uploadBytes };
}
