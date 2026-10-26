#!/usr/bin/env node
/**
 * Generates the bundled map as a road network (ADR 0010, #26): terrain first,
 * then the places (cafés, junctions), then roads laid between them along the
 * cheapest path for grade, then the routes as walks over the network.
 *
 * Writes `routes/maps/valley.json` (the network, served to clients) and one
 * classic route file per route in `routes/` (points, markers, zones), which
 * the server rides until it loads the network itself (#14).
 *
 *   node tools/valley-map.mjs              rewrite the files, print checks
 *   node tools/valley-map.mjs --dry-run    only print the checks
 *   node tools/valley-map.mjs --png map.png  also draw the map
 *
 * Coordinates are metres east (x) and north (y) of the GPS origin; the
 * valley café sits at (0, 0). Everything follows from the seed: the same
 * seed gives the same map.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { COAST, coastHeight } from "../client/public/js/view3d/island.js";
import { fbm, seededRandom } from "../client/public/js/view3d/noise.js";

const MAP = { id: "valley", name: "Valley Island", seed: 2026 };
const SEED = MAP.seed;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const round1 = (v) => Math.round(v * 10) / 10 + 0;

/** Piecewise linear through `[key, value]` pairs (keys ascending). */
function piecewise(keys) {
  return (k) => {
    if (k <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) {
      if (k <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (k - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
    }
    return keys[keys.length - 1][1];
  };
}

/** Distance from `p` to a polyline, and the index of the nearest segment. */
function toPolyline(p, line) {
  let best = { distance: Infinity, segment: 0, t: 0 };
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    if (d < best.distance) best = { distance: d, segment: i, t };
  }
  return best;
}

// -------------------------------------------------------------- landscape ---

/**
 * The island: an ellipse with seeded bays and headlands. The table has the
 * same layout as `islandShape` in the client (centre, radius and cliff per
 * angle bin), so the client reads the coast straight from the file.
 */
const ISLAND = { center: [150, 250], halfWidth: 4700, halfHeight: 3900, tilt: 0.38, extent: 7000, cell: 40 };

/**
 * Headlands (+) and bays (−) by hand, `[x, y, strength, radius]`, so the
 * outline has a character: a long cape to the south-east, a peninsula in
 * the west, bays between them.
 */
const SHORE = [
  [3900, -3300, 0.55, 1300], // the south-eastern cape
  [5200, -4300, 0.35, 700],
  [-4300, -1600, 0.45, 1100], // the western peninsula
  [-5300, -2200, 0.3, 600],
  [4200, 3300, 0.35, 1100], // north-eastern headland
  [5000, 600, -0.45, 1100], // east bay
  [-4700, 900, -0.4, 1000], // west bay
  [-2300, -3900, -0.35, 1100], // south-west bay
  [1900, -4300, -0.3, 900],
  [-1400, 3500, -0.32, 900], // a cove under the western peaks
  [1500, 4300, 0.3, 800], // a northern headland
  [-3600, 3000, 0.2, 700],
];

/**
 * Land or sea: a tilted oval, warped and roughened by noise at several
 * scales, plus the hand-placed capes and bays. The coast is where this
 * crosses zero, so it bends into bays, coves and points of any shape.
 */
function landness(x, y) {
  const { center, halfWidth, halfHeight, tilt } = ISLAND;
  // Domain warp: bends the whole outline, so no stretch of coast is straight.
  const wx = x + (fbm(x / 2600, y / 2600, SEED + 501, 3) - 0.5) * 2200;
  const wy = y + (fbm(x / 2600 + 9.1, y / 2600 + 4.4, SEED + 503, 3) - 0.5) * 2200;
  const dx = wx - center[0];
  const dy = wy - center[1];
  const u = (dx * Math.cos(tilt) + dy * Math.sin(tilt)) / halfWidth;
  const v = (-dx * Math.sin(tilt) + dy * Math.cos(tilt)) / halfHeight;
  let m = 1 - Math.hypot(u, v);
  m += (fbm(x / 1500, y / 1500, SEED + 507, 3) - 0.5) * 0.45;
  m += (fbm(x / 420, y / 420, SEED + 509, 3) - 0.5) * 0.14;
  m += (fbm(x / 140, y / 140, SEED + 511, 2) - 0.5) * 0.04;
  for (const [sx, sy, strength, radius] of SHORE) m += strength * Math.exp(-((Math.hypot(x - sx, y - sy) / radius) ** 2));
  return m;
}

/**
 * The coast on a grid: land and sea from `landness` (lakes filled, the main
 * island and its islets kept), then the signed distance to the coast by a
 * chamfer transform: positive on land, negative at sea.
 */
function coastline() {
  const { center, extent, cell } = ISLAND;
  const x0 = Math.floor((center[0] - extent) / cell) * cell;
  const y0 = Math.floor((center[1] - extent) / cell) * cell;
  const size = Math.ceil((2 * extent) / cell) + 1;
  const n = size * size;
  const value = new Float32Array(n);
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) value[r * size + c] = landness(x0 + c * cell, y0 + r * cell);
  const land = Uint8Array.from(value, (m) => (m > 0 ? 1 : 0));
  // Sea is what the open water reaches from the edge: inland "lakes" become land.
  const sea = new Uint8Array(n);
  const queue = [];
  for (let k = 0; k < size; k += 1) queue.push(k, n - 1 - k, k * size, k * size + size - 1);
  for (const i of queue) sea[i] = land[i] ? 0 : 1;
  for (let q = 0; q < queue.length; q += 1) {
    const i = queue[q];
    if (!sea[i]) continue;
    const c = i % size;
    for (const j of [i - 1, i + 1, i - size, i + size]) {
      if (j < 0 || j >= n || sea[j] || land[j] || (j === i - 1 && c === 0) || (j === i + 1 && c === size - 1)) continue;
      sea[j] = 1;
      queue.push(j);
    }
  }
  // Two-pass chamfer distance to the other side of the coast.
  const inside = (i) => !sea[i];
  const distance = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = i % size;
    const edge = [i - 1, i + 1, i - size, i + size].some((j) => j >= 0 && j < n && Math.abs((j % size) - c) <= 1 && inside(j) !== inside(i));
    if (!edge) {
      distance[i] = 1e9;
      continue;
    }
    // Next to the coast: how far the zero line is, from the slope of landness,
    // so the coast is smooth rather than snapped to the grid.
    const r = Math.floor(i / size);
    const gx = (value[r * size + Math.min(size - 1, c + 1)] - value[r * size + Math.max(0, c - 1)]) / (2 * cell);
    const gy = (value[Math.min(size - 1, r + 1) * size + c] - value[Math.max(0, r - 1) * size + c]) / (2 * cell);
    distance[i] = clamp(Math.abs(value[i]) / (Math.hypot(gx, gy) || 1e-9), 0, cell);
  }
  const diagonal = cell * Math.SQRT2;
  const relax = (i, j, w) => {
    if (j >= 0 && j < n && distance[j] + w < distance[i]) distance[i] = distance[j] + w;
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const i = r * size + c;
      if (c > 0) relax(i, i - 1, cell);
      if (r > 0) {
        relax(i, i - size, cell);
        if (c > 0) relax(i, i - size - 1, diagonal);
        if (c + 1 < size) relax(i, i - size + 1, diagonal);
      }
    }
  }
  for (let r = size - 1; r >= 0; r -= 1) {
    for (let c = size - 1; c >= 0; c -= 1) {
      const i = r * size + c;
      if (c + 1 < size) relax(i, i + 1, cell);
      if (r + 1 < size) {
        relax(i, i + size, cell);
        if (c + 1 < size) relax(i, i + size + 1, diagonal);
        if (c > 0) relax(i, i + size - 1, diagonal);
      }
    }
  }
  for (let i = 0; i < n; i += 1) if (sea[i]) distance[i] = -distance[i];
  const at = (x, y) => {
    const u = clamp((x - x0) / cell, 0, size - 1.001);
    const v = clamp((y - y0) / cell, 0, size - 1.001);
    const c = Math.floor(u);
    const r = Math.floor(v);
    const i = r * size + c;
    return lerp(lerp(distance[i], distance[i + 1], u - c), lerp(distance[i + size], distance[i + size + 1], u - c), v - r);
  };
  // The outermost land per direction, for the client's island box and far islands.
  const bins = COAST.bins;
  const radius = new Array(bins).fill(0);
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < n; i += 1) {
    if (sea[i]) continue;
    const x = x0 + (i % size) * cell;
    const y = y0 + Math.floor(i / size) * cell;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
    const dx = x - center[0];
    const dy = y - center[1];
    const b = ((Math.round((Math.atan2(dy, dx) / (2 * Math.PI)) * bins) % bins) + bins) % bins;
    radius[b] = Math.max(radius[b], Math.round(Math.hypot(dx, dy)));
  }
  return { center, radius, box, inland: at };
}

const COASTLINE = coastline();

/** Metres to the coast: positive on land, negative at sea. */
const inland = (x, y) => COASTLINE.inland(x, y);

/** Cliffs by hand, `[x, y, radius]`: a spot is a full cliff at its centre and fades out by about its radius. */
const CLIFFS = [[3900, -4100, 900]]; // the south-eastern cape

/** 0 for a beach, 1 for a cliff: cliffs under the mountains, on the capes and at the hand-placed spots. */
const cliffAt = (x, y) => {
  const noise = smoothstep(0.55, 0.72, fbm(x / 1400, y / 1400, SEED + 433, 2) * 0.6 + smoothstep(1800, 3600, y) * 0.45);
  let spots = 0;
  for (const [cx, cy, radius] of CLIFFS) spots = Math.max(spots, smoothstep(0.3, 0.7, Math.exp(-((Math.hypot(x - cx, y - cy) / radius) ** 2))));
  return Math.max(noise, spots);
};

/** The river the valley follows, from below the col down to the south coast. */
const RIVER = [
  [420, 1950],
  [330, 1300],
  [120, 760],
  [-280, 330],
  [-390, -300],
  [-260, -1050],
  [-60, -1800],
  [120, -2600],
  [260, -3500],
  [330, -4700],
];
/** Valley floor by northing: about 36 m at the café, falling to the sea. */
const FLOOR = piecewise([
  [-4700, -2],
  [-3900, 2],
  [-3000, 12],
  [-1800, 24],
  [-600, 33],
  [0, 36],
  [800, 48],
  [1950, 92],
]);

/** The mountain ridge across the north, with the col as its lowest pass. */
const COL_X = 300;
const ridgeY = (x) => 2950 + 260 * Math.sin((x - COL_X) / 1700);
const ridgeHeight = (x) => 290 + 280 * (1 - Math.exp(-(((x - COL_X) / 1300) ** 2)));

/** Hills placed by hand where places need them: `[x, y, height, radius]`. */
const BUMPS = [
  [2450, 1000, 70, 950], // the hilltop café's hill
  [-2600, 600, 60, 900], // western hills
  [1700, -2600, 35, 800],
];

const softplus = (v, k = 12) => k * Math.log1p(Math.exp(v / k));

/** Natural land height (metres above sea level) before roads shape it. */
function land(x, y) {
  // Rolling hills, lower towards the southern plains.
  const rolling = (fbm(x / 1100, y / 1100, SEED + 11, 4) - 0.45) * 150 * (0.45 + 0.55 * smoothstep(-3800, 200, y));
  const detail = (fbm(x / 330, y / 330, SEED + 17, 3) - 0.5) * 24;
  const bumps = BUMPS.reduce((sum, [bx, by, height, radius]) => sum + height * Math.exp(-((Math.hypot(x - bx, y - by) / radius) ** 2)), 0);
  const across = y - ridgeY(x);
  const ridge = ridgeHeight(x) * (0.9 + 0.25 * fbm(x / 700, y / 700, SEED + 23, 3));
  const mountain = ridge * Math.exp(-((across / (across < 0 ? 1250 : 950)) ** 2));
  let h = 26 + softplus(rolling + detail) + bumps + mountain;

  // The valley: the river's floor, widening and flattening towards the sea.
  const near = toPolyline([x, y], RIVER);
  const floor = FLOOR(y);
  const width = 260 + 420 * smoothstep(1300, 100, y) + 120 * smoothstep(0, -2500, y);
  h = floor + Math.max(0, h - floor) * smoothstep(width * 0.25, width * 2.6, near.distance) ** 1.4;

  return coastHeight(h, inland(x, y), cliffAt(x, y));
}

/** The landscape on a grid (the network file ships it), bilinear in between. */
const TERRAIN = { cell: 40, margin: 500 };

function bakeTerrain() {
  const { cell, margin } = TERRAIN;
  const { box } = COASTLINE;
  const x0 = Math.floor((box.minX - margin) / cell) * cell;
  const y0 = Math.floor((box.minY - margin) / cell) * cell;
  const columns = Math.ceil((box.maxX + margin - x0) / cell) + 1;
  const rows = Math.ceil((box.maxY + margin - y0) / cell) + 1;
  const heights = new Int16Array(columns * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) heights[r * columns + c] = Math.round(land(x0 + c * cell, y0 + r * cell) * 10);
  }
  const at = (x, y) => {
    const u = clamp((x - x0) / cell, 0, columns - 1.001);
    const v = clamp((y - y0) / cell, 0, rows - 1.001);
    const c = Math.floor(u);
    const r = Math.floor(v);
    const i = r * columns + c;
    const top = lerp(heights[i], heights[i + 1], u - c);
    const bottom = lerp(heights[i + columns], heights[i + columns + 1], u - c);
    return lerp(top, bottom, v - r) / 10;
  };
  return { x0, y0, cell, columns, rows, heights, at };
}

const terrain = bakeTerrain();

// ----------------------------------------------------------------- places ---

/**
 * Cafés and junctions. Positions are chosen by hand for a sensible layout
 * (valley, hills, pass); elevations come from the land. `through` names the
 * road arriving and the road leaving in a straight line (the main way
 * through a place): routes starting at a café ride straight over its line;
 * `axis` gives that line in degrees when the far ends of the two roads would not.
 */
const NODES = [
  { id: "valley-cafe", kind: "cafe", name: "Valley Café", at: [0, 0], through: ["valley-west", "valley-east"] },
  { id: "forge-hut", kind: "cafe", name: "Forge Hut", at: [COL_X, ridgeY(COL_X) - 60], through: ["forge-east", "forge-west"] },
  { id: "hill-cafe", kind: "cafe", name: "Hilltop Café", at: [2400, 950], through: ["hill-road", "orchard-lane"] },
  { id: "east-fork", kind: "junction", at: [950, 150] },
  { id: "west-fork", kind: "junction", at: [-1050, -60] },
  { id: "south-east", kind: "junction", at: [1250, -1700] },
  { id: "north-east", kind: "junction", at: [2250, 1500], through: ["hill-north", "forge-east"] },
  { id: "north-west", kind: "junction", at: [-1350, 1300], through: ["forge-west", "west-valley"] },
  { id: "beach-cafe", kind: "cafe", name: "Beach Café", at: [700, -3220], through: ["west-coast", "south-coast"], axis: 0 },
];

/**
 * Roads. `type` is reserved for road variety (#27): today every road is
 * drawn with four lanes. `via` points steer a road's way (it still finds
 * its own path between them); `leaves` lines a road up out of a place that
 * has no `through` for it (degrees counter-clockwise from east, by node), so
 * routes turning there ride a fork rather than a hairpin; `shore` is how
 * near the sea (metres) this road may come, in place of the usual 380 m (a
 * coastal road); `zones` (`forest`, `village`, `cliff`) and `sprints` are by
 * fraction of the edge.
 */
const EDGES = [
  { id: "valley-east", from: "valley-cafe", to: "east-fork", type: "main" },
  { id: "valley-west", from: "west-fork", to: "valley-cafe", type: "main" },
  { id: "river-east", from: "east-fork", to: "south-east", type: "main", sprints: [{ dir: 1, near: 0.5 }] },
  { id: "lower-valley", from: "south-east", to: "west-fork", via: [[-150, -2350], [-1250, -1900]], type: "main", sprints: [{ dir: 1, near: 0.25 }], zones: [{ type: "village", from: 0.31, to: 0.43 }, { type: "forest", from: 0.68, to: 0.84 }] },
  { id: "hill-road", from: "east-fork", to: "hill-cafe", type: "road", zones: [{ type: "forest", from: 0.2, to: 0.5 }] },
  { id: "orchard-lane", from: "hill-cafe", to: "south-east", type: "road", sprints: [{ dir: 1, near: 0.6 }] },
  { id: "hill-north", from: "hill-cafe", to: "north-east", type: "road" },
  { id: "forge-east", from: "north-east", to: "forge-hut", type: "road", zones: [{ type: "forest", from: 0.15, to: 0.6 }] },
  { id: "forge-west", from: "forge-hut", to: "north-west", type: "road", zones: [{ type: "forest", from: 0.45, to: 0.8 }] },
  { id: "high-road", from: "north-east", to: "north-west", type: "road", leaves: { "north-west": -25 } },
  { id: "west-valley", from: "north-west", to: "west-fork", type: "road", sprints: [{ dir: 1, near: 0.7 }] },
  // Along the south coast: `shore` lets them come within sight of the sea.
  { id: "south-coast", from: "beach-cafe", to: "south-east", via: [[1200, -3260], [1700, -3200], [2100, -3200], [2450, -3080], [2700, -3250], [2850, -3550], [3100, -3900], [3500, -4000], [4000, -4010], [4450, -3980], [4400, -3300], [2600, -2300]], type: "road", shore: 110, zones: [{ type: "cliff", from: 0.29, to: 0.52 }] },
  { id: "west-coast", from: "west-fork", to: "beach-cafe", via: [[-2300, -1000], [-2950, -1950], [-2950, -2550], [-2700, -2780], [-2200, -2800], [-1600, -3140], [-1000, -3330], [-400, -3500], [-60, -3330]], type: "road", shore: 110 },
];

/** Villages around cafés, on every road that leaves them (metres from the node). */
const VILLAGES = [{ node: "hill-cafe", from: 90, to: 420 }];

/**
 * Routes: a start café and a walk of `[edge, direction]`. Ids and seeds stay
 * as before, so menus, settings and ride history keep working.
 */
const ROUTES = [
  {
    id: "riverside-flats",
    name: "Riverside Flats",
    description: "Fast and flat down the river valley, made for drafting and sprints.",
    seed: 4242,
    walk: [["valley-east", 1], ["river-east", 1], ["lower-valley", 1], ["valley-west", 1]],
  },
  {
    id: "rolling-hills",
    name: "Rolling Hills",
    description: "From the hilltop café through the orchards and the valley, with one short climb back up.",
    seed: 1337,
    walk: [["orchard-lane", 1], ["river-east", -1], ["hill-road", 1]],
  },
  {
    id: "col-de-la-forge",
    name: "Col de la Forge",
    description: "Over the hills to the Forge Hut on the col, then a long, fast descent back to the valley.",
    seed: 777,
    walk: [["valley-east", 1], ["hill-road", 1], ["hill-north", 1], ["forge-east", 1], ["forge-west", 1], ["west-valley", 1], ["valley-west", 1]],
  },
  {
    id: "balcony-road",
    name: "Balcony Road",
    description: "Up to the hilltop café, then west along the high road under the ridge, with views over the whole valley.",
    seed: 5150,
    walk: [["valley-east", 1], ["hill-road", 1], ["hill-north", 1], ["high-road", 1], ["west-valley", 1], ["valley-west", 1]],
  },
  {
    id: "forge-circuit",
    name: "Forge Circuit",
    description: "From the Forge Hut down the west side, back along the high road and up to the col again.",
    seed: 3141,
    walk: [["forge-west", 1], ["high-road", -1], ["forge-east", 1]],
  },
  {
    id: "island-tour",
    name: "Island Tour",
    description: "The long way round: the river valley, the col from the west, the high road and back down the west valley.",
    seed: 2468,
    walk: [["valley-east", 1], ["river-east", 1], ["south-coast", -1], ["west-coast", -1], ["west-valley", -1], ["forge-west", -1], ["forge-east", -1], ["high-road", 1], ["west-valley", 1], ["valley-west", 1]],
  },
  {
    id: "cape-loop",
    name: "Cape Loop",
    description: "Along the beaches of the south coast, over the low cliffs of the south-eastern cape and back by the valley and the western bays.",
    seed: 8642,
    walk: [["south-coast", 1], ["lower-valley", 1], ["west-coast", 1]],
  },
];

// ------------------------------------------------------------- road laying ---

/** Grid the roads are searched on. */
const SEARCH = { cell: 20, comfort: 0.045, steep: 0.085, shore: 380, apart: 320 };
/** What turning costs on the search: a sharp corner as much as a few hundred metres of road. */
const TURN = 2000;

/**
 * Cheapest path between two points over the land: grade costs more the
 * steeper it gets, turning costs (so roads bend rather than zigzag), the
 * shore and the sea are avoided, and so is running alongside roads already
 * laid (except near this road's own ends). `startDir`/`endDir` line the
 * road up with its straight runs out of places.
 */
function layRoad(from, to, roadDistance, { startDir = null, endDir = null, shore = SEARCH.shore } = {}) {
  const { cell, comfort, steep, apart } = SEARCH;
  const pad = 1400;
  const x0 = Math.min(from[0], to[0]) - pad;
  const y0 = Math.min(from[1], to[1]) - pad;
  const columns = Math.ceil((Math.max(from[0], to[0]) + pad - x0) / cell) + 1;
  const rows = Math.ceil((Math.max(from[1], to[1]) + pad - y0) / cell) + 1;
  const n = columns * rows;
  const height = new Float32Array(n);
  const penalty = new Float32Array(n);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const x = x0 + c * cell;
      const y = y0 + r * cell;
      const i = r * columns + c;
      height[i] = terrain.at(x, y);
      const coast = inland(x, y);
      let p = coast < shore ? ((shore - coast) / 60) ** 2 : 0;
      if (height[i] < 2) p += 400;
      // Keep apart from other roads, but let this one leave its nodes freely.
      const other = roadDistance(x, y);
      const ends = Math.min(dist([x, y], from), dist([x, y], to));
      if (other < apart && ends > 90) p += 30 * (1 - other / apart) ** 2;
      penalty[i] = p;
    }
  }
  const index = (p) => Math.round((p[1] - y0) / cell) * columns + Math.round((p[0] - x0) / cell);
  const start = index(from);
  const goal = index(to);
  const gc = goal % columns;
  const gr = Math.floor(goal / columns);
  const moves = [
    [1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1],
    [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1],
  ];
  const D = moves.length;
  const heading = moves.map(([dc, dr]) => Math.atan2(dr, dc));
  const turnBetween = (a, b) => Math.abs(Math.atan2(Math.sin(heading[b] - heading[a]), Math.cos(heading[b] - heading[a])));
  const turns = Array.from({ length: D }, (_, a) => Array.from({ length: D }, (_, b) => turnBetween(a, b)));
  const closest = (dir) => {
    let best = 0;
    for (let m = 1; m < D; m += 1) if (Math.cos(heading[m] - Math.atan2(dir[1], dir[0])) > Math.cos(heading[best] - Math.atan2(dir[1], dir[0]))) best = m;
    return best;
  };
  // States are (cell, the move that arrived there), so turning can cost:
  // bending by `turn` over a step of `run` metres costs TURN · turn² / run.
  const cost = new Float64Array(n * D).fill(Infinity);
  const came = new Int32Array(n * D).fill(-1);
  const heap = new MinHeap();
  const firstMoves = startDir ? [closest(startDir)] : [...moves.keys()];
  for (const m of firstMoves) {
    cost[start * D + m] = 0;
    heap.push(start * D + m, 0);
  }
  let reached = -1;
  const endMove = endDir ? closest(endDir) : null;
  while (heap.size > 0) {
    const state = heap.pop();
    const i = Math.floor(state / D);
    const arrived = state % D;
    if (i === goal) {
      reached = state;
      break;
    }
    const c = i % columns;
    const r = Math.floor(i / columns);
    for (let m = 0; m < D; m += 1) {
      const [dc, dr] = moves[m];
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const j = nr * columns + nc;
      const run = Math.hypot(dc, dr) * cell;
      const grade = Math.abs(height[j] - height[i]) / run;
      const climb = (grade / comfort) ** 2 + (grade > steep ? ((grade - steep) / 0.01) ** 2 * 3 : 0);
      let step = run * (1 + 0.8 * climb + (penalty[i] + penalty[j]) / 2) + (TURN * turns[arrived][m] ** 2) / run;
      // Arrive lined up with the road's straight run into its place.
      if (j === goal && endMove !== null) step += (TURN * turns[m][endMove] ** 2) / 40;
      const next = j * D + m;
      const total = cost[state] + step;
      if (total < cost[next]) {
        cost[next] = total;
        came[next] = state;
        heap.push(next, total + Math.hypot(nc - gc, nr - gr) * cell);
      }
    }
  }
  if (reached < 0) throw new Error(`no path from ${from} to ${to}`);
  const path = [];
  for (let state = reached; state !== -1; state = came[state]) {
    const i = Math.floor(state / D);
    const p = [x0 + (i % columns) * cell, y0 + Math.floor(i / columns) * cell];
    if (!path.length || path[path.length - 1][0] !== p[0] || path[path.length - 1][1] !== p[1]) path.push(p);
  }
  path.reverse();
  path[0] = [...from];
  path[path.length - 1] = [...to];
  return path;
}

class MinHeap {
  #items = [];
  #keys = [];
  get size() {
    return this.#items.length;
  }
  push(item, key) {
    const items = this.#items;
    const keys = this.#keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop() {
    const items = this.#items;
    const keys = this.#keys;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= items.length) break;
        if (child + 1 < items.length && keys[child + 1] < keys[child]) child += 1;
        if (keys[child] >= lastKey) break;
        items[i] = items[child];
        keys[i] = keys[child];
        i = child;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** Ramer–Douglas–Peucker: the grid path's corners, without its staircase. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  let worst = 0;
  let at = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const d = toPolyline(points[i], [a, b]).distance;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** Chaikin corner cutting: rounds corners into bends, keeps both ends. */
function chaikin(points, rounds) {
  let out = points;
  for (let k = 0; k < rounds; k += 1) {
    const next = [out[0]];
    for (let i = 0; i + 1 < out.length; i += 1) {
      const a = out[i];
      const b = out[i + 1];
      if (i > 0) next.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)]);
      if (i + 2 < out.length) next.push([lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) out.push(out[i - 1] + dist(points[i - 1], points[i]));
  return out;
}

/** Evenly spaced points along a polyline, both ends kept exactly. */
function resample(points, spacing) {
  const along = cumulative(points);
  const length = along[along.length - 1];
  const count = Math.max(1, Math.round(length / spacing));
  const out = [];
  let j = 0;
  for (let k = 0; k <= count; k += 1) {
    const d = (k / count) * length;
    while (j < points.length - 2 && along[j + 1] < d) j += 1;
    const span = along[j + 1] - along[j];
    const t = span > 0 ? (d - along[j]) / span : 0;
    out.push([lerp(points[j][0], points[j + 1][0], t), lerp(points[j][1], points[j + 1][1], t)]);
  }
  return out;
}

/**
 * Evens out tight bends the grid path leaves (Laplacian smoothing on a
 * 10 m polyline): no corner sharper than a bend of about 60 m radius,
 * while the first `keepStart` and last `keepEnd` points (the stubs) stay.
 */
function relax(points, keepStart = 1, keepEnd = 1, rounds = 100) {
  let out = points.map((p) => [...p]);
  for (let k = 0; k < rounds; k += 1) {
    out = out.map((p, i) => {
      if (i < keepStart || i >= out.length - keepEnd) return p;
      const a = out[i - 1];
      const b = out[i + 1];
      return [p[0] + 0.5 * ((a[0] + b[0]) / 2 - p[0]), p[1] + 0.5 * ((a[1] + b[1]) / 2 - p[1])];
    });
  }
  return out;
}

/**
 * Keeps the points of a dense polyline a road needs: every `spacing` metres
 * on the straights, closer in bends, so no corner turns more than `maxTurn`
 * (the road is drawn and ridden as straight pieces between points).
 */
function decimate(points, spacing = SPACING, maxTurn = 0.1) {
  const out = [points[0]];
  let run = 0;
  let turn = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    run += dist(points[i - 1], points[i]);
    const a = Math.atan2(points[i][1] - points[i - 1][1], points[i][0] - points[i - 1][0]);
    const b = Math.atan2(points[i + 1][1] - points[i][1], points[i + 1][0] - points[i][0]);
    turn += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    if (run >= spacing || turn >= maxTurn) {
      out.push(points[i]);
      run = 0;
      turn = 0;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Small seeded bends, so long straights don't look drawn with a ruler. */
function meander(points, seed) {
  const along = cumulative(points);
  const length = along[along.length - 1];
  const random = seededRandom(seed);
  const waves = [0, 1, 2].map((i) => ({ k: (2 * Math.PI) / (220 + 260 * i + 120 * random()), phase: random() * 2 * Math.PI, a: 7 - 2 * i }));
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const run = dist(a, b) || 1;
    const normal = [-(b[1] - a[1]) / run, (b[0] - a[0]) / run];
    const fade = smoothstep(0, 150, along[i]) * smoothstep(0, 150, length - along[i]);
    const o = fade * waves.reduce((sum, w) => sum + w.a * Math.sin(w.k * along[i] + w.phase), 0);
    return [p[0] + normal[0] * o, p[1] + normal[1] * o];
  });
}

/** Elevation of the land at a point, averaged over a small disc (a node's level). */
const levelAt = (p, radius = 40) => {
  let sum = 0;
  let n = 0;
  for (let a = 0; a < 8; a += 1) {
    sum += terrain.at(p[0] + Math.cos(a) * radius, p[1] + Math.sin(a) * radius);
    n += 1;
  }
  return (sum / n + terrain.at(p[0], p[1])) / 2;
};

/**
 * The road's profile: the land under it, smoothed (cuts and fills even out
 * the small bumps), pinned to both nodes' levels and kept below `maxGrade`.
 */
function roadProfile(points, fromLevel, toLevel, maxGrade = 0.092) {
  const along = cumulative(points);
  const length = along[along.length - 1];
  let z = points.map((p) => Math.max(1.5, terrain.at(p[0], p[1])));
  for (let pass = 0; pass < 6; pass += 1) {
    z = z.map((_, i) => {
      let sum = 0;
      let weight = 0;
      for (let k = -5; k <= 5; k += 1) {
        const j = clamp(i + k, 0, z.length - 1);
        const w = 6 - Math.abs(k);
        sum += z[j] * w;
        weight += w;
      }
      return sum / weight;
    });
  }
  const startFix = fromLevel - z[0];
  const endFix = toLevel - z[z.length - 1];
  z = z.map((v, i) => v + startFix * (1 - smoothstep(0, 400, along[i])) + endFix * (1 - smoothstep(0, 400, length - along[i])));
  z[0] = fromLevel;
  z[z.length - 1] = toLevel;
  // Both ends stay at their places' level; the points between give way.
  for (let pass = 0; pass < 40; pass += 1) {
    for (let i = 1; i < z.length - 1; i += 1) {
      const run = along[i] - along[i - 1];
      z[i] = clamp(z[i], z[i - 1] - maxGrade * run, z[i - 1] + maxGrade * run);
    }
    for (let i = z.length - 2; i >= 1; i -= 1) {
      const run = along[i + 1] - along[i];
      z[i] = clamp(z[i], z[i + 1] - maxGrade * run, z[i + 1] + maxGrade * run);
    }
  }
  return z;
}

/** Distance to every road laid so far, on a coarse grid (for keeping roads apart). */
class RoadField {
  cell = 40;
  #points = new Map();
  add(points) {
    for (const p of points) {
      const key = `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`;
      if (!this.#points.has(key)) this.#points.set(key, []);
      this.#points.get(key).push(p);
    }
  }
  distance(x, y, reach = SEARCH.apart) {
    const span = Math.ceil(reach / this.cell);
    const c0 = Math.floor(x / this.cell);
    const r0 = Math.floor(y / this.cell);
    let best = reach;
    for (let r = r0 - span; r <= r0 + span; r += 1) {
      for (let c = c0 - span; c <= c0 + span; c += 1) {
        for (const p of this.#points.get(`${c},${r}`) ?? []) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
      }
    }
    return best;
  }
}

const SPACING = 15;

/** How far roads run straight out of a place before they find their own way. */
const STUB = 130;

/** Direction each `through` road leaves its place in, by `${edge}@${node}`. */
function throughDirections(nodes) {
  const out = new Map();
  const far = (edgeId, nodeId) => {
    const e = EDGES.find((x) => x.id === edgeId);
    return nodes.get(e.from === nodeId ? e.to : e.from).at;
  };
  for (const node of nodes.values()) {
    if (!node.through) continue;
    const [arrive, leave] = node.through;
    const a = far(arrive, node.id);
    const b = far(leave, node.id);
    const run = dist(a, b);
    // `axis` (degrees counter-clockwise from east) when the roads' far ends do not give the line, as along a coast.
    const turn = node.axis === undefined ? null : (node.axis * Math.PI) / 180;
    const axis = turn === null ? [(b[0] - a[0]) / run, (b[1] - a[1]) / run] : [Math.cos(turn), Math.sin(turn)];
    out.set(`${leave}@${node.id}`, axis);
    out.set(`${arrive}@${node.id}`, [-axis[0], -axis[1]]);
  }
  for (const edge of EDGES) {
    for (const [nodeId, degrees] of Object.entries(edge.leaves ?? {})) {
      const angle = (degrees * Math.PI) / 180;
      out.set(`${edge.id}@${nodeId}`, [Math.cos(angle), Math.sin(angle)]);
    }
  }
  return out;
}

function buildNetwork() {
  const nodes = new Map(NODES.map((n) => [n.id, { ...n, elevation: round1(levelAt(n.at)) }]));
  const directions = throughDirections(nodes);
  const field = new RoadField();
  const edges = [];
  for (const [k, spec] of EDGES.entries()) {
    const a = nodes.get(spec.from);
    const b = nodes.get(spec.to);
    // Straight out of places with a main way through, then the cheapest path.
    const stub = (node) => {
      const dir = directions.get(`${spec.id}@${node.id}`);
      return dir ? [node.at[0] + dir[0] * STUB, node.at[1] + dir[1] * STUB] : null;
    };
    const [sa, sb] = [stub(a), stub(b)];
    const dirA = directions.get(`${spec.id}@${a.id}`);
    const dirB = directions.get(`${spec.id}@${b.id}`);
    // Leg by leg through the via points, each leg leaving the way the last one arrived.
    const stops = [sa ?? a.at, ...(spec.via ?? []), sb ?? b.at];
    let grid = [];
    let heading = dirA ?? null;
    for (let leg = 0; leg + 1 < stops.length; leg += 1) {
      const last = leg + 2 === stops.length;
      const part = layRoad(stops[leg], stops[leg + 1], (x, y) => field.distance(x, y), {
        startDir: heading,
        endDir: last && dirB ? [-dirB[0], -dirB[1]] : null,
        shore: spec.shore,
      });
      const tail = part.slice(-4);
      heading = [tail[tail.length - 1][0] - tail[0][0], tail[tail.length - 1][1] - tail[0][1]];
      grid = grid.length ? [...grid, ...part.slice(1)] : part;
    }
    // The stubs stay out of the simplification, so roads leave places exactly along them.
    const path = [...(sa ? [a.at] : []), ...simplify(grid, 18), ...(sb ? [b.at] : [])];
    const xy = decimate(resample(meander(relax(resample(chaikin(path, 4), 10), sa ? 4 : 1, sb ? 4 : 1), SEED + 97 * (k + 1)), 3));
    xy[0] = [...a.at];
    xy[xy.length - 1] = [...b.at];
    const z = roadProfile(xy, a.elevation, b.elevation);
    const points = xy.map((p, i) => [round1(p[0]), round1(p[1]), round1(z[i])]);
    field.add(points);
    edges.push({ ...spec, points });
  }
  for (const edge of edges) {
    edge.length = Math.round(cumulative(edge.points).at(-1));
    edge.zones = edgeZones(edge);
    edge.markers = edgeMarkers(edge);
    delete edge.sprints;
    if (edge.shore !== undefined) checkCoastal(edge);
  }
  return { nodes: [...nodes.values()], edges };
}

/** Smoothing and the road's wander may take a road this far inside the shore distance it was searched with. */
const SHORE_SLACK = 30;

/** A coastal road must keep its distance from the sea and out of the surf. */
function checkCoastal(edge) {
  for (const [x, y, z] of edge.points) {
    const where = `at (${Math.round(x)}, ${Math.round(y)})`;
    const near = inland(x, y);
    if (near < edge.shore - SHORE_SLACK) throw new Error(`${edge.id} comes ${Math.round(near)} m from the sea ${where}`);
    if (z < 1.5) throw new Error(`${edge.id} rides at ${z} m ${where}`);
  }
}

// ---------------------------------------------------- zones and markers ---

/** Where an edge crosses the river (metres from its start), away from its ends. */
function riverCrossings(edge) {
  const along = cumulative(edge.points);
  const out = [];
  for (let i = 0; i + 1 < edge.points.length; i += 1) {
    const p = edge.points[i];
    const q = edge.points[i + 1];
    for (let j = 0; j + 1 < RIVER.length; j += 1) {
      const hit = intersect(p, q, RIVER[j], RIVER[j + 1]);
      if (hit === null) continue;
      const at = along[i] + hit * (along[i + 1] - along[i]);
      if (at > 180 && at < along.at(-1) - 180) out.push(Math.round(at));
    }
  }
  return out;
}

function intersect(p, q, a, b) {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
  const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

function edgeZones(edge) {
  const length = edge.length;
  const zones = (edge.zones ?? []).map((z) => ({ type: z.type, from: Math.round(z.from * length), to: Math.round(z.to * length) }));
  for (const v of VILLAGES) {
    if (edge.from === v.node) zones.push({ type: "village", from: v.from, to: Math.min(v.to, length - 150) });
    if (edge.to === v.node) zones.push({ type: "village", from: Math.max(150, length - v.to), to: length - v.from });
  }
  for (const at of riverCrossings(edge)) zones.push({ type: "river", at });
  return zones.filter((z) => z.type === "river" || z.to - z.from > 120);
}

/** Elevation along an edge at `d` metres from its start. */
function edgeElevation(edge, d) {
  const along = cumulative(edge.points);
  let i = 0;
  while (i < along.length - 2 && along[i + 1] < d) i += 1;
  const t = clamp((d - along[i]) / (along[i + 1] - along[i] || 1), 0, 1);
  return lerp(edge.points[i][2], edge.points[i + 1][2], t);
}

/**
 * Markers per riding direction, `distance` measured from where the rider
 * enters the edge. Climbs are found from the profile (at least 35 m up at
 * 3 % or more on average); sprints sit on the flattest stretch near where
 * the edge asks for them.
 */
function edgeMarkers(edge) {
  const markers = [];
  const length = edge.length;
  for (const dir of [1, -1]) {
    const h = (d) => edgeElevation(edge, dir > 0 ? d : length - d);
    // Climbs: grow a stretch while it keeps rising, allowing short flat bits.
    let start = null;
    let low = 0;
    let best = 0;
    let bestAt = 0;
    const step = 20;
    const flush = (end) => {
      if (start === null) return;
      const rise = h(end) - h(start);
      if (rise >= 35 && rise / (end - start) >= 0.03) markers.push({ type: "climb", dir, distance: Math.round(start), length: Math.round(end - start) });
      start = null;
    };
    for (let d = 0; d + step <= length; d += step) {
      const grade = (h(d + step) - h(d)) / step;
      if (start === null) {
        if (grade > 0.02) {
          start = d;
          low = h(d);
          best = low;
          bestAt = d;
        }
      } else {
        if (h(d + step) > best) {
          best = h(d + step);
          bestAt = d + step;
        }
        // Ended: dropped 6 m below the top, or 300 m without gaining.
        if (best - h(d + step) > 6 || d + step - bestAt > 300) {
          flush(bestAt);
        }
      }
    }
    if (start !== null) flush(bestAt);
    void low;
  }
  for (const sprint of edge.sprints ?? []) {
    const span = 320;
    let pick = null;
    for (let d = Math.max(150, sprint.near * length - 500); d + span <= Math.min(length - 150, sprint.near * length + 500); d += 20) {
      const from = sprint.dir > 0 ? d : length - d - span;
      let rough = 0;
      for (let s = from; s < from + span; s += 20) rough += Math.abs(edgeElevation(edge, s + 20) - edgeElevation(edge, s));
      if (!pick || rough < pick.rough) pick = { d, rough };
    }
    if (pick) markers.push({ type: "sprint", dir: sprint.dir, distance: Math.round(pick.d), length: span });
  }
  return markers;
}

// ----------------------------------------------------------------- routes ---

/** A walk's points, markers and zones in route distance (the classic route file). */
function deriveRoute(network, spec) {
  const edges = new Map(network.edges.map((e) => [e.id, e]));
  const nodes = new Map(network.nodes.map((n) => [n.id, n]));
  const points = [];
  const corners = [];
  const markers = [{ type: "start_finish", distance: 0 }];
  const zones = [];
  // Where each road of the walk begins: its first point and its place.
  const steps = [];
  let offset = 0;
  let at = null;
  for (const [id, dir] of spec.walk) {
    const edge = edges.get(id);
    if (!edge) throw new Error(`${spec.id}: unknown edge ${id}`);
    const [enter, leave] = dir > 0 ? [edge.from, edge.to] : [edge.to, edge.from];
    if (at !== null && enter !== at) throw new Error(`${spec.id}: ${id} does not start at ${at}`);
    if (at === null) at = enter;
    steps.push({ edge: id, dir, length: edge.length, node: { id: enter, x: nodes.get(enter).at[0], y: nodes.get(enter).at[1] } });
    const run = dir > 0 ? edge.points : [...edge.points].reverse();
    if (points.length) corners.push(points.length - 1);
    points.push(...(points.length ? run.slice(1) : run));
    const length = edge.length;
    const map = (d) => offset + (dir > 0 ? d : length - d);
    for (const m of edge.markers) {
      if (m.dir === dir) markers.push({ type: m.type, distance: Math.round(offset + m.distance), length: m.length });
    }
    for (const z of edge.zones) {
      if (z.type === "river") zones.push({ type: "river", at: Math.round(map(z.at)) });
      else {
        const [from, to] = [map(z.from), map(z.to)].sort((a, b) => a - b);
        zones.push({ type: z.type, from: Math.round(from), to: Math.round(to) });
      }
    }
    offset += length;
    at = leave;
  }
  const start = nodes.get(spec.walk[0][1] > 0 ? edges.get(spec.walk[0][0]).from : edges.get(spec.walk[0][0]).to);
  if (at !== start.id) throw new Error(`${spec.id}: the walk ends at ${at}, not back at ${start.id}`);
  if (start.kind !== "cafe") throw new Error(`${spec.id}: routes start at a café`);
  const turn = cornerAngle(points, points.length - 1, 1);
  if (turn > 0.1) throw new Error(`${spec.id}: the route turns ${(turn * 57.3).toFixed(0)}° over its start line`);
  points.pop(); // routes close themselves
  const rounded = roundCorners(points, corners);
  const walk = walkDistances(rounded, steps);
  markers.sort((a, b) => a.distance - b.distance);
  zones.sort((a, b) => (a.at ?? a.from) - (b.at ?? b.from));
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    loop: true,
    lanes: 4,
    seed: spec.seed,
    map: { id: MAP.id, seed: MAP.seed },
    points: rounded,
    markers,
    zones,
    walk,
  };
}

/**
 * The walk in route distance (ADR 0010, #14): each road's `from`/`to` on the
 * rounded route, where it passes closest to the road's entry place. The
 * server maps route distance to (road, direction, offset) with it.
 */
function walkDistances(points, steps) {
  const cumulative = [0];
  for (let i = 1; i <= points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i % points.length];
    cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cumulative[points.length];
  const starts = [0];
  let from = 0;
  for (const step of steps.slice(1)) {
    let best = { d: Infinity, at: from };
    for (let i = from; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const span = cumulative[i + 1] - cumulative[i];
      const t = span > 0 ? Math.max(0, Math.min(1, ((step.node.x - a[0]) * (b[0] - a[0]) + (step.node.y - a[1]) * (b[1] - a[1])) / span ** 2)) : 0;
      const d = Math.hypot(a[0] + (b[0] - a[0]) * t - step.node.x, a[1] + (b[1] - a[1]) * t - step.node.y);
      if (d < best.d) best = { d, at: cumulative[i] + span * t, index: i };
      // The first pass by the place counts: a route may come by again later (Island Tour at the west fork).
      else if (best.d <= 20 && d > 20) break;
    }
    if (best.d > 20) throw new Error(`the route misses ${step.node.id} by ${best.d.toFixed(0)} m`);
    starts.push(best.at);
    from = best.index;
  }
  const round1 = (x) => Math.round(x * 10) / 10;
  return steps.map((step, i) => ({ edge: step.edge, dir: step.dir, from: round1(starts[i]), to: round1(i + 1 < steps.length ? starts[i + 1] : total), length: step.length }));
}

/** Turn at point `i` between the incoming and the next segment (radians). */
function cornerAngle(points, i, next = i + 1) {
  const a = points[i - 1];
  const b = points[i];
  const c = points[next];
  const turn = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
}

/**
 * Rounds the corners where a route turns from one road onto the next (the
 * roads meet at their place at an angle): a circular arc of up to `radius`
 * metres instead, so riders and cameras turn rather than snap. Lengths
 * change by a few metres; markers are far from places.
 */
function roundCorners(points, corners, radius = 15, maxTangent = 40) {
  const out = [];
  let from = 0;
  for (const i of corners) {
    const angle = cornerAngle(points, i);
    if (angle < 0.07) continue;
    const tangent = Math.min(maxTangent, radius * Math.tan(angle / 2));
    const r = tangent / Math.tan(angle / 2);
    const back = pointBack(points, i, tangent);
    const ahead = pointAhead(points, i, tangent);
    if (back.index < from) continue; // too close to the last turn: leave it
    out.push(...points.slice(from, back.index + 1), back.point);
    // Centre of the arc: from the back point, square to the incoming road.
    const c = points[i];
    const inDir = [(c[0] - back.point[0]) / tangent, (c[1] - back.point[1]) / tangent];
    const outDir = [(ahead.point[0] - c[0]) / tangent, (ahead.point[1] - c[1]) / tangent];
    const left = inDir[0] * outDir[1] - inDir[1] * outDir[0] > 0 ? 1 : -1;
    const normal = [-inDir[1] * left, inDir[0] * left];
    const center = [back.point[0] + normal[0] * r, back.point[1] + normal[1] * r];
    const start = Math.atan2(back.point[1] - center[1], back.point[0] - center[0]);
    const steps = Math.max(3, Math.ceil((angle * r) / 3));
    for (let k = 1; k < steps; k += 1) {
      const t = k / steps;
      const a = start + left * angle * t;
      const z = lerp(back.point[2], ahead.point[2], t);
      out.push([round1(center[0] + Math.cos(a) * r), round1(center[1] + Math.sin(a) * r), round1(z)]);
    }
    out.push(ahead.point);
    from = ahead.index;
  }
  out.push(...points.slice(from));
  // Arcs end next to original points now and then: drop the slivers between.
  return out.filter((p, i) => i === 0 || dist(out[i - 1], p) > 1.5);
}

/** The point `d` metres before point `i` along the polyline, and the last original point before it. */
function pointBack(points, i, d) {
  let left = d;
  for (let j = i; j > 0; j -= 1) {
    const run = dist(points[j - 1], points[j]);
    if (run >= left) {
      const t = left / run;
      return { index: j - 1, point: [0, 1, 2].map((k) => round1(lerp(points[j][k], points[j - 1][k], t))) };
    }
    left -= run;
  }
  return { index: 0, point: points[0] };
}

/** The point `d` metres after point `i`, and the first original point after it. */
function pointAhead(points, i, d) {
  let left = d;
  for (let j = i; j + 1 < points.length; j += 1) {
    const run = dist(points[j], points[j + 1]);
    if (run >= left) {
      const t = left / run;
      return { index: j + 1, point: [0, 1, 2].map((k) => round1(lerp(points[j][k], points[j + 1][k], t))) };
    }
    left -= run;
  }
  return { index: points.length - 1, point: points[points.length - 1] };
}

// ----------------------------------------------------------------- output ---

function networkFile(network) {
  const b64 = Buffer.from(terrain.heights.buffer).toString("base64");
  return {
    id: MAP.id,
    name: MAP.name,
    seed: MAP.seed,
    version: 1,
    coast: { center: COASTLINE.center, radius: COASTLINE.radius },
    terrain: { x0: terrain.x0, y0: terrain.y0, cell: terrain.cell, columns: terrain.columns, rows: terrain.rows, scale: 0.1, heights: b64 },
    nodes: network.nodes.map((n) => ({ id: n.id, kind: n.kind, ...(n.name ? { name: n.name } : {}), x: n.at[0], y: n.at[1], elevation: n.elevation })),
    edges: network.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, type: e.type, length: e.length, points: e.points, markers: e.markers, zones: e.zones })),
    routes: ROUTES.map((r) => ({ id: r.id, name: r.name, description: r.description, seed: r.seed, walk: r.walk })),
  };
}

/** JSON with flat arrays on one line (one point per line), so diffs stay readable. */
function pretty(value) {
  return JSON.stringify(value, null, 2).replace(/\[([^[\]{}"]*|[^[\]{}]*"[^[\]{}]*)\]/g, (_, inner) => `[${inner.split(",").map((t) => t.trim()).join(",")}]`);
}

function stats(r) {
  const p = r.points;
  let total = 0;
  let gain = 0;
  let steepest = 0;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const run = dist(a, b);
    total += run;
    gain += Math.max(0, b[2] - a[2]);
    if (run > 0) steepest = Math.max(steepest, Math.abs(b[2] - a[2]) / run);
  }
  const elevations = p.map((q) => q[2]);
  return { length: Math.round(total), gain: Math.round(gain), steepest: +(steepest * 100).toFixed(1), low: Math.min(...elevations), high: Math.max(...elevations) };
}

/** Closest approach between two edges away from shared nodes. */
function clearance(a, b) {
  const ends = new Set([a.from, a.to].filter((n) => n === b.from || n === b.to));
  const nodeAt = new Map(NODES.map((n) => [n.id, n.at]));
  const nearEnd = (p) => [...ends].some((n) => dist(p, nodeAt.get(n)) < 250);
  let best = Infinity;
  for (const p of a.points) {
    if (nearEnd(p)) continue;
    for (const q of b.points) if (!nearEnd(q)) best = Math.min(best, dist(p, q));
  }
  return Math.round(best);
}

/** A small PNG of the map: shaded land, sea, the river line, roads and places. */
function drawPng(path, network, scale = 12) {
  const x0 = terrain.x0;
  const y1 = terrain.y0 + (terrain.rows - 1) * terrain.cell;
  const width = Math.floor(((terrain.columns - 1) * terrain.cell) / scale);
  const height = Math.floor(((terrain.rows - 1) * terrain.cell) / scale);
  const px = new Uint8Array(width * height * 3);
  const put = (x, y, rgb) => {
    const c = Math.round((x - x0) / scale);
    const r = Math.round((y1 - y) / scale);
    if (c < 0 || r < 0 || c >= width || r >= height) return;
    px.set(rgb, (r * width + c) * 3);
  };
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const x = x0 + c * scale;
      const y = y1 - r * scale;
      const h = terrain.at(x, y);
      const shade = clamp(0.75 + (terrain.at(x - scale, y + scale) - terrain.at(x + scale, y - scale)) / 25, 0.35, 1.25);
      let rgb;
      if (h < 0) rgb = [40 + h, 90 + h, 140 + h];
      else if (h < 2) rgb = [214, 196, 140];
      else {
        const t = clamp(h / 500, 0, 1);
        rgb = [lerp(110, 170, t), lerp(160, 150, t), lerp(80, 120, t)];
        if (Math.floor(h / 25) !== Math.floor(terrain.at(x + scale, y) / 25)) rgb = rgb.map((v) => v * 0.8);
      }
      px.set(rgb.map((v) => clamp(Math.round(v * (h < 0 ? 1 : shade)), 0, 255)), (r * width + c) * 3);
    }
  }
  for (const p of resample(RIVER, 4)) put(p[0], p[1], [60, 120, 220]);
  const colors = { main: [30, 30, 30], road: [120, 60, 30] };
  for (const e of network.edges) {
    for (const p of resample(e.points.map((q) => [q[0], q[1]]), 3)) {
      for (const [dx, dy] of [[0, 0], [scale, 0], [0, scale]]) put(p[0] + dx, p[1] + dy, colors[e.type] ?? [0, 0, 0]);
    }
    for (const m of e.markers) {
      const color = m.type === "climb" ? [220, 30, 30] : [30, 60, 230];
      for (let d = m.distance; d < m.distance + m.length; d += 3) {
        const along = e.dir; void along;
        const s = m.dir > 0 ? d : e.length - d;
        const pts = e.points;
        const acc = cumulative(pts);
        let i = 0;
        while (i < acc.length - 2 && acc[i + 1] < s) i += 1;
        const t = clamp((s - acc[i]) / (acc[i + 1] - acc[i] || 1), 0, 1);
        const off = m.dir > 0 ? 2 * scale : -2 * scale;
        const nx = -(pts[i + 1][1] - pts[i][1]);
        const ny = pts[i + 1][0] - pts[i][0];
        const nl = Math.hypot(nx, ny) || 1;
        put(lerp(pts[i][0], pts[i + 1][0], t) + (nx / nl) * off, lerp(pts[i][1], pts[i + 1][1], t) + (ny / nl) * off, color);
      }
    }
  }
  for (const n of network.nodes) {
    const color = n.kind === "cafe" ? [250, 220, 0] : [255, 255, 255];
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) if (dx * dx + dy * dy <= 16) put(n.at[0] + dx * scale, n.at[1] + dy * scale, color);
  }
  writeFileSync(path, png(width, height, px));
}

function png(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let r = 0; r < height; r += 1) Buffer.from(rgb.buffer, r * width * 3, width * 3).copy(raw, r * (width * 3 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------- main ---

const network = buildNetwork();
console.log(network.nodes.map((n) => `${n.id} ${n.elevation} m`).join(", "));
const routes = ROUTES.map((spec) => deriveRoute(network, spec));
const args = process.argv.slice(2);
const write = !args.includes("--dry-run");

/** Tightest bend of a polyline: the smallest radius through three points 30 m apart. */
function tightestBend(points) {
  let best = Infinity;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    if (area > 1e-6) best = Math.min(best, (dist(a, b) * dist(b, c) * dist(a, c)) / (4 * area));
  }
  return Math.round(best);
}

for (const e of network.edges) {
  const z = e.points.map((p) => p[2]);
  if (tightestBend(e.points) < 25) console.warn(`edge ${e.id} bends with a ${tightestBend(e.points)} m radius`);
  console.log(`edge ${e.id.padEnd(13)} ${String(e.length).padStart(5)} m  ${Math.min(...z).toFixed(0).padStart(4)}–${Math.max(...z).toFixed(0).padEnd(4)} m  ${e.markers.map((m) => `${m.type}${m.dir > 0 ? "→" : "←"}${m.length}`).join(" ")}  ${e.zones.map((z2) => z2.type).join(",")}`);
}
for (const r of routes) console.log(`route ${r.id.padEnd(16)}`, JSON.stringify(stats(r)), r.markers.filter((m) => m.type !== "start_finish").map((m) => `${m.type}@${m.distance}+${m.length}`).join(" "));
let tightest = { gap: Infinity };
for (let i = 0; i < network.edges.length; i += 1) {
  for (let j = i + 1; j < network.edges.length; j += 1) {
    const gap = clearance(network.edges[i], network.edges[j]);
    if (gap < tightest.gap) tightest = { gap, between: `${network.edges[i].id} ↔ ${network.edges[j].id}` };
  }
}
console.log("closest roads", JSON.stringify(tightest));
let coastal = { inland: Infinity };
for (const e of network.edges) for (const p of e.points) if (inland(p[0], p[1]) < coastal.inland) coastal = { inland: Math.round(inland(p[0], p[1])), edge: e.id };
console.log("closest to the coast", JSON.stringify(coastal));
const pngAt = args.indexOf("--png");
if (pngAt >= 0) drawPng(args[pngAt + 1], network);

if (write) {
  mkdirSync(new URL("../routes/maps/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../routes/maps/${MAP.id}.json`, import.meta.url), `${pretty(networkFile(network))}\n`);
  for (const r of routes) writeFileSync(new URL(`../routes/${r.id}.json`, import.meta.url), `${pretty(r)}\n`);
}
