/**
 * The towns' streets as road strips, pure: asphalt for every street the road network does not already draw,
 * pavements on both sides of every street (the main street included, outside its road and verge), the square
 * as a paved quad grid and the farms' gravel drives. Same `Strips` format as `roadStrips`, so the road layer
 * draws them with the road.
 */
import { VERGE, roadHalfWidth } from "../roads.js";
import { ROAD_KIND, TILE } from "./roadStrips.js";
import { createStrips } from "./strips.js";

/** Heights above the ground of the kerb and the square over the street surface, metres. */
const KERB = 0.02;
/** A farm drive's width, metres. */
const DRIVE_WIDTH = 3.6;

const tile = (along, across) => [along / TILE, across / TILE];

/** Points every `step` metres along a polyline `[x, z]`, with the distance of each. */
function resample(points, step) {
  const out = [{ p: points[0], d: 0 }];
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [a, b] = [points[i], points[i + 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= parts; k += 1) {
      const t = k / parts;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: travelled + length * t });
    }
    travelled += length;
  }
  return out;
}

/** Distance from `[x, z]` to a polyline. */
function distanceTo(points, [x, z]) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, az] = points[i];
    const [dx, dz] = [points[i + 1][0] - ax, points[i + 1][1] - az];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Half the width the road network already draws at a street, or half its own width. */
const roadHalf = (street) => (street.existing ? roadHalfWidth(street.route?.lanes ?? 4) : street.width / 2);

/**
 * A strip along a polyline from offset `o0` to `o1` (across, positive to the left of travel), one quad per
 * sample, left out where `skip(middle, corners)` says the quad lies on somewhere else's surface.
 */
function ribbon(strips, points, { o0, o1, kind, y, step, skip = () => false }) {
  const samples = resample(points, step);
  const frames = samples.map(({ p }, i) => {
    const [a, b] = [samples[Math.max(0, i - 1)].p, samples[Math.min(samples.length - 1, i + 1)].p];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { p, side: [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] };
  });
  const at = (f, o) => {
    const [x, z] = [f.p[0] + f.side[0] * o, f.p[1] + f.side[1] * o];
    return [x, y(x, z), z];
  };
  for (let i = 0; i + 1 < samples.length; i += 1) {
    const [f0, f1] = [frames[i], frames[i + 1]];
    const corners = [at(f0, o0), at(f0, o1), at(f1, o1), at(f1, o0)];
    const middle = [0, 2].map((a) => corners.reduce((sum, c) => sum + c[a], 0) / 4);
    if (skip([middle[0], middle[1]], corners)) continue;
    const [d0, d1] = [samples[i].d, samples[i + 1].d];
    strips.quad(corners, { kind, uv: [tile(d0, o0), tile(d0, o1), tile(d1, o1), tile(d1, o0)] });
  }
}

/**
 * The quads of every town's streets, squares and pavements, and of farm drives.
 * @param {{streets: object[], square: object|null, center: number[], frame: {u: number[], v: number[]}, pavement: number}[]} settlements `planWorld(...).settlements`
 * @param {{height: (x: number, z: number) => number}} terrain
 * @param {{step?: number, lift?: number, farms?: {drive: Float32Array}[]}} [options] `lift` is the surface's height above the ground
 * @returns {import("./strips.js").Strips}
 */
export function streetStrips(settlements, terrain, { step = 2, lift = 0.06, farms = [] } = {}) {
  const strips = createStrips();
  const surface = (extra) => (x, z) => terrain.height(x, z) + lift + extra;
  for (const settlement of settlements) {
    const drawn = settlement.streets.filter((s) => s.draw !== false);
    for (const street of drawn) {
      const others = drawn.filter((o) => o !== street);
      const onOther = (m, margin) => others.some((o) => distanceTo(o.points, m) < roadHalf(o) + (o.existing ? VERGE : 0) + margin);
      const touchesOther = (_, corners) => corners.some((c) => onOther([c[0], c[2]], 0.1));
      const half = street.width / 2;
      if (!street.existing) {
        // Asphalt stays off the main road, whose own strips are drawn already.
        ribbon(strips, street.points, { o0: -half, o1: half, kind: ROAD_KIND.asphalt, y: surface(0), step, skip: (m) => others.some((o) => o.existing && distanceTo(o.points, m) < roadHalf(o)) });
      }
      // The main street's pavement starts outside its road and verge.
      const inner = street.existing ? Math.max(half, roadHalfWidth(street.route?.lanes ?? 4) + VERGE) : half;
      const wide = street.pavement ?? settlement.pavement;
      for (const side of [-1, 1]) {
        const [o0, o1] = [side * inner, side * (inner + wide)];
        // No kerb across another street's asphalt.
        ribbon(strips, street.points, { o0: Math.min(o0, o1), o1: Math.max(o0, o1), kind: ROAD_KIND.pavement, y: surface(KERB), step, skip: touchesOther });
      }
    }
    if (settlement.square) paveSquare(strips, settlement, surface(KERB * 1.5), step);
  }
  for (const farm of farms) {
    const points = [];
    for (let i = 0; i + 1 < farm.drive.length; i += 2) points.push([farm.drive[i], farm.drive[i + 1]]);
    if (points.length >= 2) ribbon(strips, points, { o0: -DRIVE_WIDTH / 2, o1: DRIVE_WIDTH / 2, kind: ROAD_KIND.verge, y: surface(0), step });
  }
  return strips.build();
}

/** The square as a grid of quads in the settlement's local frame (`a` along the main road, `b` across). */
function paveSquare(strips, { square, center, frame }, y, step) {
  const world = (a, b) => {
    const x = center[0] + frame.u[0] * a + frame.v[0] * b;
    const z = center[1] + frame.u[1] * a + frame.v[1] * b;
    return [x, y(x, z), z];
  };
  const cells = (from, to) => Math.max(1, Math.ceil((to - from) / (step * 2)));
  const [na, nb] = [cells(square.a0, square.a1), cells(square.b0, square.b1)];
  const point = (i, j) => [square.a0 + ((square.a1 - square.a0) * i) / na, square.b0 + ((square.b1 - square.b0) * j) / nb];
  for (let i = 0; i < na; i += 1) {
    for (let j = 0; j < nb; j += 1) {
      const corners = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      strips.quad(corners.map(([a, b]) => world(a, b)), { kind: ROAD_KIND.pavement, uv: corners.map(([a, b]) => tile(a, b)) });
    }
  }
}
