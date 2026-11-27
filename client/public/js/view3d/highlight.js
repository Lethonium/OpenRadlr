/**
 * The picked route in the start menu: a glowing band on top of its road,
 * coloured where it climbs or sprints, and a beacon at the start. Other
 * routes of the map get a faint band. Plain band data (triangles and tints), so the
 * pick can change without rebuilding the world.
 */
import { add, cross, scale, sub } from "./math.js";
import { roadFrame } from "../world/roads.js";

const UP = [0, 1, 0];

export const HIGHLIGHT = Object.freeze({
  route: [1.0, 0.5, 0.12],
  climb: [1.0, 0.3, 0.26],
  sprint: [0.3, 0.76, 1.0],
  other: [0.86, 0.9, 0.95],
  beacon: [1.0, 0.82, 0.2],
});

/**
 * How high the bands lie over the road (m). Routes of a map share roads: a band
 * on top of another at the same height flickers between the two (z-fighting), so
 * the picked route lies clearly over the faint bands of the others.
 */
export const HIGHLIGHT_LIFT = Object.freeze({ picked: 0.6, other: 0.3 });

/** Band colour at `distance`: climbs and sprints from the route's markers, else the route colour. */
export function highlightColor(route, distance, colors = HIGHLIGHT) {
  for (const marker of route.markers ?? []) {
    if (marker.type !== "climb" && marker.type !== "sprint") continue;
    const length = marker.length ?? 200;
    const into = route.wrap(distance - marker.distance);
    if (into >= 0 && into <= length) return marker.type === "climb" ? colors.climb : colors.sprint;
  }
  return colors.route;
}

/** Pushes the triangle a-b-c, wound so that its front faces along `direction`, with one tint on all three corners. */
function triangleFacing(band, a, b, c, tint, direction) {
  const n = cross(sub(b, a), sub(c, a));
  const flip = n[0] * direction[0] + n[1] * direction[1] + n[2] * direction[2] < 0;
  for (const p of flip ? [a, c, b] : [a, b, c]) band.positions.push(...p), band.colors.push(...tint);
}

/** An axis-aligned box of `size` round `center`, faces out. */
function box(band, center, [sx, sy, sz], tint) {
  const corner = (i, j, k) => [center[0] + (i * sx) / 2, center[1] + (j * sy) / 2, center[2] + (k * sz) / 2];
  const faces = [
    [[1, 0, 0], (u, v) => corner(1, u, v)],
    [[-1, 0, 0], (u, v) => corner(-1, u, v)],
    [[0, 1, 0], (u, v) => corner(u, 1, v)],
    [[0, -1, 0], (u, v) => corner(u, -1, v)],
    [[0, 0, 1], (u, v) => corner(u, v, 1)],
    [[0, 0, -1], (u, v) => corner(u, v, -1)],
  ];
  for (const [normal, at] of faces) {
    const [a, b, c, d] = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    triangleFacing(band, a, b, c, tint, normal);
    triangleFacing(band, a, c, d, tint, normal);
  }
}

/**
 * Band along `route`: `width` metres wide, `lift` above the road. With
 * `color` the whole band has that colour (other routes, lower); otherwise it
 * shows the markers and a beacon stands at the start.
 * @returns {{positions: Float32Array, colors: Float32Array}} non-indexed triangles, xyz and rgb (0-1) per vertex
 */
export function buildHighlight(route, { width = 12, lift = null, step = 8, color = null, beacon = 60 } = {}) {
  lift ??= color ? HIGHLIGHT_LIFT.other : HIGHLIGHT_LIFT.picked;
  const band = { positions: [], colors: [] };
  const half = width / 2;
  const edge = (frame, side) => add(add(frame.center, scale(frame.right, side * half)), [0, lift, 0]);
  const steps = Math.ceil(route.length / step);
  let f0 = roadFrame(route, 0);
  for (let i = 0; i < steps; i += 1) {
    const f1 = roadFrame(route, Math.min(route.length, (i + 1) * step));
    const tint = color ?? highlightColor(route, (i + 0.5) * step);
    const [a, b, c, d] = [edge(f0, -1), edge(f1, -1), edge(f1, 1), edge(f0, 1)];
    triangleFacing(band, a, b, c, tint, UP);
    triangleFacing(band, a, c, d, tint, UP);
    f0 = f1;
  }
  if (!color && beacon > 0) {
    const start = roadFrame(route, 0).center;
    box(band, add(start, [0, beacon / 2, 0]), [3, beacon, 3], HIGHLIGHT.beacon);
    box(band, add(start, [0, beacon, 0]), [7, 7, 7], HIGHLIGHT.beacon);
  }
  return { positions: new Float32Array(band.positions), colors: new Float32Array(band.colors) };
}
