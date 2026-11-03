/**
 * The ride's 2D view: a top-down map of the road around the rider.
 *
 * The rider sits near the bottom centre, heading up, so the road ahead fills
 * the screen. The map draws the island (when the road network is known), every
 * road once, the road being ridden with its lane markings, and the riders
 * around me. It uses the same route/rider data as the 3D view, so a device
 * without WebGL 2 can still follow the ride.
 */
import { soloRiders, vehicleMarkers } from "../ride/vehicle.js";
import { LANE_WIDTH, SHOULDER } from "../view3d/world.js";
import { prepareCanvas, riderColor } from "./canvas.js";
import { MAP_COLORS, coastOutline } from "./mapPreview.js";
import { drawDecorations, roadDecorations } from "./rideMapDecor.js";

/** How much road the canvas height shows, and where on it the rider sits. */
export const MAP_VIEW = Object.freeze({ spanM: 120, riderY: 0.62 });

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

/** One mark per solo rider and per vehicle, labelled as in the rest of the HUD. */
export function mapRiderMarks(riders, myId) {
  const solo = soloRiders(riders).map((rider) => ({
    rider,
    label: rider.is_bot ? `${rider.name} · bot` : rider.name,
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

function drawGround(ctx, { network, width, height }) {
  if (!network) {
    ctx.fillStyle = MAP_COLORS.land;
    ctx.fillRect(0, 0, width, height);
    return null;
  }
  ctx.fillStyle = MAP_COLORS.sea;
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

function shadeColor(hex, factor) {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((value >> 16) & 255) * factor);
  const g = Math.round(((value >> 8) & 255) * factor);
  const b = Math.round((value & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

let terrainSurface = null;

/** Sparse terrain relief, sampled in world space on screen-space cells and smoothed up. */
function drawTerrain(ctx, { canvas, network, camera, width, height }) {
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
        ctx.fillStyle = shadeColor(MAP_COLORS.land, terrainShade(network, world.x, world.y, range));
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
      surface.fillStyle = shadeColor(MAP_COLORS.land, terrainShade(network, world.x, world.y, range));
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

function drawRoads(ctx, { network, routes, route, camera, colors }) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Other roads are context only: thin lines under the road being ridden.
  ctx.globalAlpha = 0.7;
  for (const road of contextRoads({ network, routes, route })) {
    strokePath(ctx, camera, road.nodes, { color: colors.muted, width: Math.max(2, camera.scale * 0.45) });
  }
  ctx.globalAlpha = 1;
  strokePath(ctx, camera, route.nodes, { color: colors.road, width: roadWidth(route) * camera.scale });
}

function drawMarkings(ctx, route, camera, colors) {
  const scale = camera.scale;
  const line = Math.max(1, 0.12 * scale);
  for (const side of [-1, 1]) {
    const offset = side * (route.lanes * LANE_WIDTH) / 2 - side * EDGE_LINE / 2;
    strokePath(ctx, camera, offsetNodes(route, offset), { color: colors.text, width: line });
  }
  // Below a few pixels a lane divider is noise, not information.
  if (LANE_WIDTH * scale < 4) return;
  for (let lane = 1; lane < route.lanes; lane += 1) {
    const offset = (lane - route.lanes / 2) * LANE_WIDTH;
    strokePath(ctx, camera, offsetNodes(route, offset), { color: colors.text, width: line, dash: [3 * scale, 3 * scale] });
  }
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
    ctx.fill();
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

export function drawRideMap(canvas, { route, riders = [], me = null, colors, network = null, routes = null }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  if (!route) return;
  const at = me ?? { distance: 0, lane: (route.lanes - 1) / 2 };
  const camera = mapCamera(route, at, width, height);
  const coast = drawGround(ctx, { network, width, height });
  if (coast) {
    landPath(ctx, camera, coast);
    ctx.fillStyle = MAP_COLORS.land;
    ctx.fill();
    if (coast.length >= 3) {
      ctx.save();
      landPath(ctx, camera, coast);
      ctx.clip();
      drawTerrain(ctx, { canvas, network, camera, width, height });
      ctx.restore();
    }
    landPath(ctx, camera, coast);
    ctx.strokeStyle = MAP_COLORS.sand;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawDecorations(ctx, { decorations: roadDecorations(route, network), camera, width, height });
  drawRoads(ctx, { network, routes, route, camera, colors });
  drawMarkings(ctx, route, camera, colors);
  drawRiders(ctx, { route, riders, me, myId: me?.id ?? null, camera, colors, width, height });
}
