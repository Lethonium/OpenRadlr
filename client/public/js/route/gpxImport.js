/**
 * GPX → route file conversion. Pure functions with no Node or DOM APIs, so
 * the same code runs in the CLI (tools/gpx-route.mjs) and, later, in the
 * browser for uploaded files.
 *
 * Pipeline: parse → project to local metres → check the loop → resample to
 * even spacing → smooth elevation → clamp grades → detect climbs → simplify.
 * The profile is never scaled: length and climbing come out of the data and
 * are reported against any target, not forced onto it.
 */

import { GRADE_WINDOW_M } from "./geometry.js";

// Same sphere as geo.js, so the projection is the inverse of toLatLon.
const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
const LOOP_TOLERANCE_M = 200;
/** Grades are clamped a little below the 12 % limit to leave room for simplifying. */
const MAX_GRADE = 0.115;

/**
 * Track points of every <trk>/<trkseg>, in file order. Elevation missing on a
 * point is interpolated from its neighbours.
 * @param {string} text GPX document
 * @returns {{lat: number, lon: number, ele: number}[]}
 */
export function parseGpx(text) {
  const points = [];
  const trkpt = /<(?:[\w-]+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?trkpt\s*>)/g;
  for (const match of text.matchAll(trkpt)) {
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const raw = /<(?:[\w-]+:)?ele\s*>\s*([^<\s]+)\s*</.exec(match[2] ?? "")?.[1];
    const ele = raw === undefined ? NaN : Number(raw);
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : NaN });
  }
  if (points.length === 0) throw new Error("the GPX has no track points");
  fillMissingElevation(points);
  return points;
}

function fillMissingElevation(points) {
  const known = points.map((p, i) => (Number.isNaN(p.ele) ? -1 : i)).filter((i) => i >= 0);
  if (known.length === 0) throw new Error("the GPX has no elevation");
  for (let i = 0; i < points.length; i++) {
    if (!Number.isNaN(points[i].ele)) continue;
    const before = known.findLast((k) => k < i);
    const after = known.find((k) => k > i);
    if (before === undefined) points[i].ele = points[after].ele;
    else if (after === undefined) points[i].ele = points[before].ele;
    else points[i].ele = points[before].ele + ((points[after].ele - points[before].ele) * (i - before)) / (after - before);
  }
}

/**
 * Metres east/north of `origin` (default: the first point), the inverse of
 * geo.js `toLatLon`.
 * @returns {{x: number, y: number, elevation: number}[]}
 */
export function projectTrack(points, origin = points[0]) {
  return points.map((p) => {
    const y = (p.lat - origin.lat) * RAD * EARTH_RADIUS_M;
    const midLat = (p.lat + origin.lat) / 2;
    const x = (p.lon - origin.lon) * RAD * EARTH_RADIUS_M * Math.cos(midLat * RAD);
    return { x, y, elevation: p.ele };
  });
}

/** Cumulative horizontal distance per node. */
function distances(nodes) {
  const d = new Float64Array(nodes.length);
  for (let i = 1; i < nodes.length; i++) d[i] = d[i - 1] + Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
  return d;
}

/**
 * Even horizontal spacing; repeated points (a rider standing still) are
 * dropped first. Keeps the first and last node.
 */
export function resample(nodes, spacing = 10) {
  const moving = nodes.filter((n, i) => i === 0 || Math.hypot(n.x - nodes[i - 1].x, n.y - nodes[i - 1].y) > 1e-9);
  if (moving.length < 2) return moving.map((n) => ({ ...n }));
  const d = distances(moving);
  const total = d[d.length - 1];
  const out = [];
  let seg = 1;
  for (let at = 0; at < total; at += spacing) {
    while (d[seg] < at) seg++;
    out.push(lerpNode(moving[seg - 1], moving[seg], (at - d[seg - 1]) / (d[seg] - d[seg - 1])));
  }
  out.push({ ...moving[moving.length - 1] });
  return out;
}

function lerpNode(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, elevation: a.elevation + (b.elevation - a.elevation) * t };
}

/** Gaussian smoothing of elevation over distance (metres). */
export function smoothElevation(nodes, sigma = 60) {
  if (sigma <= 0 || nodes.length < 3) return nodes.map((n) => ({ ...n }));
  const d = distances(nodes);
  const reach = 3 * sigma;
  let lo = 0;
  let hi = 0;
  return nodes.map((node, i) => {
    while (d[lo] < d[i] - reach) lo++;
    while (hi + 1 < nodes.length && d[hi + 1] <= d[i] + reach) hi++;
    let sum = 0;
    let weights = 0;
    for (let j = lo; j <= hi; j++) {
      const w = Math.exp(-0.5 * ((d[j] - d[i]) / sigma) ** 2);
      sum += w * nodes[j].elevation;
      weights += w;
    }
    return { ...node, elevation: sum / weights };
  });
}

/** Steepest grade over `window` metres, and the node it starts at. */
function steepestGrade(nodes, window = GRADE_WINDOW_M) {
  const d = distances(nodes);
  let steepest = { grade: 0, index: 0 };
  let j = 0;
  for (let i = 0; i < nodes.length; i++) {
    while (j < nodes.length - 1 && d[j] - d[i] < window) j++;
    if (d[j] - d[i] < window * 0.5) break;
    const grade = (nodes[j].elevation - nodes[i].elevation) / (d[j] - d[i]);
    if (Math.abs(grade) > Math.abs(steepest.grade)) steepest = { grade, index: i };
  }
  return steepest;
}

/**
 * Brings every `window`-metre grade within ±max by spreading the offending
 * rise over a longer stretch (local diffusion of elevation), never by
 * scaling the whole profile.
 */
export function clampGrades(nodes, { max = 0.12, window = GRADE_WINDOW_M } = {}) {
  const out = nodes.map((n) => ({ ...n }));
  if (out.length < 3) return out;
  const d = distances(out);
  const pad = Math.max(1, Math.round(window / (d[d.length - 1] / (out.length - 1))));
  let e = Float64Array.from(out, (n) => n.elevation);
  let next = new Float64Array(e.length);
  const bad = new Uint8Array(e.length);
  for (let pass = 0; pass < 4000; pass++) {
    // Mark every node inside a window that is too steep.
    bad.fill(0);
    let any = false;
    let j = 0;
    for (let i = 0; i < e.length; i++) {
      while (j < e.length - 1 && d[j] - d[i] < window) j++;
      if (d[j] - d[i] < window * 0.5) break;
      if (Math.abs(e[j] - e[i]) / (d[j] - d[i]) > max) {
        any = true;
        for (let k = Math.max(0, i - pad); k <= Math.min(e.length - 1, j + pad); k++) bad[k] = 1;
      }
    }
    if (!any) break;
    // A few diffusion steps per scan keep long walls from needing thousands of scans.
    for (let step = 0; step < 8; step++) {
      next.set(e);
      for (let i = 1; i < e.length - 1; i++) if (bad[i]) next[i] = (e[i - 1] + 2 * e[i] + e[i + 1]) / 4;
      [e, next] = [next, e];
    }
  }
  e.forEach((value, i) => (out[i].elevation = value));
  return out;
}

/**
 * Sustained climbs: runs of ≥ minGrade, merged across dips shorter than
 * mergeGap, at least minLength long with minGain of rise.
 * @returns {{distance: number, length: number, gain: number}[]}
 */
export function detectClimbs(nodes, { minGrade = 0.03, minLength = 1000, minGain = 40, mergeGap = 300 } = {}) {
  const d = distances(nodes);
  const climbs = [];
  let start = -1;
  let last = -1;
  let j = 0;
  const close = (endIndex) => {
    if (start < 0) return;
    const length = d[endIndex] - d[start];
    const gain = nodes[endIndex].elevation - nodes[start].elevation;
    if (length >= minLength && gain >= minGain) climbs.push({ distance: d[start], length, gain });
    start = -1;
  };
  for (let i = 0; i < nodes.length; i++) {
    while (j < nodes.length - 1 && d[j] - d[i] < GRADE_WINDOW_M) j++;
    const span = d[j] - d[i];
    const grade = span > 0 ? (nodes[j].elevation - nodes[i].elevation) / span : 0;
    if (grade >= minGrade) {
      if (start < 0) start = i;
      last = j;
    } else if (start >= 0 && d[i] - d[last] > mergeGap) {
      close(last);
    }
  }
  close(last);
  return climbs;
}

/**
 * Douglas–Peucker in 3D with separate tolerances: a point stays when it is
 * more than `horizontal` metres off the line or `vertical` metres off its
 * profile.
 */
export function simplify(nodes, { horizontal = 0.5, vertical = 0.3 } = {}) {
  if (nodes.length < 3) return nodes.map((n) => ({ ...n }));
  const keep = new Uint8Array(nodes.length);
  keep[0] = keep[nodes.length - 1] = 1;
  const stack = [[0, nodes.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = nodes[a];
    const B = nodes[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((nodes[i].x - A.x) * dx + (nodes[i].y - A.y) * dy) / len2)) : 0;
      const off = Math.hypot(nodes[i].x - (A.x + t * dx), nodes[i].y - (A.y + t * dy));
      const rise = Math.abs(nodes[i].elevation - (A.elevation + t * (B.elevation - A.elevation)));
      const error = Math.max(off / horizontal, rise / vertical);
      if (error > worst) {
        worst = error;
        at = i;
      }
    }
    if (worst > 1) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return nodes.filter((_, i) => keep[i]).map((n) => ({ ...n }));
}

function round(value, step) {
  return Math.round(value / step) * step;
}

/** Lap length including the closing segment, and total climbing. */
function measure(points) {
  let length = 0;
  let climb = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    length += Math.hypot(b.x - a.x, b.y - a.y);
    climb += Math.max(0, b.elevation - a.elevation);
  }
  return { length, climb };
}

/**
 * Converts a GPX track into a route file.
 * @param {string} text GPX document
 * @param {{id: string, name: string, description?: string, seed?: number, lanes?: number, geo?: {lat: number, lon: number}, markers?: object[], sigma?: number, targetLength?: number, targetClimb?: number}} options
 *   markers: {type, name?, distance? | lat?+lon?, length?}; lat/lon snap to the nearest route distance
 * @returns {{route: object, report: {length: number, climb: number, steepest: {grade: number, distance: number}, climbs: object[], lengthOff?: number, climbOff?: number}}}
 */
export function gpxToRoute(text, options) {
  const { id, name, description, seed = 1, lanes = 4, geo, markers = [], sigma = 60, targetLength, targetClimb } = options;
  const track = parseGpx(text);
  const projected = projectTrack(track);
  const end = projected[projected.length - 1];
  if (Math.hypot(end.x, end.y) > LOOP_TOLERANCE_M) throw new Error("the track does not end within 200 m of its start");

  // The lap is a closed loop: close it, resample, and smooth and clamp it circularly
  // (padded with the other end), so the finish line has no step or wall.
  const closed = resample([...projected, { ...projected[0] }], 10);
  closed.pop();
  const pad = Math.min(closed.length - 1, Math.ceil((4 * sigma) / 10) + 40);
  const padded = [...closed.slice(-pad), ...closed, ...closed.slice(0, pad)];
  const smoothed = clampGrades(smoothElevation(padded, sigma), { max: MAX_GRADE });
  const smooth = smoothed.slice(pad, pad + closed.length);
  const simple = simplify(smooth);
  const d = distances(smooth);
  const { length, climb } = measure(simple);

  const climbs = detectClimbs(smooth);
  const snap = (marker) => {
    if (marker.distance !== undefined) return marker.distance;
    const [p] = projectTrack([{ lat: marker.lat, lon: marker.lon, ele: 0 }], track[0]);
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < smooth.length; i++) {
      const gap = Math.hypot(smooth[i].x - p.x, smooth[i].y - p.y);
      if (gap < bestGap) [best, bestGap] = [d[i], gap];
    }
    return best;
  };
  const given = markers.map((m) => ({ ...m, distance: snap(m) }));
  const out = [{ type: "start_finish", distance: 0 }];
  for (const climbInfo of climbs) {
    const named = given.find((m) => m.type === "climb" && m.distance >= climbInfo.distance && m.distance <= climbInfo.distance + climbInfo.length);
    climbInfo.name = named?.name;
    out.push({ type: "climb", distance: round(climbInfo.distance, 1), length: round(climbInfo.length, 1), ...(named?.name ? { name: named.name } : {}) });
  }
  for (const m of given) {
    if (m.type === "sprint") out.push({ type: "sprint", distance: round(m.distance, 1), length: m.length ?? 300, ...(m.name ? { name: m.name } : {}) });
  }
  out.sort((a, b) => a.distance - b.distance);

  const steep = steepestGrade(simple);
  if (Math.abs(steep.grade) > MAX_GRADE + 0.01) throw new Error("the track is too steep to bring under 12 % grade");
  const simpleD = distances(simple);
  const report = {
    length,
    climb,
    steepest: { grade: steep.grade, distance: simpleD[steep.index] },
    climbs,
  };
  if (targetLength) report.lengthOff = (length - targetLength) / targetLength;
  if (targetClimb) report.climbOff = (climb - targetClimb) / targetClimb;

  const route = {
    id,
    name,
    ...(description ? { description } : {}),
    loop: true,
    lanes,
    seed,
    ...(geo ? { geo } : {}),
    points: simple.map((n) => [round(n.x, 0.1), round(n.y, 0.1), round(n.elevation, 0.1)].map((v) => Number(v.toFixed(1)))),
    markers: out,
  };
  return { route, report };
}
