/**
 * Dev-only model gallery: every building, prop and plant of a biome on a
 * labelled turntable, for eyeballing shapes while authoring a season.
 *
 * Not loaded by the app. Open `/gallery.html`, optionally with
 * `?biome=winter` and `?model=chalet`. Drawn with canvas 2D (painter's
 * algorithm) rather than WebGL, so a headless browser can screenshot it.
 */
import { BIOME_IDS, BIOMES, resolveBiome } from "./view3d/biomes/index.js";
import { t } from "./i18n/i18n.js";

const params = new URLSearchParams(location.search);
const biome = resolveBiome(params.get("biome") ?? undefined);
const only = params.get("model");

/** Everything a biome can draw on its own, in a stable, readable order. */
const ENTRIES = [
  ["house", (b) => b.models.house({ w: 9, d: 8, floors: 2, wall: b.palette.walls[0], roof: b.palette.roofs[0], chimney: true })],
  ["house-3", (b) => b.models.house({ w: 7, d: 6.5, floors: 3, wall: b.palette.walls[2], roof: b.palette.roofs[1] })],
  ["church", (b) => b.models.church()],
  ["barn", (b) => b.models.barn()],
  ["silo", (b) => b.models.silo()],
  ["cafe", (b) => b.models.cafe()],
  ["gym", (b) => b.models.gym({ drop: 0.5, signLift: 0 })],
  ["turbine", (b) => b.models.turbine(62)],
  ["lamp", (b) => b.models.lamp()],
  ["post", (b) => b.models.post?.(false)],
  ["warning", (b) => b.models.warning()],
  ["village-sign", (b) => b.models.villageSign()],
  ["bale", (b) => b.models.bale()],
  ["animal-1", (b) => b.models.animal1()],
  ["animal-2", (b) => b.models.animal2()],
  ["animal-3", (b) => b.models.animal3()],
];

const LABELS = {
  "house-3": "house (3 floors)",
  cafe: "bike café", // i18n-ok: dev gallery label, never shipped in the app
  "village-sign": "village sign",
  "animal-1": "animal 1",
  "animal-2": "animal 2",
  "animal-3": "animal 3",
  gym: "outdoor gym",
};

/** Any builder result as a list of meshes: a mesh, {mesh, bright}, or {pole, head}. */
function meshesOf(result) {
  if (!result) return [];
  if (result.positions) return [result];
  if (result.mesh) return [result.mesh, result.bright].filter(Boolean);
  return Object.values(result).filter((value) => value?.positions);
}

/** Flat triangles of some meshes, with their bounds (for fitting and centring). */
function gather(meshes) {
  const triangles = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const { positions, normals, colors } = mesh;
    for (let i = 0; i < positions.length; i += 9) {
      const vertex = i / 3;
      const points = [
        [positions[i], positions[i + 1], positions[i + 2]],
        [positions[i + 3], positions[i + 4], positions[i + 5]],
        [positions[i + 6], positions[i + 7], positions[i + 8]],
      ];
      for (const point of points) {
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
      triangles.push({
        points,
        normal: [normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]],
        color: [colors[vertex * 4], colors[vertex * 4 + 1], colors[vertex * 4 + 2], colors[vertex * 4 + 3]],
      });
    }
  }
  return { triangles, min, max };
}

const models = ENTRIES.filter(([id]) => !only || id === only).flatMap(([id, build]) => {
  const result = build(biome);
  if (!result) return []; // a prop this biome does not have (e.g. temperate's posts are inline)
  const { triangles, min, max } = gather(meshesOf(result));
  return [
    {
      id,
      label: LABELS[id] ?? id,
      triangles,
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      size: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.5),
      count: triangles.length,
    },
  ];
});

const select = document.getElementById("biome");
select.replaceChildren(...BIOME_IDS.map((id) => new Option(t(BIOMES[id].label), id)));
select.value = biome.id;
select.addEventListener("change", () => {
  const next = new URLSearchParams(location.search);
  next.set("biome", select.value);
  location.search = next;
});
document.getElementById("summary").textContent = `${models.length} models · ${models.reduce((n, model) => n + model.count, 0).toLocaleString()} triangles`;

const canvas = document.getElementById("gallery");
const context = canvas.getContext("2d");
const COLUMNS = Math.min(4, Math.max(1, Math.round(Math.sqrt(models.length))));
const CELL_W = 320;
const CELL_H = 300;
const PADDING = 18;
const columns = Math.min(COLUMNS, Math.max(1, models.length));
const rows = Math.ceil(models.length / columns);
let width = 0;
let height = 0;

function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  width = columns * CELL_W + PADDING * 2;
  height = rows * CELL_H + PADDING * 2;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();

const PITCH = (22 * Math.PI) / 180;
const COS_PITCH = Math.cos(PITCH);
const SIN_PITCH = Math.sin(PITCH);
const LIGHT = [0.42, 0.82, 0.38];
const LIGHT_LENGTH = Math.hypot(...LIGHT);
const ACCENT = [1, 0.48, 0.1];

const shadeOf = (normal) => {
  const diffuse = (normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]) / LIGHT_LENGTH;
  return 0.58 + 0.42 * Math.max(0, diffuse);
};

function drawModel(model, column, row, yaw) {
  const cx = PADDING + column * CELL_W + CELL_W / 2;
  const cy = PADDING + row * CELL_H + CELL_H / 2 + 10;
  const scale = (Math.min(CELL_W, CELL_H) * 0.62) / model.size;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const project = (point) => {
    const x = point[0] - model.center[0];
    const y = point[1] - model.center[1];
    const z = point[2] - model.center[2];
    const rx = x * cos + z * sin;
    const rz = -x * sin + z * cos;
    return [cx + rx * scale, cy - (y * COS_PITCH - rz * SIN_PITCH) * scale, -(y * SIN_PITCH + rz * COS_PITCH)];
  };
  const rotate = (vector) => {
    const x = vector[0] * cos + vector[2] * sin;
    const z = -vector[0] * sin + vector[2] * cos;
    return [x, vector[1], z];
  };

  context.save();
  context.beginPath();
  context.rect(PADDING + column * CELL_W, PADDING + row * CELL_H, CELL_W, CELL_H);
  context.clip();

  const drawn = [];
  for (const triangle of model.triangles) {
    const normal = rotate(triangle.normal);
    // Faces pointing away from the camera (which sits at +Z, above).
    if (normal[1] * SIN_PITCH + normal[2] * COS_PITCH <= 0) continue;
    const points = triangle.points.map(project);
    drawn.push({ points, depth: (points[0][2] + points[1][2] + points[2][2]) / 3, color: triangle.color, normal });
  }
  drawn.sort((a, b) => a.depth - b.depth);
  for (const face of drawn) {
    const [r, g, b, alpha] = face.color;
    const source = alpha > 0.5 ? ACCENT : [r, g, b];
    const shade = shadeOf(face.normal);
    context.fillStyle = `rgb(${Math.round(Math.min(1, source[0] * shade) * 255)} ${Math.round(Math.min(1, source[1] * shade) * 255)} ${Math.round(Math.min(1, source[2] * shade) * 255)})`;
    context.beginPath();
    context.moveTo(face.points[0][0], face.points[0][1]);
    context.lineTo(face.points[1][0], face.points[1][1]);
    context.lineTo(face.points[2][0], face.points[2][1]);
    context.closePath();
    context.fill();
  }

  context.fillStyle = "#e8ecef";
  context.font = "600 13px system-ui, sans-serif";
  context.fillText(model.label, PADDING + column * CELL_W + 12, PADDING + row * CELL_H + 20);
  context.fillStyle = "#93a0aa";
  context.font = "12px system-ui, sans-serif";
  context.fillText(`${model.count.toLocaleString()} triangles`, PADDING + column * CELL_W + 12, PADDING + row * CELL_H + 36);
  context.restore();
}

const still = params.has("still");
const start = performance.now();
function frame(now) {
  context.fillStyle = "#12161a";
  context.fillRect(0, 0, width, height);
  const yaw = still ? 0.6 : 0.6 + ((now - start) / 1000) * 0.35;
  models.forEach((model, index) => drawModel(model, index % columns, Math.floor(index / columns), yaw));
  if (!still) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
