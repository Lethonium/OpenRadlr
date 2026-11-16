#!/usr/bin/env node
/**
 * Builds a route's 3D scene in Node and reports time, memory and the costliest
 * functions (sampling profiler), to find what keeps long routes from building
 * fast (#42).
 *
 *   node tools/scene-bench.mjs routes/lanzarote-lava-180.json [--top 14] [--biome temperate] [--scenery models]
 */
import { readFileSync } from "node:fs";
import { Session } from "node:inspector";
import { buildSceneNow } from "../client/public/js/view3d/worldScene.js";
import { sceneStats } from "../client/public/js/view3d/sceneStats.js";
import { floraOf } from "../client/public/js/view3d/scenery/flora.js";
import { KITS_OF, loadScenery } from "../client/public/js/view3d/scenery/load.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};
const file = JSON.parse(readFileSync(args[0], "utf8"));
const top = Number(option("--top", 14));
const biome = option("--biome", "temperate");
const sceneryLevel = option("--scenery", "off");
if (!(sceneryLevel in KITS_OF)) throw new Error(`Unknown scenery level "${sceneryLevel}"`);
const fetchJson = async (url) => JSON.parse(readFileSync(new URL(`../client/public/${url}`, import.meta.url), "utf8"));
const scenery = floraOf(await loadScenery(sceneryLevel, { fetchJson }), biome);

const session = new Session();
session.connect();
const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (e, r) => (e ? reject(e) : resolve(r))));
await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 1000 });

globalThis.gc?.();
const heap0 = process.memoryUsage().heapUsed;
await post("Profiler.start");
const t0 = performance.now();
const scene = buildSceneNow(file, [], null, biome, scenery);
const ms = performance.now() - t0;
const { profile } = await post("Profiler.stop");
const rss = process.memoryUsage();

const stats = sceneStats(scene);
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const mib = (n) => `${(n / 1048576).toFixed(2)} MiB`;
const perKind = Object.entries(stats.groups).map(([kind, part]) => `${kind} ${compact(part.triangles)} tris / ${mib(part.bytes)}`);
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const { functionName, url, lineNumber } = byId.get(id).callFrame;
  const key = `${functionName || "(anon)"} ${url.split("/").slice(-2).join("/")}:${lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt[i] / 1000);
});
console.log(`${file.id} (route-only, ${biome}, scenery ${sceneryLevel}): build ${(ms / 1000).toFixed(2)} s, heap +${((rss.heapUsed - heap0) / 1e6).toFixed(0)} MB, rss ${(rss.rss / 1e6).toFixed(0)} MB, peak ${(process.resourceUsage().maxRSS / 1e3).toFixed(0)} MB, ${compact(stats.total.triangles)} mesh triangles, ${mib(stats.total.bytes)} mesh upload`);
console.log(`per group: ${perKind.join(", ")}`);
console.log(`weather: ${compact(stats.weather.vertices)} vertices / ${mib(stats.weather.bytes)}`);
for (const [key, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(t / 1000).toFixed(2).padStart(7)} s  ${key}`);
process.exit(0);
