/**
 * Small map symbols for the 2D ride view: tree dots in and near the forests,
 * and outline buildings along the villages and at the cafés.
 *
 * The 3D world builds trees and houses as meshes, which the 2D view cannot
 * (and must not) reuse: it runs before the world is built and on devices
 * without WebGL. This layer uses the route's existing scenery zones and the
 * map's cafés, so the symbols line up with the roads without a second request.
 * It is generated once per map and culled to the view each frame.
 */
import { seededRandom } from "../view3d/noise.js";
import { LANE_WIDTH, SHOULDER } from "../view3d/world.js";
import { inStretch, resolveZones } from "../view3d/zones.js";

const PAVEMENT = 2.4;
const CAFE_DISTANCE = 45;
const CAFE_SETBACK = 14;
/** Fallback colours when a caller has no themed palette. */
const TREE_COLORS = Object.freeze(["rgb(77, 125, 58)", "rgb(96, 143, 69)"]);
const HOUSE_FILL = "rgba(116, 76, 56, 0.46)";
const HOUSE_EDGE = "rgba(216, 199, 155, 0.85)";
const HOUSE_RIDGE = "rgba(232, 214, 172, 0.45)";
const CAFE_FILL = "rgba(142, 92, 62, 0.52)";
const CAFE_EDGE = "rgba(232, 214, 172, 0.95)";
const CAFE_RIDGE = "rgba(242, 224, 182, 0.6)";

/** Half the asphalt, shoulders included, from the road's centre line. */
const roadHalfWidth = (lanes) => (lanes * LANE_WIDTH) / 2 + SHOULDER;

/** Position and 2D direction of the road at `distance`; right is the right-hand side of travel. */
export function frameAt(route, distance) {
  const point = route.positionAt(distance);
  const before = route.positionAt(distance - 2);
  const after = route.positionAt(distance + 2);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { point, forward: { x: 0, y: 1 }, right: { x: 1, y: 0 } };
  const forward = { x: dx / length, y: dy / length };
  return { point, forward, right: { x: forward.y, y: -forward.x } };
}

const angleOf = (frame) => Math.atan2(frame.forward.y, frame.forward.x);

const offsetPoint = (frame, side, metres) => ({
  x: frame.point.x + frame.right.x * side * metres,
  y: frame.point.y + frame.right.y * side * metres,
});

const cache = new WeakMap();

/**
 * All decorations of a map (or a single route without a map), generated once.
 * @returns {{ trees: {x: number, y: number, r: number, shade: number}[], buildings: {x: number, y: number, w: number, d: number, angle: number, kind: "house"|"cafe"}[] }}
 */
export function roadDecorations(route, network = null) {
  const key = network ?? route;
  let decorations = cache.get(key);
  if (!decorations) {
    decorations = build(route, network);
    cache.set(key, decorations);
  }
  return decorations;
}

function build(route, network) {
  const roads = network ? network.roads() : [route];
  const zones = new Map(roads.map((road) => [road, resolveZones(road)]));
  const buildings = [];
  const cafes = [];
  if (network) {
    for (const cafe of network.cafes()) {
      const road = network.roadFrom(cafe.id);
      if (road) addCafe(road, buildings, cafes, network);
    }
  } else {
    addCafe(route, buildings, cafes, null);
  }
  for (const road of roads) {
    for (const zone of zones.get(road).villages) addVillage(road, zone, buildings, cafes, network);
  }
  const trees = [];
  for (const road of roads) addTrees(road, zones.get(road), buildings, trees, network);
  return { trees, buildings };
}

function addCafe(road, buildings, cafes, network) {
  const frame = frameAt(road, CAFE_DISTANCE);
  const center = offsetPoint(frame, 1, roadHalfWidth(road.lanes) + CAFE_SETBACK);
  if (network && network.heightAt(center.x, center.y) < 2.5) return;
  if (cafes.some((cafe) => Math.hypot(cafe.x - center.x, cafe.y - center.y) < 30)) return;
  cafes.push(center);
  buildings.push({ x: center.x, y: center.y, w: 12, d: 8.5, angle: angleOf(frame), kind: "cafe" });
}

function addVillage(road, zone, buildings, cafes, network) {
  const random = seededRandom((road.seed >>> 0) ^ Math.round(zone.from * 7));
  const half = roadHalfWidth(road.lanes);
  for (const side of [-1, 1]) {
    let d = zone.from + 8 + random() * 6;
    while (d < zone.to - 6) {
      const frame = frameAt(road, d);
      const depth = 9;
      const setback = half + PAVEMENT + 2.5 + random() * 3.5 + depth / 2;
      const center = offsetPoint(frame, side, setback);
      const nearCafe = cafes.some((cafe) => Math.hypot(cafe.x - center.x, cafe.y - center.y) < 16);
      const inWater = network && network.heightAt(center.x, center.y) < 2.5;
      if (!inWater && !nearCafe && random() < 0.88) {
        buildings.push({
          x: center.x,
          y: center.y,
          w: 7 + random() * 3.5,
          d: 6 + random() * 3,
          angle: angleOf(frame),
          kind: "house",
        });
      }
      d += 13 + random() * 7;
    }
  }
}

function addTrees(road, zones, buildings, trees, network) {
  const random = seededRandom((road.seed >>> 0) ^ 0x7ee5);
  const half = roadHalfWidth(road.lanes);
  const minOffset = half + 1.1 + 3; // beyond the verge, clear of the road
  const add = (frame, side, offset, along, forest) => {
    const center = {
      x: frame.point.x + frame.right.x * side * offset + frame.forward.x * along,
      y: frame.point.y + frame.right.y * side * offset + frame.forward.y * along,
    };
    if (network && network.heightAt(center.x, center.y) < 2.5) return; // sea and beach
    const radius = forest ? 3 + random() * 1.2 : 2.6 + random() * 1.0;
    const clear = buildings.some((house) => Math.hypot(house.x - center.x, house.y - center.y) < Math.max(house.w, house.d) / 2 + 4);
    if (clear) return;
    trees.push({ x: center.x, y: center.y, r: radius, shade: random() < 0.5 ? 0 : 1 });
  };
  for (const forest of zones.forests) {
    for (let d = forest.from; d < forest.to; d += 7) {
      if (random() > 0.85) continue;
      const frame = frameAt(road, d);
      const side = random() < 0.5 ? -1 : 1;
      const offset = minOffset + 2 + Math.pow(random(), 1.4) * 36;
      const count = 2 + Math.floor(random() * 3);
      for (let i = 0; i < count; i += 1) {
        add(frame, side, offset + (random() - 0.5) * 3, (random() - 0.5) * 7, true);
      }
    }
  }
  for (let d = 0; d < road.length; d += 3) {
    if (inStretch(road, zones.villages, d, 20)) continue;
    if (random() < 0.55) {
      const frame = frameAt(road, d);
      add(frame, random() < 0.5 ? -1 : 1, minOffset + Math.pow(random(), 1.5) * 34, 0, false);
    }
  }
}

const CULL_RADIUS = 220;

function buildingPoint(building, camera, forwardOffset, rightOffset) {
  const cos = Math.cos(building.angle);
  const sin = Math.sin(building.angle);
  return camera.toScreen({
    x: building.x + cos * forwardOffset + sin * rightOffset,
    y: building.y + sin * forwardOffset - cos * rightOffset,
  });
}

function buildingCorners(building, camera) {
  const w = building.w / 2;
  const d = building.d / 2;
  return [
    buildingPoint(building, camera, -w, -d),
    buildingPoint(building, camera, w, -d),
    buildingPoint(building, camera, w, d),
    buildingPoint(building, camera, -w, d),
  ];
}

/** Draws the decorations under the roads, culled to the view. */
export function drawDecorations(ctx, { decorations, camera, width, height, theme = null }) {
  const { center } = camera;
  const trees = theme?.trees ?? TREE_COLORS;
  for (const tree of decorations.trees) {
    if (Math.hypot(tree.x - center.x, tree.y - center.y) > CULL_RADIUS) continue;
    const point = camera.toScreen(tree);
    if (point.x < -10 || point.x > width + 10 || point.y < -10 || point.y > height + 10) continue;
    ctx.beginPath();
    ctx.arc(point.x, point.y, tree.r, 0, Math.PI * 2);
    ctx.fillStyle = trees[tree.shade] ?? trees[0];
    ctx.fill();
  }
  for (const building of decorations.buildings) {
    if (Math.hypot(building.x - center.x, building.y - center.y) > CULL_RADIUS + Math.max(building.w, building.d)) continue;
    const points = buildingCorners(building, camera);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    if (Math.max(...xs) < -20 || Math.min(...xs) > width + 20 || Math.max(...ys) < -20 || Math.min(...ys) > height + 20) continue;
    ctx.beginPath();
    points.forEach((p, index) => (index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    const cafe = building.kind === "cafe";
    ctx.fillStyle = (cafe ? theme?.cafeFill : theme?.houseFill) ?? (cafe ? CAFE_FILL : HOUSE_FILL);
    ctx.fill();
    ctx.strokeStyle = (cafe ? theme?.cafeEdge : theme?.houseEdge) ?? (cafe ? CAFE_EDGE : HOUSE_EDGE);
    ctx.lineWidth = cafe ? 1.5 : 1;
    ctx.stroke();
    const ridgeStart = buildingPoint(building, camera, -building.w / 2, 0);
    const ridgeEnd = buildingPoint(building, camera, building.w / 2, 0);
    ctx.beginPath();
    ctx.moveTo(ridgeStart.x, ridgeStart.y);
    ctx.lineTo(ridgeEnd.x, ridgeEnd.y);
    ctx.strokeStyle = (cafe ? theme?.cafeRidge : theme?.houseRidge) ?? (cafe ? CAFE_RIDGE : HOUSE_RIDGE);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
