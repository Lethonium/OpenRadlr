// Top-down land-use map of a map's island (#117).
//
//   node worldMap.mjs [--map valley] [--out ~/.cache/openradlr/screenshots/valley-landuse.png]
//
// The map is drawn from the same seeded land the 3D world uses: forest, field
// and open ground, rivers and sea, every road, and the villages and farms the
// world build already places. It is a composition aid, not a game view.
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { RouteGeometry } from "./public/js/route/geometry.js";
import { roadNetworkOf } from "./public/js/route/worldMap.js";
import { floraOf } from "./public/js/view3d/scenery/flora.js";
import { loadScenery } from "./public/js/view3d/scenery/load.js";
import { buildWorld, landOf } from "./public/js/view3d/world.js";
import { islandShape } from "./public/js/view3d/island.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const mapId = option("map", "valley");
const out = option("out", join(homedir(), ".cache/openradlr/screenshots", `${mapId}-landuse.png`));
const root = new globalThis.URL("..", import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const network = read(join(root, "routes/maps", `${mapId}.json`));
const routeFiles = network.routes.map((r) => read(join(root, "routes", `${r.id}.json`)));
const ridden = routeFiles.find((r) => r.id === "rolling-hills") ?? routeFiles[0];
const routes = routeFiles.map((file) => new RouteGeometry(file));
const fetchJson = async (url) => read(join(root, "client/public", url));
const scenes = await loadScenery("quaternius", { fetchJson });
const world = buildWorld(new RouteGeometry(ridden), {
  others: routeFiles.filter((r) => r !== ridden).map((file) => new RouteGeometry(file)),
  network: roadNetworkOf(network),
  biome: "temperate",
  scenery: scenes ? floraOf(scenes, "temperate") : null,
});
const scene = {
  terrain: world.terrain,
  waterLevel: world.waterLevel,
  chunks: {
    village: world.chunks.village ?? [],
    farm: world.chunks.farm ?? [],
  },
};

const seed = network.seed >>> 0;
const land = landOf(seed);
const coast = (() => {
  const samples = [];
  for (const route of routes) {
    for (let d = 0; d < route.length; d += 6) {
      const p = route.positionAt(d);
      samples.push({ x: p.x, z: -p.y });
    }
  }
  const island = islandShape(samples, seed);
  return Array.from({ length: 240 }, (_, i) => {
    const a = (i / 240) * Math.PI * 2;
    const r = island.radiusAt(a);
    return [island.center[0] + Math.cos(a) * r, island.center[1] + Math.sin(a) * r];
  });
})();

const xs = coast.map((p) => p[0]);
const zs = coast.map((p) => p[1]);
const bounds = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
const cell = 20;
const columns = Math.ceil((bounds.x1 - bounds.x0) / cell);
const rows = Math.ceil((bounds.z1 - bounds.z0) / cell);
const cells = new Uint8Array(columns * rows);
const water = scene.waterLevel;
for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < columns; col += 1) {
    const x = bounds.x0 + (col + 0.5) * cell;
    const z = bounds.z0 + (row + 0.5) * cell;
    const height = scene.terrain.height(x, z);
    let kind = 0;
    if (height < water + 0.4) kind = 3;
    else if (scene.terrain.riverDistance(x, z) < 14) kind = 3;
    else if (land.forestAt(x, z) > 0.5) kind = 1;
    else if (land.fieldAt(x, z) > 0.5) kind = 2;
    cells[row * columns + col] = kind;
  }
}

const roadLines = routes.map((route) => {
  const points = [];
  for (let d = 0; d < route.length; d += 12) {
    const p = route.positionAt(d);
    points.push([p.x, -p.y]);
  }
  return { id: route.id, points, selected: route.id === ridden.id };
});
const villages = (scene.chunks.village ?? []).map((chunk) => chunk.center.slice(0, 3));
const farms = (scene.chunks.farm ?? []).map((chunk) => chunk.center.slice(0, 3));

const data = { coast, bounds, cell, columns, rows, cells, roadLines, villages, farms, water, selected: ridden.id };

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a2428"><canvas id="map" width="1800" height="1400"></canvas></body></html>`);
  await page.evaluate((data) => {
    const canvas = globalThis.document.getElementById("map");
    const ctx = canvas.getContext("2d");
    const { coast, bounds, cell, columns, rows, cells, roadLines, villages, farms, selected } = data;
    const pad = 90;
    const width = canvas.width;
    const height = canvas.height;
    const sx = (width - pad * 2) / (bounds.x1 - bounds.x0);
    const sz = (height - pad * 2) / (bounds.z1 - bounds.z0);
    const scale = Math.min(sx, sz);
    const ox = (width - (bounds.x1 - bounds.x0) * scale) / 2;
    const oz = (height - (bounds.z1 - bounds.z0) * scale) / 2;
    const screen = (x, z) => [ox + (x - bounds.x0) * scale, oz + (z - bounds.z0) * scale];

    ctx.fillStyle = "#234d63";
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    coast.forEach(([x, z], i) => { const [px, py] = screen(x, z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    ctx.fillStyle = "#4d7038";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const colors = ["#6f9a4a", "#1f3d24", "#b3a44e", "#2f718f"];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const kind = cells[row * columns + col];
        const x = bounds.x0 + col * cell;
        const z = bounds.z0 + row * cell;
        const [px, py] = screen(x, z);
        ctx.fillStyle = colors[kind];
        ctx.fillRect(px, py, Math.ceil(cell * scale) + 1, Math.ceil(cell * scale) + 1);
      }
    }
    ctx.restore();
    ctx.beginPath();
    coast.forEach(([x, z], i) => { const [px, py] = screen(x, z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    ctx.strokeStyle = "#d8c89a";
    ctx.lineWidth = 4;
    ctx.stroke();

    for (const road of roadLines) {
      ctx.beginPath();
      road.points.forEach(([x, z], i) => { const [px, py] = screen(x, z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.strokeStyle = road.selected ? "#ff8a3d" : "#cfc9b8";
      ctx.lineWidth = road.selected ? 5 : 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    for (const [x, , z] of farms) {
      const [px, py] = screen(x, z);
      ctx.fillStyle = "#d8c06a";
      ctx.fillRect(px - 4, py - 4, 8, 8);
      ctx.strokeStyle = "#2b2a1f";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 4, py - 4, 8, 8);
    }
    for (const [x, , z] of villages) {
      const [px, py] = screen(x, z);
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = "#e07a45";
      ctx.fill();
      ctx.strokeStyle = "#2b1d14";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = "#f4efe2";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText("Valley — current land use", pad, 54);
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#d7d2c2";
    ctx.fillText("Forest, fields, open land, rivers and sea · every road · villages and farms the world build places", pad, 82);

    const legend = [["#1f3d24", "forest"], ["#b3a44e", "field"], ["#6f9a4a", "open"], ["#2f718f", "water"], ["#ff8a3d", selected], ["#e07a45", "village"], ["#d8c06a", "farm"]];
    let lx = pad;
    const ly = height - 46;
    ctx.font = "17px sans-serif";
    for (const [colour, label] of legend) {
      ctx.fillStyle = colour;
      ctx.fillRect(lx, ly - 15, 22, 16);
      ctx.fillStyle = "#f0ecdf";
      ctx.fillText(label, lx + 30, ly);
      lx += 30 + ctx.measureText(label).width + 28;
    }
  }, data);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(out);
} finally {
  await browser.close();
}
