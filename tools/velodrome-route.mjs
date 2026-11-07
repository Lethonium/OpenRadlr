#!/usr/bin/env node
/**
 * Writes the velodrome route (OpenBikeNet, shared with other apps) to stdout:
 *
 *   node tools/velodrome-route.mjs > routes/velodrome.json
 *
 * A 250 m oval: two 50 m straights and two semicircles, a point every ~2.5 m
 * on the bends. The closed polyline, closing segment included, is scaled to
 * exactly 250 m.
 */
const LENGTH = 250;
const STRAIGHT = 50;
const BEND_STEP = 2.5;
const ELEVATION = 40;

// Unscaled geometry: straight length 50, bend radius r with 2*pi*r + 2*50 = 250.
const radius = (LENGTH - 2 * STRAIGHT) / (2 * Math.PI);
const steps = Math.round((Math.PI * radius) / BEND_STEP);

const points = [];
// Bottom straight, left to right, from x = 0 (the start/finish line).
points.push([0, 0]);
// Right bend, from the bottom up to the top.
for (let i = 1; i < steps; i += 1) {
  const a = -Math.PI / 2 + (Math.PI * i) / steps;
  points.push([STRAIGHT + radius * Math.cos(a), radius + radius * Math.sin(a)]);
}
// Top straight, right to left.
points.push([STRAIGHT, 2 * radius]);
points.push([0, 2 * radius]);
// Left bend, from the top down to the bottom.
for (let i = 1; i < steps; i += 1) {
  const a = Math.PI / 2 + (Math.PI * i) / steps;
  points.push([radius * Math.cos(a), radius + radius * Math.sin(a)]);
}
// The end of the bottom straight, where the right bend starts.
points.splice(1, 0, [STRAIGHT, 0]);

const closedLength = points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
}, 0);
const scale = LENGTH / closedLength;
const round = (v) => Math.round(v * 1e6) / 1e6;
const scaled = points.map(([x, y]) => [round(x * scale), round(y * scale), ELEVATION]);

const route = {
  id: "velodrome",
  name: "Velodrome",
  description: "250 m oval, shared with riders from other apps when this server is connected to OpenBikeNet.",
  loop: true,
  lanes: 4,
  seed: 250,
  openbikenet: "velodrome-250",
  markers: [{ type: "start_finish", distance: 0 }],
  zones: [],
  points: scaled,
};

const { points: pts, markers, ...rest } = route;
const head = JSON.stringify(rest, null, 2).slice(0, -2);
const marks = markers.map((m) => `    ${JSON.stringify(m)}`).join(",\n");
const lines = pts.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
process.stdout.write(`${head},\n  "markers": [\n${marks}\n  ],\n  "points": [\n${lines}\n  ]\n}\n`);
