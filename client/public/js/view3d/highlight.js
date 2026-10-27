/**
 * The picked route in the start menu: a glowing band on top of its road,
 * coloured where it climbs or sprints, and a beacon at the start. Other
 * routes of the map get a faint band. Separate small meshes, so the pick can
 * change without rebuilding the world.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { add, scale } from "./math.js";
import { roadFrame } from "./world.js";

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

/**
 * Band along `route`: `width` metres wide, `lift` above the road. With
 * `color` the whole band has that colour (other routes, lower); otherwise it
 * shows the markers and a beacon stands at the start.
 */
export function buildHighlight(route, { width = 12, lift = null, step = 8, color = null, beacon = 60 } = {}) {
  lift ??= color ? HIGHLIGHT_LIFT.other : HIGHLIGHT_LIFT.picked;
  const mesh = new MeshBuilder();
  const half = width / 2;
  const edge = (frame, side) => add(add(frame.center, scale(frame.right, side * half)), [0, lift, 0]);
  const steps = Math.ceil(route.length / step);
  let f0 = roadFrame(route, 0);
  for (let i = 0; i < steps; i += 1) {
    const f1 = roadFrame(route, Math.min(route.length, (i + 1) * step));
    const tint = color ?? highlightColor(route, (i + 0.5) * step);
    const [a, b, c, d] = [edge(f0, -1), edge(f1, -1), edge(f1, 1), edge(f0, 1)];
    mesh.triangleFacing(a, b, c, tint, UP);
    mesh.triangleFacing(a, c, d, tint, UP);
    f0 = f1;
  }
  if (!color && beacon > 0) {
    const start = roadFrame(route, 0).center;
    mesh.box(add(start, [0, beacon / 2, 0]), [3, beacon, 3], HIGHLIGHT.beacon);
    mesh.box(add(start, [0, beacon, 0]), [7, 7, 7], HIGHLIGHT.beacon);
  }
  return mesh.build();
}
