// Top-down layout of one settlement (#117).
//
//   node settlementMap.mjs --id harbour [--map valley] [--out ~/.cache/openradlr/screenshots/harbour-layout.png]
//   node settlementMap.mjs --id southwest --scale 2.5
//
// Draws the same `layoutSettlement` data the 3D world builds from: the sea and
// land, the existing road, new streets, plots, the square, lamps, props, and a
// harbour's quay, jetty and boats. It is a composition and review aid, like
// `worldMap.mjs`, not a game view.
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { RoadNetwork } from "./public/js/route/network.js";
import { layoutSettlement } from "./public/js/land/settlement.js";
import { networkTerrain } from "./public/js/view3d/world.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const mapId = option("map", "valley");
const id = option("id", "hilltop");
const scale = Number(option("scale", "2"));
const root = new globalThis.URL("..", import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const network = new RoadNetwork(read(join(root, "routes/maps", `${mapId}.json`)));
const roads = network.roads();
const terrain = networkTerrain(network, roads);
const settlement = network.settlements.find((s) => s.id === id);
if (!settlement) {
  console.error(`No settlement "${id}" in ${mapId}. Known: ${network.settlements.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
const layout = layoutSettlement({ ...settlement, terrain, roads });
const out = option("out", join(homedir(), ".cache/openradlr/screenshots", `${id}-layout.png`));

// Bounds: everything drawn, plus a margin of land/sea around it.
const xs = [];
const zs = [];
const add = ([x, z]) => { xs.push(x); zs.push(z); };
for (const street of layout.streets) for (const p of street.points) add(p);
for (const plot of layout.plots) {
  add([plot.x - plot.width, plot.z - plot.depth]);
  add([plot.x + plot.width, plot.z + plot.depth]);
}
if (layout.square) add(layout.square.center);
for (const lamp of layout.lamps) add([lamp.x, lamp.z]);
for (const prop of layout.props) add([prop.x, prop.z]);
if (layout.quay) { add([layout.quay.x, layout.quay.z]); }
for (const boat of layout.boats) add([boat.x, boat.z]);
const margin = 60;
const minX = Math.min(...xs) - margin;
const maxX = Math.max(...xs) + margin;
const minZ = Math.min(...zs) - margin;
const maxZ = Math.max(...zs) + margin;
const width = Math.ceil((maxX - minX) * scale);
const height = Math.ceil((maxZ - minZ) * scale);
// The terrain's functions cannot cross into the page; sample the ground first.
const step = 4;
const cols = Math.ceil((maxX - minX) / step);
const rows = Math.ceil((maxZ - minZ) / step);
const heights = new Float64Array(cols * rows);
for (let r = 0; r < rows; r += 1) {
  for (let c = 0; c < cols; c += 1) {
    heights[r * cols + c] = terrain.height(minX + (c + 0.5) * step, minZ + (r + 0.5) * step);
  }
}

// A main street keeps its RouteGeometry, which cannot cross into the page.
const drawn = {
  ...layout,
  streets: layout.streets.map((street) => {
    const copy = { ...street };
    delete copy.route;
    return copy;
  }),
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height } });
try {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a2428"><canvas id="map" width="${width}" height="${height}"></canvas></body></html>`);
  await page.evaluate(({ layout, heights, cols, rows, step, sea, width, height, minX, minZ, scale, id, kind }) => {
    const canvas = globalThis.document.getElementById("map");
    const ctx = canvas.getContext("2d");
    const px = (x) => (x - minX) * scale;
    const py = (z) => (z - minZ) * scale;

    // Land and water, sampled on a 4 m grid so the coast is visible.
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const h = heights[r * cols + c];
        ctx.fillStyle = h < sea ? "#2f6f8f" : h < sea + 1.2 ? "#7fa88a" : h < sea + 8 ? "#5f8f5a" : "#4d7d4c";
        ctx.fillRect(px(minX + c * step), py(minZ + r * step), step * scale + 1, step * scale + 1);
      }
    }

    // Streets: the road already there in orange, new streets in dark grey.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const street of layout.streets) {
      if (street.draw === false) continue;
      ctx.strokeStyle = street.existing ? "#d98b3a" : "#2c3238";
      ctx.lineWidth = street.width * scale;
      ctx.beginPath();
      street.points.forEach((p, i) => (i ? ctx.lineTo(px(p[0]), py(p[1])) : ctx.moveTo(px(p[0]), py(p[1]))));
      ctx.stroke();
    }

    // The square (a green or a market place).
    if (layout.square) {
      const s = layout.square;
      const corners = [[s.a0, s.b0], [s.a1, s.b0], [s.a1, s.b1], [s.a0, s.b1]];
      const u = layout.frame.u;
      const v = layout.frame.v;
      ctx.fillStyle = "#d9d2b8";
      ctx.strokeStyle = "#8f866f";
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach(([a, b], i) => {
        const x = layout.center[0] + u[0] * a + v[0] * b;
        const z = layout.center[1] + u[1] * a + v[1] * b;
        i ? ctx.lineTo(px(x), py(z)) : ctx.moveTo(px(x), py(z));
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Plots: a house footprint, brown with a darker outline.
    for (const plot of layout.plots) {
      ctx.save();
      ctx.translate(px(plot.x), py(plot.z));
      ctx.rotate(-plot.yaw);
      ctx.fillStyle = "#8a6a4f";
      ctx.strokeStyle = "#5f4634";
      ctx.lineWidth = 1;
      ctx.fillRect((-plot.width / 2) * scale, (-plot.depth / 2) * scale, plot.width * scale, plot.depth * scale);
      ctx.strokeRect((-plot.width / 2) * scale, (-plot.depth / 2) * scale, plot.width * scale, plot.depth * scale);
      ctx.restore();
    }

    // A harbour's quay, jetty and boats.
    if (layout.quay) {
      const q = layout.quay;
      const along = [-Math.sin(q.yaw), -Math.cos(q.yaw)];
      const across = q.sea;
      const corner = (a, b) => [q.x + along[0] * a + across[0] * b, q.z + along[1] * a + across[1] * b];
      const c = [corner(-q.length / 2, -q.width / 2), corner(q.length / 2, -q.width / 2), corner(q.length / 2, q.width / 2), corner(-q.length / 2, q.width / 2)];
      ctx.fillStyle = "#9a9a92";
      ctx.strokeStyle = "#6c6c66";
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(px(p[0]), py(p[1])) : ctx.moveTo(px(p[0]), py(p[1]))));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // The jetty reaches into the water.
      const j0 = corner(0, q.width / 2);
      const j1 = corner(0, q.width / 2 + 10);
      ctx.strokeStyle = "#b9b3a4";
      ctx.lineWidth = 2.2 * scale;
      ctx.beginPath();
      ctx.moveTo(px(j0[0]), py(j0[1]));
      ctx.lineTo(px(j1[0]), py(j1[1]));
      ctx.stroke();
      for (const boat of layout.boats) {
        ctx.save();
        ctx.translate(px(boat.x), py(boat.z));
        ctx.rotate(-boat.yaw);
        ctx.fillStyle = "#f0ece2";
        ctx.strokeStyle = "#3f4a52";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.6 * scale, 0.7 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Props: church, fountain, stalls, benches, windmill.
    for (const prop of layout.props) {
      const x = px(prop.x);
      const z = py(prop.z);
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(-prop.yaw);
      if (prop.role === "church") {
        ctx.fillStyle = "#7a4a44";
        ctx.fillRect(-4 * scale, -6 * scale, 8 * scale, 12 * scale);
      } else if (prop.role === "fountains") {
        ctx.fillStyle = "#6fa8c9";
        ctx.beginPath();
        ctx.arc(0, 0, 2.2 * scale, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.role === "stalls") {
        ctx.fillStyle = "#d8b45a";
        ctx.fillRect(-1.5 * scale, -1.5 * scale, 3 * scale, 3 * scale);
      } else if (prop.role === "benches") {
        ctx.fillStyle = "#6b5136";
        ctx.fillRect(-1 * scale, -0.4 * scale, 2 * scale, 0.8 * scale);
      } else if (prop.role === "windmills") {
        ctx.strokeStyle = "#4a4a4a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 3 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-3 * scale, 0); ctx.lineTo(3 * scale, 0);
        ctx.moveTo(0, -3 * scale); ctx.lineTo(0, 3 * scale);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Lamps.
    ctx.fillStyle = "#f3d27a";
    for (const lamp of layout.lamps) {
      ctx.beginPath();
      ctx.arc(px(lamp.x), py(lamp.z), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Title, scale and north.
    ctx.fillStyle = "#e8eef0";
    ctx.font = "600 20px sans-serif";
    ctx.fillText(`${id} (${kind}) · ${layout.streets.length} streets · ${layout.plots.length} plots`, 16, 30);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#b9c4c8";
    ctx.fillText("orange: existing road · black: new street · brown: plot · pale: square", 16, 52);
    const bar = 100 * scale;
    ctx.strokeStyle = "#e8eef0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, height - 22); ctx.lineTo(16 + bar, height - 22);
    ctx.moveTo(16, height - 28); ctx.lineTo(16, height - 16);
    ctx.moveTo(16 + bar, height - 28); ctx.lineTo(16 + bar, height - 16);
    ctx.stroke();
    ctx.fillStyle = "#e8eef0";
    ctx.font = "13px sans-serif";
    ctx.fillText("100 m", 16 + bar + 8, height - 18);
    ctx.save();
    ctx.translate(width - 34, 36);
    ctx.fillStyle = "#e8eef0";
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(6, 8); ctx.lineTo(0, 3); ctx.lineTo(-6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = "12px sans-serif";
    ctx.fillText("N", -4, 24);
    ctx.restore();
  }, { layout: drawn, heights, cols, rows, step, sea: terrain.seaLevel ?? 0, width, height, minX, minZ, scale, id, kind: layout.kind });

  mkdirSync(dirname(out), { recursive: true });
  await page.locator("#map").screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(out);
