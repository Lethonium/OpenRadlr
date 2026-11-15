#!/usr/bin/env node
/**
 * Writes a track route (OpenBikeNet, shared with other apps) to stdout:
 *
 *   node tools/track-route.mjs velodrome > routes/velodrome.json
 *   node tools/track-route.mjs herne-hill > routes/herne-hill.json
 *   node tools/track-route.mjs herne-hill-clockwise > routes/herne-hill-clockwise.json
 *
 * Each track is an oval of two straights and two semicircles, a point every
 * ~2.5 m on the bends, ridden anticlockwise unless it says otherwise. The
 * closed polyline, closing segment included, is scaled to exactly the shared
 * length. It stands on the island (map `valley`) beside a road, off the road
 * network: the home straight with the start/finish line faces the road on the
 * north, so a connector road can join it later. The track is flat, at the
 * height of the ground under its centre.
 */
import { readFileSync } from "node:fs";
import { RoadNetwork } from "../client/public/js/route/network.js";

const SHARED = "shared with riders from other apps when this server is connected to OpenBikeNet.";
const HERNE_HILL = {
  name: "Herne Hill Velodrome",
  lanes: 4,
  openbikenet_length: 450,
  // Bend radius fitted to the real track (OpenBikeNet protocol, tools/herne_hill_gpx.py).
  radius: 45.3,
  // The start/finish line, this far before the middle of the home straight, as in London.
  start: 13,
  centre: [-480, -150],
};
const TRACKS = {
  velodrome: {
    name: "Velodrome",
    description: `250 m oval, ${SHARED}`,
    lanes: 4,
    seed: 250,
    openbikenet: "velodrome-250",
    openbikenet_length: 250,
    straight: 50,
    // The start/finish line at the start of the home straight.
    start: 25,
    centre: [-210, -120],
  },
  "herne-hill": {
    ...HERNE_HILL,
    description: `The 450 m outdoor track of Herne Hill Velodrome in London, ridden anticlockwise as in racing; ${SHARED}`,
    seed: 450,
    openbikenet: "herne-hill-450",
  },
  "herne-hill-clockwise": {
    ...HERNE_HILL,
    name: "Herne Hill Velodrome (clockwise)",
    description: `Herne Hill Velodrome the other way round, from the same start/finish line; ${SHARED}`,
    seed: 451,
    openbikenet: "herne-hill-450-clockwise",
    clockwise: true,
  },
};
const MAP = { id: "valley", seed: 2026 };
const BEND_STEP = 2.5;

const id = process.argv[2];
const track = TRACKS[id];
if (!track) {
  process.stderr.write(`usage: node tools/track-route.mjs <${Object.keys(TRACKS).join("|")}>\n`);
  process.exit(1);
}

const length = track.openbikenet_length;
// Either the straights or the bend radius is given; the other takes up the rest of the length.
const radius = track.radius ?? (length - 2 * track.straight) / (2 * Math.PI);
const straight = track.straight ?? (length - 2 * Math.PI * radius) / 2;
const half = straight / 2;
const steps = Math.round((Math.PI * radius) / BEND_STEP);

// x east, y north from the centre: the home straight on the north (y = radius), ridden west.
let points = [[track.start, radius], [-half, radius]];
for (let i = 1; i < steps; i += 1) {
  const a = Math.PI / 2 + (Math.PI * i) / steps;
  points.push([-half + radius * Math.cos(a), radius * Math.sin(a)]);
}
points.push([-half, -radius], [half, -radius]);
for (let i = 1; i < steps; i += 1) {
  const a = -Math.PI / 2 + (Math.PI * i) / steps;
  points.push([half + radius * Math.cos(a), radius * Math.sin(a)]);
}
points.push([half, radius]);
// From the same line the other way round.
if (track.clockwise) points = [points[0], ...points.slice(1).reverse()];
// The line at the end of the straight is a point already.
points = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > 1e-9);

const closedLength = points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
}, 0);
const scale = length / closedLength;
const network = new RoadNetwork(JSON.parse(readFileSync(new URL("../routes/maps/valley.json", import.meta.url), "utf8")));
const [cx, cy] = track.centre;
const elevation = Math.round(network.heightAt(cx, cy) * 10) / 10;
const round = (v) => Math.round(v * 1e6) / 1e6;
const placed = points.map(([x, y]) => [round(cx + x * scale), round(cy + y * scale), elevation]);

const route = {
  id,
  name: track.name,
  description: track.description,
  loop: true,
  lanes: track.lanes,
  seed: track.seed,
  map: MAP,
  openbikenet: track.openbikenet,
  openbikenet_length: length,
  zones: [],
  markers: [{ type: "start_finish", distance: 0 }],
};

const { markers, ...rest } = route;
const head = JSON.stringify(rest, null, 2).slice(0, -2);
const marks = markers.map((m) => `    ${JSON.stringify(m)}`).join(",\n");
const lines = placed.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
process.stdout.write(`${head},\n  "markers": [\n${marks}\n  ],\n  "points": [\n${lines}\n  ]\n}\n`);
