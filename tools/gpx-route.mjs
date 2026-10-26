#!/usr/bin/env node
/**
 * Converts a GPX track into a route file (#16 step 1).
 *
 *   node tools/gpx-route.mjs in.gpx --id my-route --name "My Route" \
 *     [--description text] [--geo lat,lon] [--seed n] [--markers file.json] \
 *     [--sigma metres] [--target-length m] [--target-climb m] [--out file]
 *
 * The route is written to --out (or stdout), points one per line like the
 * other route files. The report goes to stderr. Markers file: a JSON array of
 * `{type: "climb" | "sprint", name, lat, lon | distance, length?}`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gpxToRoute } from "../client/public/js/route/gpxImport.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

/** JSON with each point on its own line, like the committed routes. */
function format(route) {
  const { points, markers, ...rest } = route;
  const head = JSON.stringify(rest, null, 2).slice(0, -2);
  const lines = points.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
  const marks = markers.map((m) => `    ${JSON.stringify(m)}`).join(",\n");
  return `${head},\n  "points": [\n${lines}\n  ],\n  "markers": [\n${marks}\n  ]\n}\n`;
}

function printReport(report) {
  const pct = (v) => (v === undefined ? "" : ` (${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)} % vs target)`);
  const err = (text) => process.stderr.write(`${text}\n`);
  err(`length     ${(report.length / 1000).toFixed(2)} km${pct(report.lengthOff)}`);
  err(`climbing   ${report.climb.toFixed(0)} m${pct(report.climbOff)}`);
  err(`steepest   ${(report.steepest.grade * 100).toFixed(1)} % at ${(report.steepest.distance / 1000).toFixed(1)} km`);
  for (const c of report.climbs) {
    err(`climb      ${(c.name ?? "(unnamed)").padEnd(18)} km ${(c.distance / 1000).toFixed(1).padStart(6)}  ${(c.length / 1000).toFixed(1)} km  +${c.gain.toFixed(0)} m  avg ${((c.gain / c.length) * 100).toFixed(1)} %`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args._[0] || !args.id || !args.name) throw new Error("usage: gpx-route.mjs in.gpx --id <id> --name <name> [options]");
  const [lat, lon] = args.geo ? args.geo.split(",").map(Number) : [];
  if (args.geo && !(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error("--geo needs lat,lon, e.g. 38,2.6");
  const { route, report } = gpxToRoute(readFileSync(args._[0], "utf8"), {
    id: args.id,
    name: args.name,
    description: args.description,
    seed: args.seed ? Number(args.seed) : undefined,
    geo: args.geo ? { lat, lon } : undefined,
    markers: args.markers ? JSON.parse(readFileSync(args.markers, "utf8")) : [],
    sigma: args.sigma ? Number(args.sigma) : undefined,
    targetLength: args["target-length"] ? Number(args["target-length"]) : undefined,
    targetClimb: args["target-climb"] ? Number(args["target-climb"]) : undefined,
  });
  const json = format(route);
  if (args.out) writeFileSync(args.out, json);
  else process.stdout.write(json);
  printReport(report);
} catch (error) {
  process.stderr.write(`gpx-route: ${error.message}\n`);
  process.exit(1);
}
