import { prepareCanvas } from "./canvas.js";
import { islandShape } from "../view3d/island.js";
import { roadNetworkOf } from "../route/worldMap.js";

/**
 * Top-down map of the routes on one map: the island, every road, the picked
 * route highlighted with its climbs and sprints, and the start. Shown in the
 * start menu while the 3D island is built, and instead of it on devices
 * without WebGL 2 or with low graphics. Pure mapping functions are exported
 * for tests.
 */

export const MAP_COLORS = Object.freeze({
  sea: "#163a4e",
  land: "#2d5b3b",
  sand: "#cdb98a",
  road: "rgba(232, 236, 241, 0.5)",
  accent: "#ff7a1a",
  climb: "#ff5d5d",
  sprint: "#4cc3ff",
  start: "#ffd21f",
});

/** Road samples like the 3D world's (world x/z, north is −z), for the island's shape. */
export function roadSamples(routes, step = 6) {
  const samples = [];
  for (const route of routes) {
    for (let d = 0; d < route.length; d += step) {
      const { x, y } = route.positionAt(d);
      samples.push({ x, z: -y });
    }
  }
  return samples;
}

/** The island of `routes` (same shape as in 3D), or null without routes. */
export function islandOf(routes) {
  if (!routes.length) return null;
  const first = routes[0];
  return islandShape(roadSamples(routes), (first.map?.seed ?? first.seed) >>> 0);
}

/** Coast as a closed polygon of [x, z] points. */
export function coastOutline(island, steps = 120) {
  return Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2;
    const r = island.radiusAt(angle);
    return [island.center[0] + Math.cos(angle) * r, island.center[1] + Math.sin(angle) * r];
  });
}

/** Fits world [x, z] points into a canvas, north up, keeping the aspect ratio. */
export function mapFrame(points, width, height, padding = 10) {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = Math.min((width - 2 * padding) / Math.max(1, maxX - minX), (height - 2 * padding) / Math.max(1, maxZ - minZ));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oz = (height - (maxZ - minZ) * scale) / 2;
  return { scale, toScreen: (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale] };
}

/** True where `route` climbs or sprints (from its markers). */
function markerAt(route, distance) {
  for (const marker of route.markers ?? []) {
    if (marker.type !== "climb" && marker.type !== "sprint") continue;
    const into = route.wrap(distance - marker.distance);
    if (into >= 0 && into <= (marker.length ?? 200)) return marker.type;
  }
  return null;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{routes: object[], selectedId: string | null, colors?: object, island?: object | null, network?: object | null}} options
 *   routes are RouteGeometry objects of one map; with the map's `network`
 *   file, the island and every road come from it
 */
export function drawMapPreview(canvas, { routes, selectedId, colors = MAP_COLORS, network = null, island }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = colors.sea;
  ctx.fillRect(0, 0, width, height);
  if (!routes.length) return;
  const roadNetwork = network ? roadNetworkOf(network) : null;
  island ??= roadNetwork ? roadNetwork.island() : islandOf(routes);
  if (roadNetwork) routes = [...roadNetwork.roads(), ...routes];

  const coast = island ? coastOutline(island) : [];
  const roads = routes.map((route) => roadSamples([route], 20).map((s) => [s.x, s.z]));
  const frame = mapFrame(coast.length ? coast : roads.flat(), width, height, 12);
  const path = (points, close = false) => {
    ctx.beginPath();
    points.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(...frame.toScreen(x, z)) : ctx.lineTo(...frame.toScreen(x, z))));
    if (close) ctx.closePath();
  };

  if (coast.length) {
    path(coast, true);
    ctx.fillStyle = colors.land;
    ctx.fill();
    ctx.strokeStyle = colors.sand;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  routes.forEach((route, i) => {
    if (route === selected) return;
    path(roads[i], route.loop !== false);
    ctx.strokeStyle = colors.road;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  if (selected) {
    const step = 20;
    for (let d = 0; d < selected.length; d += step) {
      const a = selected.positionAt(d);
      const b = selected.positionAt(Math.min(selected.length, d + step));
      const kind = markerAt(selected, d + step / 2);
      ctx.beginPath();
      ctx.moveTo(...frame.toScreen(a.x, -a.y));
      ctx.lineTo(...frame.toScreen(b.x, -b.y));
      ctx.strokeStyle = kind === "climb" ? colors.climb : kind === "sprint" ? colors.sprint : colors.accent;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    const start = selected.positionAt(0);
    const [sx, sy] = frame.toScreen(start.x, -start.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = colors.start;
    ctx.fill();
    ctx.strokeStyle = colors.sea;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
