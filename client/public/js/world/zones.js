/**
 * Scenery zones along a route: where the village is, where a river crosses
 * the road, where the road runs through forest.
 *
 * Route files may define them (see docs/routes.md); otherwise sensible
 * defaults are derived from the route and its seed. Either way the result is
 * deterministic, so every client builds the same world.
 */
import { seededRandom } from "./noise.js";

const KNOWN = new Set(["village", "river", "forest", "cliff"]);

/** Stretches the road must keep free of other features (start, climb, sprint). */
function reservedStretches(route) {
  const reserved = [{ from: -120, to: 160 }];
  for (const marker of route.markers) {
    if (marker.type === "climb" || marker.type === "sprint") {
      reserved.push({ from: marker.distance - 80, to: marker.distance + (marker.length ?? 200) + 80 });
    }
  }
  return reserved;
}

const overlaps = (a, b) => a.from < b.to && b.from < a.to;

function wrapped(route, from, to) {
  return [{ from, to }, { from: from - route.length, to: to - route.length }, { from: from + route.length, to: to + route.length }];
}

function isFree(route, stretch, taken) {
  return !taken.some((t) => wrapped(route, stretch.from, stretch.to).some((w) => overlaps(w, t)));
}

/** Mean absolute grade over a stretch: lower is flatter. */
function roughness(route, from, to) {
  let sum = 0;
  let n = 0;
  for (let d = from; d <= to; d += 20) {
    sum += Math.abs(route.gradeAt(d));
    n += 1;
  }
  return sum / Math.max(1, n);
}

/** Flattest free stretch of `length` metres among seeded candidates. */
function pickStretch(route, length, taken, random, candidates = 40) {
  let best = null;
  for (let i = 0; i < candidates; i += 1) {
    const from = random() * Math.max(1, route.length - length);
    const stretch = { from, to: from + length };
    if (!isFree(route, stretch, taken)) continue;
    const score = roughness(route, stretch.from, stretch.to);
    if (!best || score < best.score) best = { ...stretch, score };
  }
  return best && { from: best.from, to: best.to };
}

/**
 * @returns {{villages: {from: number, to: number}[], rivers: {at: number}[], forests: {from: number, to: number}[], cliffs: {from: number, to: number}[]}}
 */
export function resolveZones(route) {
  const zones = { villages: [], rivers: [], forests: [], cliffs: [] };
  const valid = (route.zones ?? []).filter((z) => z && KNOWN.has(z.type));
  const clampRange = (z) => {
    const from = Math.max(0, Math.min(route.length, Number(z.from)));
    const to = Math.max(0, Math.min(route.length, Number(z.to)));
    return Number.isFinite(from) && Number.isFinite(to) && to - from >= 50 ? { from, to } : null;
  };

  // A road of a network carries exactly its zones, even none.
  if (valid.length > 0 || route.explicitZones) {
    for (const zone of valid) {
      if (zone.type === "river") {
        const at = Number(zone.at);
        if (Number.isFinite(at) && at >= 0 && at < route.length) zones.rivers.push({ at });
      } else {
        const range = clampRange(zone);
        if (range) zones[{ village: "villages", forest: "forests", cliff: "cliffs" }[zone.type]].push(range);
      }
    }
    return zones;
  }

  // Defaults: one village, one river crossing and one forest, if they fit.
  const random = seededRandom((route.seed >>> 0) ^ 0x2015);
  const taken = reservedStretches(route);
  if (route.length >= 1500) {
    const village = pickStretch(route, Math.min(480, route.length * 0.12), taken, random);
    if (village) {
      zones.villages.push(village);
      taken.push({ from: village.from - 150, to: village.to + 150 });
    }
  }
  if (route.length >= 1200) {
    const crossing = pickStretch(route, 120, taken, random);
    if (crossing) {
      zones.rivers.push({ at: (crossing.from + crossing.to) / 2 });
      taken.push({ from: crossing.from - 100, to: crossing.to + 100 });
    }
  }
  const forest = pickStretch(route, Math.min(700, route.length * 0.15), taken.slice(0, 1), random, 12);
  if (forest) zones.forests.push(forest);
  return zones;
}

/** True if `distance` lies in any of the stretches (loop-aware). */
export function inStretch(route, stretches, distance, margin = 0) {
  const d = route.wrap(distance);
  return stretches.some((s) => wrapped(route, s.from - margin, s.to + margin).some((w) => d >= w.from && d <= w.to));
}
