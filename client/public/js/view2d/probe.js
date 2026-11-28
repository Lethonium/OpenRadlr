/**
 * The sprite probe page: bakes the full 2D sprite set (side and top, the night bakes, six rider looks) and prints
 * how long it took and how much memory the sprites take, as text to copy from a real device.
 */
import { SEASONS } from "../world/seasons.js";
import { createSpriteBaker } from "./sprites/baker.js";
import { riderJob, spriteJobs } from "./sprites/catalog.js";

/** Rider jerseys the probe bakes. */
const RIDER_COLORS = Object.freeze(["#e8473f", "#2f5f9e", "#f2c230", "#3f9e5f", "#8e44ad", "#222222"]);
const SLOWEST = 5;

/** The jobs the probe bakes, in order. */
export function probeJobs() {
  const jobs = [];
  for (const view of ["side", "top"]) {
    jobs.push(...spriteJobs({ view }), ...spriteJobs({ view, night: true }));
    for (const primary of RIDER_COLORS) jobs.push(riderJob({ primary }, view));
  }
  return jobs;
}

/**
 * Bakes `jobs` and measures them. With a baker that steps (`start`), also the longest single step: the 2D views
 * bake a step at a time between frames, so that is the longest a ride can stall for a sprite.
 * @returns {{count: number, ms: number, megabytes: number, slowest: {key: string, ms: number}[], worstStep: {key: string, ms: number} | null, errors: string[]}}
 */
export function runProbe(baker, jobs, now = () => performance.now()) {
  const timings = [];
  const errors = [];
  let bytes = 0;
  let worstStep = null;
  const bake = (job) => {
    if (!baker.start) return baker.bake(job);
    const task = baker.start(job);
    for (;;) {
      const t0 = now();
      const sprite = task.step();
      const ms = now() - t0;
      if (!worstStep || ms > worstStep.ms) worstStep = { key: job.key, ms };
      if (sprite) return sprite;
    }
  };
  const start = now();
  for (const job of jobs) {
    const t0 = now();
    try {
      bytes += bake(job).bytes;
      timings.push({ key: job.key, ms: now() - t0 });
    } catch (error) {
      errors.push(`${job.key}: ${error.message}`);
    }
  }
  const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST);
  return { count: timings.length, ms: now() - start, megabytes: bytes / 1024 / 1024, slowest, worstStep, errors };
}

/** The result as the text the owner copies. */
export function describeProbe(result, season, userAgent) {
  const lines = [
    `season: ${season}`,
    `sprites: ${result.count} (${result.errors.length} failed)`,
    `total: ${result.ms.toFixed(0)} ms, ${(result.ms / Math.max(1, result.count)).toFixed(1)} ms per sprite`, // i18n-ok: developer page
    `memory: ${result.megabytes.toFixed(1)} MB`,
    ...(result.worstStep ? [`longest step: ${result.worstStep.ms.toFixed(0)} ms  ${result.worstStep.key}`] : []), // i18n-ok: developer page
    "slowest:",
    ...result.slowest.map((entry) => `  ${entry.ms.toFixed(0)} ms  ${entry.key}`),
    ...result.errors.map((line) => `error: ${line}`),
    `userAgent: ${userAgent}`,
  ];
  return lines.join("\n");
}

if (typeof document !== "undefined") {
  const out = document.getElementById("out");
  const asked = new URLSearchParams(location.search).get("season");
  const season = SEASONS.includes(asked) ? asked : "summer";
  // Let the "Baking…" text paint first.
  setTimeout(() => {
    try {
      const baker = createSpriteBaker({ season });
      const result = runProbe(baker, probeJobs());
      baker.dispose();
      out.textContent = describeProbe(result, season, navigator.userAgent);
    } catch (error) {
      out.textContent = `failed: ${error.message}\nuserAgent: ${navigator.userAgent}`;
    }
  }, 50);
}
