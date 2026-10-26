#!/usr/bin/env node
/**
 * Builds a route's 3D scene in Node and reports time, memory and the costliest
 * functions (sampling profiler), to find what keeps long routes from building
 * fast (#42).
 *
 *   node tools/scene-bench.mjs routes/lanzarote-lava-180.json [--top 14]
 */
import { readFileSync } from "node:fs";
import { Session } from "node:inspector";
import { buildSceneNow } from "../client/public/js/view3d/worldScene.js";

const args = process.argv.slice(2);
const file = JSON.parse(readFileSync(args[0], "utf8"));
const top = Number(args[args.indexOf("--top") + 1]) || 14;

const session = new Session();
session.connect();
const post = (method, params) => new Promise((resolve, reject) => session.post(method, params, (e, r) => (e ? reject(e) : resolve(r))));
await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 1000 });

globalThis.gc?.();
const heap0 = process.memoryUsage().heapUsed;
await post("Profiler.start");
const t0 = performance.now();
const scene = buildSceneNow(file);
const ms = performance.now() - t0;
const { profile } = await post("Profiler.stop");
const rss = process.memoryUsage();

let triangles = 0;
const perKind = [];
for (const [kind, part] of Object.entries(scene.chunks)) {
  let count = 0;
  for (const chunk of part) count += (chunk.mesh.positions?.length ?? 0) / 9;
  perKind.push(`${kind} ${Math.round(count / 1000)}k`);
  triangles += count;
}
for (const [kind, mesh] of Object.entries(scene.meshes)) perKind.push(`${kind} ${Math.round((mesh.positions?.length ?? 0) / 9000)}k`);
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const { functionName, url, lineNumber } = byId.get(id).callFrame;
  const key = `${functionName || "(anon)"} ${url.split("/").slice(-2).join("/")}:${lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt[i] / 1000);
});
console.log(`${file.id}: build ${(ms / 1000).toFixed(2)} s, heap +${((rss.heapUsed - heap0) / 1e6).toFixed(0)} MB, rss ${(rss.rss / 1e6).toFixed(0)} MB, peak ${(process.resourceUsage().maxRSS / 1e3).toFixed(0)} MB, ~${Math.round(triangles)} chunk triangles`);
console.log(`triangles: ${perKind.join(", ")}`);
for (const [key, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(t / 1000).toFixed(2).padStart(7)} s  ${key}`);
process.exit(0);
