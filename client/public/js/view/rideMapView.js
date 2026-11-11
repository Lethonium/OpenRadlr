/**
 * The ride's 2D view: a top-down map of the road around the rider.
 *
 * The rider sits mid-screen heading up, so roughly half the map is the road
 * ahead. The map draws the island (when the road network is known), every
 * road once, the road being ridden with its lane markings, the golden lemons
 * still on the road, the draft gap ahead of me when I am drafting, and the
 * riders around me — including my best lap's ghost. It uses the same
 * route/rider data as the 3D view, so a device without WebGL 2 can still
 * follow the ride.
 */
import { soloRiders, vehicleMarkers } from "../ride/vehicle.js";
import { t } from "../i18n/i18n.js";
import { LANE_WIDTH, SHOULDER } from "../view3d/world.js";
import { prepareCanvas, riderColor } from "./canvas.js";
import { coastOutline } from "./mapPreview.js";
import { riderLabel } from "./remoteRiders.js";
import { drawDecorations, roadDecorations } from "./rideMapDecor.js";
import { rideMapTheme } from "./rideMapTheme.js";

/** How much road the canvas height shows, and where on it the rider sits.
 *  The rider sits mid-screen: in the cockpit layout the paddle meter overlays
 *  the lower third, and the arrow must stay clear of its hint card. */
export const MAP_VIEW = Object.freeze({ spanM: 120, riderY: 0.5 });

/** Width of the 3D road's edge stripe (metres). */
const EDGE_LINE = 0.12;

/** Offset of a lane centre from the road's centre line; lane 0 is the leftmost. */
export function laneOffset(lane, lanes) {
  return (lane - (lanes - 1) / 2) * LANE_WIDTH;
}

/** World point (x, y) of a lane at `distance`. */
export function roadPointAt(route, distance, lane) {
  const point = route.positionAt(distance);
  if (lane === null || lane === undefined) return point;
  // The road's direction at this point; the normal is the right-hand side of travel.
  const before = route.positionAt(distance - 2);
  const after = route.positionAt(distance + 2);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return point;
  const offset = laneOffset(lane, route.lanes);
  return { x: point.x + (dy / length) * offset, y: point.y - (dx / length) * offset };
}

/**
 * A heading-up camera: travel points up the screen, the rider sits `riderY` of
 * the height down, and the world is scaled so the canvas height spans `spanM`.
 * @returns {{ center: object, angle: number, scale: number, rider: {x: number, y: number}, toScreen: (point: object) => {x: number, y: number}, fromScreen: (point: object) => {x: number, y: number} }}
 */
export function mapCamera(route, me, width, height, { spanM = MAP_VIEW.spanM, riderY = MAP_VIEW.riderY } = {}) {
  const center = roadPointAt(route, me.distance, me.lane);
  const before = route.positionAt(me.distance - 2);
  const after = route.positionAt(me.distance + 2);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  // Screen y points down and north is +y in world space: turn east into "up".
  const angle = Math.hypot(dx, dy) > 1e-9 ? Math.atan2(dx, dy) : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scale = Math.max(2.5, height / Math.max(1, spanM));
  const rx = width / 2;
  const ry = height * riderY;
  const toScreen = ({ x, y }) => {
    const sx = (x - center.x) * scale;
    const sy = -(y - center.y) * scale;
    return { x: rx + sx * cos + sy * sin, y: ry - sx * sin + sy * cos };
  };
  const fromScreen = ({ x, y }) => {
    const dx = x - rx;
    const dy = y - ry;
    const sx = dx * cos - dy * sin;
    const sy = dx * sin + dy * cos;
    return { x: center.x + sx / scale, y: center.y - sy / scale };
  };
  return { center, angle, scale, rider: { x: rx, y: ry }, toScreen, fromScreen };
}

/** The route's centre line moved `metres` to the right of travel. */
export function offsetNodes(route, metres) {
  const nodes = route.nodes;
  const count = route.loop ? nodes.length - 1 : nodes.length;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const before = nodes[route.loop ? (i - 1 + count) % count : Math.max(0, i - 1)];
    const after = nodes[route.loop ? (i + 1) % count : Math.min(count - 1, i + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    const node = nodes[i];
    if (length < 1e-9) out.push({ x: node.x, y: node.y });
    else out.push({ x: node.x + (dy / length) * metres, y: node.y - (dx / length) * metres });
  }
  if (route.loop && out.length) out.push({ x: out[0].x, y: out[0].y });
  return out;
}

/** A route's offset lines never change: compute each offset once, reuse per frame. */
const offsetCache = new WeakMap();

/** `offsetNodes` through the per-route cache; drawMarkings uses this each frame. */
export function cachedOffsetNodes(route, metres) {
  let perRoute = offsetCache.get(route);
  if (!perRoute) {
    perRoute = new Map();
    offsetCache.set(route, perRoute);
  }
  let nodes = perRoute.get(metres);
  if (!nodes) {
    nodes = offsetNodes(route, metres);
    perRoute.set(metres, nodes);
  }
  return nodes;
}

/** One mark per solo rider and per vehicle, labelled as in the rest of the HUD. */
export function mapRiderMarks(riders, myId) {
  const solo = soloRiders(riders).map((rider) => ({
    rider,
    label: riderLabel(rider, t),
    big: false,
    mine: rider.id === myId,
  }));
  const vehicles = vehicleMarkers(riders, myId).map((marker) => ({ rider: marker.rider, label: marker.label, big: true, mine: marker.mine }));
  return [...solo, ...vehicles];
}

const coastCache = new WeakMap();

/** The network's coast, as world [x, z] points, computed once per map. */
function coastOf(network) {
  let coast = coastCache.get(network);
  if (!coast) {
    coast = coastOutline(network.island(), 240);
    coastCache.set(network, coast);
  }
  return coast;
}

const roadWidth = (route) => route.lanes * LANE_WIDTH + 2 * SHOULDER;

function strokePath(ctx, camera, points, { color, width, dash = null }) {
  if (!points?.length) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = camera.toScreen(point);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}

function drawGround(ctx, { network, width, height, theme }) {
  if (!network) {
    ctx.fillStyle = theme.land;
    ctx.fillRect(0, 0, width, height);
    return null;
  }
  ctx.fillStyle = theme.sea;
  ctx.fillRect(0, 0, width, height);
  return coastOf(network);
}

function landPath(ctx, camera, coast) {
  ctx.beginPath();
  coast.forEach(([x, z], index) => {
    // The map's world y is -z (the same convention as the start menu's map).
    const screen = camera.toScreen({ x, y: -z });
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

const heightRangeCache = new WeakMap();

/** The network's lowest and highest terrain, in metres. */
function heightRange(network) {
  let range = heightRangeCache.get(network);
  if (!range) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of network.heights) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const scale = network.grid.scale;
    range = { min: min * scale, max: max * scale };
    heightRangeCache.set(network, range);
  }
  return range;
}

/** Brightness for a terrain cell: a hill facing north-west is lighter, higher ground slightly warmer. */
function terrainShade(network, x, y, range) {
  const step = 6;
  const dx = network.heightAt(x + step, y) - network.heightAt(x - step, y);
  const dy = network.heightAt(x, y + step) - network.heightAt(x, y - step);
  const slope = Math.max(-1, Math.min(1, (dx - dy) * 0.8));
  const high = (network.heightAt(x, y) - range.min) / Math.max(1, range.max - range.min);
  return Math.max(0.68, Math.min(1.3, 1 + slope * 0.42 + (high - 0.5) * 0.24));
}

function shadeColor(color, factor) {
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
  const [r, g, b] = channels
    ? channels.slice(1).map(Number)
    : (() => {
        const value = Number.parseInt(color.slice(1), 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
      })();
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value * factor)));
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

let terrainSurface = null;

/** Sparse terrain relief, sampled in world space on screen-space cells and smoothed up. */
function drawTerrain(ctx, { canvas, network, camera, width, height, theme }) {
  const range = heightRange(network);
  const cell = Math.max(24, Math.floor(Math.min(width, height) / 30));
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const doc = canvas.ownerDocument;
  if (!doc) {
    // Unit tests draw into a fake canvas without a document: keep the cells.
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const world = camera.fromScreen({ x: column * cell + cell / 2, y: row * cell + cell / 2 });
        ctx.fillStyle = shadeColor(theme.land, terrainShade(network, world.x, world.y, range));
        ctx.fillRect(column * cell, row * cell, cell + 1, cell + 1);
      }
    }
    return;
  }
  terrainSurface ??= doc.createElement("canvas");
  if (terrainSurface.width !== columns || terrainSurface.height !== rows) {
    terrainSurface.width = columns;
    terrainSurface.height = rows;
  }
  const surface = terrainSurface.getContext("2d");
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const world = camera.fromScreen({ x: column * cell + cell / 2, y: row * cell + cell / 2 });
      surface.fillStyle = shadeColor(theme.land, terrainShade(network, world.x, world.y, range));
      surface.fillRect(column, row, 1, 1);
    }
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrainSurface, 0, 0, columns, rows, 0, 0, columns * cell, rows * cell);
}

function contextRoads({ network, routes, route }) {
  const roads = network ? network.roads() : routes ? [...(routes instanceof Map ? routes.values() : routes)] : [];
  return roads.filter((road) => road !== route && road.id !== route.id);
}

/** A road's world bounding box, computed once per road. */
const boundsCache = new WeakMap();

function roadBounds(road) {
  let bounds = boundsCache.get(road);
  if (!bounds) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { x, y } of road.nodes) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    bounds = { minX, maxX, minY, maxY };
    boundsCache.set(road, bounds);
  }
  return bounds;
}

/** The world rectangle the camera shows, with a margin for line widths. */
function viewRect(camera, width, height) {
  const corners = [camera.fromScreen({ x: 0, y: 0 }), camera.fromScreen({ x: width, y: 0 }), camera.fromScreen({ x: 0, y: height }), camera.fromScreen({ x: width, y: height })];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const margin = 20;
  return { minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin, minY: Math.min(...ys) - margin, maxY: Math.max(...ys) + margin };
}

const outside = (bounds, view) => bounds.maxX < view.minX || bounds.minX > view.maxX || bounds.maxY < view.minY || bounds.minY > view.maxY;

function drawRoads(ctx, { network, routes, route, camera, theme, width, height }) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Other roads are context only: thin lines under the road being ridden,
  // skipped whole when they lie outside the view.
  const view = viewRect(camera, width, height);
  ctx.globalAlpha = 0.7;
  for (const road of contextRoads({ network, routes, route })) {
    if (outside(roadBounds(road), view)) continue;
    strokePath(ctx, camera, road.nodes, { color: theme.contextRoad, width: Math.max(2, camera.scale * 0.45) });
  }
  ctx.globalAlpha = 1;
  strokePath(ctx, camera, route.nodes, { color: theme.road, width: roadWidth(route) * camera.scale });
}

function drawMarkings(ctx, route, camera, theme) {
  const scale = camera.scale;
  const line = Math.max(1, 0.12 * scale);
  for (const side of [-1, 1]) {
    const offset = side * (route.lanes * LANE_WIDTH) / 2 - side * EDGE_LINE / 2;
    strokePath(ctx, camera, cachedOffsetNodes(route, offset), { color: theme.edge, width: line });
  }
  // Below a few pixels a lane divider is noise, not information.
  if (LANE_WIDTH * scale < 4) return;
  for (let lane = 1; lane < route.lanes; lane += 1) {
    const offset = (lane - route.lanes / 2) * LANE_WIDTH;
    strokePath(ctx, camera, cachedOffsetNodes(route, offset), { color: theme.marking, width: line, dash: [3 * scale, 3 * scale] });
  }
}

/** Golden lemons along the road, under the riders, collected ones gone. */
function drawLemons(ctx, { route, lemons, camera, width, height }) {
  for (const lemon of lemons) {
    if (lemon.collected) continue;
    const screen = camera.toScreen(roadPointAt(route, lemon.distance, lemon.lane));
    if (screen.x < -10 || screen.x > width + 10 || screen.y < -10 || screen.y > height + 10) continue;
    ctx.fillStyle = "#ffcc14";
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The draft gap, as a soft band from me to the rider ahead (as the lane strip drew it). */
function drawDraft(ctx, { route, me, draft, camera, colors }) {
  if (!me || !draft || !(draft.gap > 0)) return;
  const steps = Math.max(2, Math.ceil(draft.gap / 2));
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(roadPointAt(route, me.distance + (draft.gap * i) / steps, me.lane));
  ctx.globalAlpha = 0.18;
  strokePath(ctx, camera, points, { color: colors.me, width: LANE_WIDTH * 0.8 * camera.scale });
  ctx.globalAlpha = 1;
}

const overlaps = (a, b, margin = 4) =>
  a.left < b.right + margin && b.left < a.right + margin && a.top < b.bottom + margin && b.top < a.bottom + margin;

function drawRiders(ctx, { route, riders, me, myId, camera, colors, width, height }) {
  const marks = mapRiderMarks(riders, myId);
  const boxes = [];
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "11px system-ui, sans-serif";
  // My label is drawn with the arrow; reserve its box so another name does not sit on it.
  if (me) {
    const labelWidth = ctx.measureText(me.name).width;
    boxes.push({ left: camera.rider.x - labelWidth / 2, right: camera.rider.x + labelWidth / 2, top: camera.rider.y - 30, bottom: camera.rider.y - 18 });
  }
  for (const mark of marks) {
    const screen = camera.toScreen(roadPointAt(route, mark.rider.distance, mark.rider.lane));
    if (screen.x < -40 || screen.x > width + 40 || screen.y < -40 || screen.y > height + 40) continue;
    const radius = mark.big ? 6 : 4;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = riderColor(mark.rider, myId, colors);
    if (mark.rider.ghost) {
      // My best lap's ghost: see-through with a dashed outline.
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fill();
    }
    if (mark.big) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (mark.rider.id === myId) continue; // my arrow carries my name
    const labelWidth = ctx.measureText(mark.label).width;
    const box = { left: screen.x - labelWidth / 2, right: screen.x + labelWidth / 2, top: screen.y - radius - 16, bottom: screen.y - radius - 4 };
    if (boxes.some((other) => overlaps(other, box))) continue;
    boxes.push(box);
    ctx.fillStyle = colors.text;
    ctx.fillText(mark.label, screen.x, screen.y - radius - 4);
  }

  // Me: an arrow pointing up (the camera is heading-up and centred on me).
  if (!me) return;
  const { x, y } = camera.rider;
  ctx.beginPath();
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x - 7, y + 7);
  ctx.lineTo(x + 7, y + 7);
  ctx.closePath();
  ctx.fillStyle = colors.me;
  ctx.fill();
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.fillText(me.name, x, y - 18);
}

export function drawRideMap(canvas, { route, riders = [], me = null, draft = null, lemons = [], colors, network = null, routes = null, biome = "temperate", timeMode = "day", date }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  if (!route) return;
  const theme = rideMapTheme({ biome, timeMode, date, colors });
  const at = me ?? { distance: 0, lane: (route.lanes - 1) / 2 };
  const camera = mapCamera(route, at, width, height);
  const coast = drawGround(ctx, { network, width, height, theme });
  if (coast) {
    landPath(ctx, camera, coast);
    ctx.fillStyle = theme.land;
    ctx.fill();
    if (coast.length >= 3) {
      ctx.save();
      landPath(ctx, camera, coast);
      ctx.clip();
      drawTerrain(ctx, { canvas, network, camera, width, height, theme });
      ctx.restore();
    }
    landPath(ctx, camera, coast);
    ctx.strokeStyle = theme.sand;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawDecorations(ctx, { decorations: roadDecorations(route, network), camera, width, height, theme });
  drawRoads(ctx, { network, routes, route, camera, theme, width, height });
  drawMarkings(ctx, route, camera, theme);
  drawDraft(ctx, { route, me, draft, camera, colors });
  drawLemons(ctx, { route, lemons, camera, width, height });
  drawRiders(ctx, { route, riders, me, myId: me?.id ?? null, camera, colors, width, height });
}
