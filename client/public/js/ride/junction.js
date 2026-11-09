/**
 * Junctions on the road network (#15): which roads a rider can take where
 * their road ends, which way each one turns and where it leads, and the
 * road a rider rides when they left every route.
 *
 * Works on a RoadNetwork (route/network.js) and the `road` of a rider's
 * state (`edge`, `dir`, `offset`, `next`). Mirrors the server's rules:
 * every road leaving the place except turning back.
 */
import { RouteGeometry } from "../route/geometry.js";
import { NETWORK_LANES } from "../route/network.js";
import { t } from "../i18n/i18n.js";

/** The options show this far before a junction. */
export const JUNCTION_WINDOW_M = 250;
/** Metres a heading is measured over (as on the server). */
const REACH = 40;
/** Turns smaller than this (radians) are straight on. */
const STRAIGHT = 0.35;

/** Id of the off-route road a rider rides (see `offRouteRoad`). */
export const OFF_ROUTE_ID = "off-route";

/** The place a road leads to in riding direction. */
export function exitPlace(network, edge, dir) {
  const road = network.edges.get(edge)?.edge;
  if (!road) return null;
  return dir > 0 ? road.to : road.from;
}

/** Roads leaving the end of `[edge, dir]`, without turning back. */
export function onwardRoads(network, edge, dir) {
  const place = exitPlace(network, edge, dir);
  if (!place) return [];
  const out = [];
  for (const road of network.roads()) {
    if (road.edge.from === place) out.push([road.edge.id, 1]);
    if (road.edge.to === place) out.push([road.edge.id, -1]);
  }
  return out.filter(([e, d]) => !(e === edge && d === -dir));
}

function heading(network, edge, dir, offset, reach) {
  const road = network.edges.get(edge);
  const at = (d) => road.positionAt(dir > 0 ? d : road.length - d);
  const a = at(offset);
  const b = at(offset + reach);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** How far a rider turns from the end of `from` onto `onto` (radians, + is left). */
export function turnAngle(network, [fromEdge, fromDir], [ontoEdge, ontoDir]) {
  const length = network.edges.get(fromEdge).length;
  const reach = Math.min(REACH, length / 2);
  const arriving = heading(network, fromEdge, fromDir, length - reach, reach);
  const leaving = heading(network, ontoEdge, ontoDir, 0, Math.min(REACH, network.edges.get(ontoEdge).length / 2));
  const turn = leaving - arriving;
  return Math.atan2(Math.sin(turn), Math.cos(turn));
}

/** "left", "straight" or "right" for a turn angle. */
export function turnSide(angle) {
  if (angle > STRAIGHT) return "left";
  if (angle < -STRAIGHT) return "right";
  return "straight";
}

/** The routes whose walk rides `[edge, dir]`. */
export function routesOn(network, edge, dir) {
  return network.routes.filter((route) => route.walk.some(([e, d]) => e === edge && d === dir));
}

/**
 * The junction ahead of a rider at `road`, once within `window` metres:
 * the place, the metres to it and the options from left to right, each with
 * the route it continues (mine first, else the first one riding it that way;
 * `null`: off-route) and whether it's the planned one. Null on the open road
 * or where there's only one way on.
 */
export function junctionAhead(network, road, { routeId = null, window = JUNCTION_WINDOW_M } = {}) {
  const geometry = road && network?.edges.get(road.edge);
  if (!geometry) return null;
  const toGo = geometry.length - road.offset;
  if (toGo > window) return null;
  const onward = onwardRoads(network, road.edge, road.dir);
  if (onward.length < 2) return null;
  const planned = road.next ? `${road.next.edge}:${road.next.dir}` : null;
  const options = onward
    .map(([edge, dir]) => {
      const routes = routesOn(network, edge, dir);
      const route = routes.find((r) => r.id === routeId) ?? routes[0] ?? null;
      const angle = turnAngle(network, [road.edge, road.dir], [edge, dir]);
      const towards = network.nodes.get(exitPlace(network, edge, dir));
      return { edge, dir, angle, side: turnSide(angle), route, towards: towards?.name ?? null, planned: `${edge}:${dir}` === planned };
    })
    .sort((a, b) => b.angle - a.angle);
  return { place: network.nodes.get(exitPlace(network, road.edge, road.dir)), toGo, options };
}

/** The option `step` places left (−1) or right (+1) of the planned one, clamped. */
export function stepOption(junction, step) {
  const at = Math.max(0, junction.options.findIndex((o) => o.planned));
  return junction.options[Math.min(junction.options.length - 1, Math.max(0, at + step))];
}

/** Corner radius where my own road turns from one road onto the next (as route files). */
const CORNER_RADIUS = 15;
const CORNER_MAX_TANGENT = 40;

const run2d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The point `d` metres from `from` towards `to` (with elevation). */
function towardsPoint(from, to, d) {
  const t = Math.min(1, d / Math.max(1e-9, run2d(from, to)));
  return [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * t);
}

/** The point `d` metres along `points` from its start (`back`: from its end). */
function alongPoints(points, d, back = false) {
  const p = back ? [...points].reverse() : points;
  let left = d;
  for (let i = 1; i < p.length; i += 1) {
    const run = run2d(p[i - 1], p[i]);
    if (run >= left) return { point: towardsPoint(p[i - 1], p[i], left), index: back ? p.length - 1 - i : i };
    left -= run;
  }
  return { point: p[p.length - 1], index: back ? 0 : p.length - 1 };
}

/**
 * My own road through the map's roads: off every route, or through a turn
 * away from my route (#15). One open geometry of `steps` in riding
 * direction (the road before, for the camera looking back, the current one
 * and the next), rounded on a short curve where one road turns onto the
 * next, with the markers each road has that way. `bases[i]` is where the
 * rider is at offset 0 of `steps[i]`, so `bases[i] + offset` places them.
 * @param {Array<[string, number]>} steps
 */
export function offRouteRoad(network, steps, id = OFF_ROUTE_ID) {
  const runs = steps.map(([edge, dir]) => {
    const run = network.edges.get(edge).nodes.map((n) => [n.x, n.y, n.elevation]);
    return dir < 0 ? run.reverse() : run;
  });
  const points = [];
  const bases = [];
  // Where the last arc ended on the current run (index of its next point), and that point.
  let from = 0;
  let resume = null;
  let shortcut = 0;
  let length = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const next = runs[i + 1];
    bases.push(length - shortcut);
    const start = resume ?? run[0];
    if (!next) {
      points.push(start, ...run.slice(from + 1));
      break;
    }
    // The corner at the joint: arriving along this run, leaving along the next.
    const joint = run[run.length - 1];
    const before = alongPoints(run, 1, true).point;
    const after = alongPoints(next, 1).point;
    const turn = Math.atan2(after[1] - joint[1], after[0] - joint[0]) - Math.atan2(joint[1] - before[1], joint[0] - before[0]);
    const angle = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
    const runLength = network.edges.get(steps[i][0]).length;
    const tangent = angle < 0.07 ? 0 : Math.min(CORNER_MAX_TANGENT, CORNER_RADIUS * Math.tan(angle / 2), runLength / 3, network.edges.get(steps[i + 1][0]).length / 3);
    if (tangent <= 0.5) {
      points.push(start, ...run.slice(from + 1, -1));
      resume = null;
      from = 0;
      length += runLength;
      continue;
    }
    const back = alongPoints(run, tangent, true);
    const ahead = alongPoints(next, tangent);
    points.push(start, ...run.slice(from + 1, back.index + 1), back.point);
    // A quadratic curve through the corner: smooth enough at these radii.
    const arc = [];
    for (let k = 1; k < 8; k += 1) {
      const t = k / 8;
      arc.push([0, 1, 2].map((c) => (1 - t) ** 2 * back.point[c] + 2 * (1 - t) * t * joint[c] + t * t * ahead.point[c]));
    }
    points.push(...arc);
    let curve = run2d(back.point, arc[0]) + run2d(arc[arc.length - 1], ahead.point);
    for (let k = 1; k < arc.length; k += 1) curve += run2d(arc[k - 1], arc[k]);
    // The next road's metres count from its start: the curve cut `2·tangent − curve` off.
    shortcut += 2 * tangent - curve;
    resume = ahead.point;
    from = ahead.index - 1;
    length += runLength;
  }
  const markers = [];
  steps.forEach(([edge, dir], i) => {
    for (const m of network.edges.get(edge).edge.markers) {
      if (m.dir === dir) markers.push({ type: m.type, distance: bases[i] + m.distance, length: m.length });
    }
  });
  const cleaned = points.filter((p, i) => i === 0 || run2d(points[i - 1], p) > 0.05);
  const geometry = new RouteGeometry({ id, name: t("ride.offRoute"), loop: false, lanes: NETWORK_LANES, seed: network.seed, points: cleaned, markers });
  return { geometry, bases };
}
