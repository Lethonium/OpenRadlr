// Top-down land-use map of a map's island (#117).
//
//   node worldMap.mjs [--map valley] [--out ~/.cache/openradlr/screenshots/valley-landuse.png]
//   node worldMap.mjs --proposal [--out ~/.cache/openradlr/screenshots/valley-proposal.png]
//
// The map is drawn from the same seeded land the 3D world uses: forest, field,
// open ground, bare rock and snow, rivers and sea, every road, and the
// villages and farms the world build already places. It is a composition aid,
// not a game view. `--proposal` adds the proposed regions — city, villages,
// harbour, deep wood, farm belt, wetland, meadow verges and high country — so
// the island can be discussed as a whole.
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
import { ROCK_SLOPE, TREELINE, slopeAt, snowAt } from "./public/js/land/mountains.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const proposal = args.includes("--proposal");
const mapId = option("map", "valley");
const out = option("out", join(homedir(), ".cache/openradlr/screenshots", `${mapId}-${proposal ? "proposal" : "landuse"}.png`));
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
const roadReach = (x, z) => (scene.terrain.index?.distance ? scene.terrain.index.distance(x, z, 8) : scene.terrain.distanceToRoad(x, z));
for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < columns; col += 1) {
    const x = bounds.x0 + (col + 0.5) * cell;
    const z = bounds.z0 + (row + 0.5) * cell;
    const height = scene.terrain.height(x, z);
    const above = height - water;
    let kind = 0;
    if (height < water + 0.4 || scene.terrain.riverDistance(x, z) < 14) kind = 3;
    else if (snowAt(height, water) > 0.5) kind = 5;
    else {
      const slope = slopeAt(scene.terrain, x, z, 10);
      if (slope > ROCK_SLOPE || above >= TREELINE) kind = 4;
      else if (land.forestAt(x, z) > 0.5) kind = roadReach(x, z) < 430 ? 1 : 6;
      else if (land.fieldAt(x, z) > 0.5) kind = 2;
    }
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

/**
 * The proposed composition. Each region is a soft ellipse in world metres;
 * the badge number is repeated in the side panel, so the map stays readable
 * without a label on every patch.
 */
const zones = [
  {
    n: 1,
    kind: "city",
    x: 2300,
    z: -1000,
    rx: 560,
    rz: 430,
    name: "East market city",
    note: "the larger town: four streets, two junctions, a market square, guildhall, church, gardens and workshops",
  },
  {
    n: 2,
    kind: "village",
    x: -350,
    z: 2190,
    rx: 310,
    rz: 280,
    name: "Southwest hill village",
    note: "smaller and quieter: a green, church, farm lane, stone walls and a few cross streets",
  },
  {
    n: 3,
    kind: "harbour",
    x: 4900,
    z: 4050,
    rx: 340,
    rz: 260,
    name: "Southeast harbour",
    note: "a new lane down to the bay: quay, boats, fish market, net racks and dunes",
  },
  {
    n: 4,
    kind: "wood",
    x: 700,
    z: -1450,
    rx: 680,
    rz: 500,
    name: "North deep wood",
    note: "one continuous conifer wood: taller near trees, a dense far belt, understory and a dark floor",
  },
  {
    n: 5,
    kind: "farm",
    x: -1300,
    z: 1500,
    rx: 800,
    rz: 650,
    name: "West farm belt",
    note: "arable parcels with hedgerows, orchards, tracks, a windmill and fewer scattered farmsteads",
  },
  {
    n: 6,
    kind: "wetland",
    x: 1000,
    z: 2800,
    rx: 460,
    rz: 360,
    name: "South wetland",
    note: "a pond and wet meadow beside the river: reeds, willows, a boardwalk and birds",
  },
  {
    n: 7,
    kind: "meadow",
    x: 1500,
    z: 300,
    rx: 620,
    rz: 460,
    name: "Meadow verges",
    note: "the close-up layer: flowers, bushes and stones along the ride, thicker at wood and field edges",
  },
  {
    n: 8,
    kind: "alpine",
    x: 350,
    z: -2400,
    rx: 1120,
    rz: 760,
    name: "High country",
    note: "bare rock and alpine meadow above the treeline, with permanent snow on the highest ground",
  },
];

const zoneStyle = {
  city: { fill: "rgba(232, 162, 74, 0.24)", stroke: "#e8a24a" },
  village: { fill: "rgba(224, 122, 69, 0.22)", stroke: "#e07a45" },
  harbour: { fill: "rgba(74, 163, 200, 0.22)", stroke: "#4aa3c8" },
  wood: { fill: "rgba(47, 107, 58, 0.24)", stroke: "#3f8a4c" },
  farm: { fill: "rgba(216, 192, 106, 0.22)", stroke: "#d8c06a" },
  wetland: { fill: "rgba(90, 169, 163, 0.22)", stroke: "#5aa9a3" },
  meadow: { fill: "rgba(158, 196, 106, 0.18)", stroke: "#9ec46a" },
  alpine: { fill: "rgba(207, 216, 226, 0.18)", stroke: "#cfd8e2" },
};

const data = {
  proposal,
  coast,
  bounds,
  cell,
  columns,
  rows,
  cells,
  roadLines,
  villages,
  farms,
  water,
  selected: ridden.id,
  zones: proposal ? zones.map((zone) => ({ ...zone, ...zoneStyle[zone.kind] })) : [],
  harbourLane: proposal ? [[4537, 3758], [4700, 3860], [4830, 3970], [4900, 4050]] : [],
};

const browser = await chromium.launch({ headless: true });
try {
  const width = proposal ? 2200 : 1800;
  const height = proposal ? 1500 : 1400;
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a2428"><canvas id="map" width="${width}" height="${height}"></canvas></body></html>`);
  await page.evaluate((data) => {
    const canvas = globalThis.document.getElementById("map");
    const ctx = canvas.getContext("2d");
    const { proposal, coast, bounds, cell, columns, rows, cells, roadLines, villages, farms, selected, zones, harbourLane } = data;
    const width = canvas.width;
    const height = canvas.height;
    const panel = proposal ? 400 : 0;
    const mapWidth = width - panel;
    const pad = 90;
    const top = 112;
    const bottom = 76;
    const sx = (mapWidth - pad * 2) / (bounds.x1 - bounds.x0);
    const sz = (height - top - bottom) / (bounds.z1 - bounds.z0);
    const scale = Math.min(sx, sz);
    const ox = (mapWidth - (bounds.x1 - bounds.x0) * scale) / 2;
    const oz = top + (height - top - bottom - (bounds.z1 - bounds.z0) * scale) / 2;
    const screen = (x, z) => [ox + (x - bounds.x0) * scale, oz + (z - bounds.z0) * scale];

    ctx.fillStyle = "#1a2428";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#234d63";
    ctx.fillRect(0, 0, mapWidth, height);
    ctx.beginPath();
    coast.forEach(([x, z], i) => { const [px, py] = screen(x, z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.closePath();
    ctx.fillStyle = "#4d7038";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const colors = ["#6f9a4a", "#1f3d24", "#b3a44e", "#2f718f", "#7d7a70", "#e6ebf0", "#3f5f38"];
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

    if (proposal) {
      // A new lane from the southeast road down to the harbour.
      if (harbourLane.length > 1) {
        ctx.beginPath();
        harbourLane.forEach(([x, z], i) => { const [px, py] = screen(x, z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = "#cfc9b8";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.setLineDash([]);
        const [mx, my] = screen(4520, 3720);
        ctx.font = "italic 15px sans-serif";
        ctx.fillStyle = "#e8e2d2";
        ctx.textAlign = "right";
        ctx.fillText("new harbour lane", mx - 10, my - 6);
        ctx.textAlign = "start";
      }
      for (const zone of zones) {
        const [px, py] = screen(zone.x, zone.z);
        ctx.beginPath();
        ctx.ellipse(px, py, zone.rx * scale, zone.rz * scale, 0, 0, Math.PI * 2);
        ctx.fillStyle = zone.fill;
        ctx.fill();
        ctx.setLineDash([10, 7]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = zone.stroke;
        ctx.stroke();
        ctx.setLineDash([]);
        // Number badge at the centre.
        ctx.beginPath();
        ctx.arc(px, py, 17, 0, Math.PI * 2);
        ctx.fillStyle = zone.stroke;
        ctx.fill();
        ctx.strokeStyle = "#1a2428";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#141b1f";
        ctx.font = "bold 19px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(zone.n), px, py + 1);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
    }

    ctx.fillStyle = "#f4efe2";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(proposal ? "Valley — proposed composition" : "Valley — current land use", pad, 54);
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#d7d2c2";
    ctx.fillText(
      proposal
        ? "Eight regions with different work, trees, fields and water · dashed: a new lane to the harbour"
        : "Forest, sparse wood, fields, open land, rock, snow, rivers and sea · every road · villages and farms the world build places",
      pad,
      82,
    );

    if (proposal) {
      const panelX = mapWidth + 24;
      const panelW = panel - 48;
      ctx.fillStyle = "rgba(12, 20, 24, 0.72)";
      ctx.fillRect(panelX, 112, panelW, height - 188);
      ctx.fillStyle = "#f4efe2";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText("Proposed composition", panelX + 22, 152);
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "#a9b6b4";
      ctx.fillText("one island, several characters", panelX + 22, 178);

      const wrap = (text, maxWidth) => {
        const words = text.split(" ");
        const lines = [];
        let line = "";
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (ctx.measureText(next).width > maxWidth && line) {
            lines.push(line);
            line = word;
          } else line = next;
        }
        if (line) lines.push(line);
        return lines;
      };

      let y = 218;
      for (const zone of zones) {
        ctx.beginPath();
        ctx.arc(panelX + 34, y - 6, 14, 0, Math.PI * 2);
        ctx.fillStyle = zone.stroke;
        ctx.fill();
        ctx.fillStyle = "#141b1f";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(zone.n), panelX + 34, y - 5);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#f4efe2";
        ctx.font = "bold 18px sans-serif";
        ctx.fillText(zone.name, panelX + 58, y);
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#b9c4c1";
        const lines = wrap(zone.note, panelW - 80);
        lines.forEach((line, i) => ctx.fillText(line, panelX + 58, y + 20 + i * 18));
        y += 26 + lines.length * 18 + 14;
      }

      // Current land use legend under the list.
      const legend = [
        ["#1f3d24", "deep wood"],
        ["#3f5f38", "sparse wood"],
        ["#b3a44e", "field"],
        ["#6f9a4a", "open"],
        ["#7d7a70", "rock / scree"],
        ["#e6ebf0", "snow"],
        ["#2f718f", "water"],
      ];
      let lx = panelX + 22;
      let ly = height - 116;
      ctx.font = "14px sans-serif";
      for (const [colour, label] of legend) {
        ctx.fillStyle = colour;
        ctx.fillRect(lx, ly - 13, 18, 14);
        ctx.fillStyle = "#d7d2c2";
        ctx.fillText(label, lx + 24, ly);
        lx += 24 + ctx.measureText(label).width + 16;
        if (lx > panelX + panelW - 80) {
          lx = panelX + 22;
          ly += 24;
        }
      }
    } else {
      const legend = [
        ["#1f3d24", "deep wood"],
        ["#3f5f38", "sparse wood"],
        ["#b3a44e", "field"],
        ["#6f9a4a", "open"],
        ["#7d7a70", "rock / scree"],
        ["#e6ebf0", "snow"],
        ["#2f718f", "water"],
        ["#ff8a3d", selected],
        ["#e07a45", "village"],
        ["#d8c06a", "farm"],
      ];
      let lx = pad;
      const ly = height - 46;
      ctx.font = "17px sans-serif";
      for (const [colour, label] of legend) {
        ctx.fillStyle = colour;
        ctx.fillRect(lx, ly - 15, 22, 16);
        ctx.fillStyle = "#f0ecdf";
        ctx.fillText(label, lx + 30, ly);
        lx += 30 + ctx.measureText(label).width + 24;
      }
    }
  }, data);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(out);
} finally {
  await browser.close();
}
