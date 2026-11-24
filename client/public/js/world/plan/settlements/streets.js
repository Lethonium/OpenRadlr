/**
 * The street network of a settlement: the reused main road, a lane to a distant harbour, parallel and cross
 * streets, junctions and blocks, then the square and a harbour's quay. Each function takes the settlement's
 * frame (`ctx`, built in `index.js`) and draws no random numbers except the square's side on flat ground.
 */
import { MAIN_WIDTH } from "./styles.js";
import { groundRange, line, perp2, trimToLand } from "./lines.js";

/**
 * @typedef {object} Frame the settlement's local frame and what it stands on
 * @property {string} id
 * @property {string} kind
 * @property {object} style one of `SETTLEMENT_STYLE`
 * @property {number[]} center world `[x, z]`
 * @property {number} radius
 * @property {object|null} terrain `{height, seaLevel, riverDistance?}`
 * @property {{road: object, d: number, x: number, z: number, dist: number}|null} nearest the road nearest the centre
 * @property {number[]} u unit vector along the main road
 * @property {number[]} v unit vector across it
 * @property {(a: number, b: number) => number[]} local local `(u, v)` to world `[x, z]`
 * @property {(x: number, z: number) => number[]} toLocal world to local
 * @property {(x: number, z: number) => boolean} onLand
 */

/** The main road, a lane to it for a settlement away from it, then the new streets, junctions and blocks. */
export function layoutStreets(ctx) {
  const { id, style, center, radius, terrain, nearest, local, onLand } = ctx;
  const streets = [];
  const junctions = [];
  const blocks = [];
  const cross = [];
  for (let i = style.crossFrom; i <= style.crossTo; i += 1) cross.push(i * style.block);
  // `rows` are block counts, like `crossFrom`/`crossTo`: a row at 1 stands one block off the main road.
  const rows = style.rows.map((row) => row * style.block);
  const rowEdges = [...new Set([...rows, 0].sort((a, b) => a - b))];
  const uMin = cross[0] - style.block / 2;
  const uMax = cross[cross.length - 1] + style.block / 2;
  const vMin = rows[0] - style.block / 2;
  const vMax = rows[rows.length - 1] + style.block / 2;

  // The main road is already drawn. Its entry exists for pavements, houses and the square.
  if (nearest) {
    const from = Math.max(0, nearest.d - radius);
    const to = Math.min(nearest.road.length, nearest.d + radius);
    const points = [];
    for (let d = from; d <= to; d += 8) {
      const p = nearest.road.positionAt(d);
      points.push([p.x, -p.y]);
    }
    streets.push({ id: `${id}-main`, kind: "main", existing: true, width: MAIN_WIDTH, points, from, to, route: nearest.road, frontage: style.frontage ?? 1 });
  }
  // A settlement away from a road gets a lane to it. The lane carries no houses and fewer lamps than a street.
  if (nearest && nearest.dist > radius * 0.6) {
    const roadPoint = [nearest.x, nearest.z];
    const length = Math.hypot(center[0] - roadPoint[0], center[1] - roadPoint[1]);
    const count = Math.max(2, Math.ceil(length / 10));
    const points = [];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      points.push([roadPoint[0] + (center[0] - roadPoint[0]) * t, roadPoint[1] + (center[1] - roadPoint[1]) * t]);
    }
    streets.push({ id: `${id}-lane`, kind: "lane", width: 4.5, pavement: 1.5, points, houses: false, lampEvery: 80 });
    // A few houses where the lane reaches the shore; the lane's ribbon is drawn once, this adds frontage only.
    const shore = points.slice(Math.max(0, points.length - Math.ceil(160 / 10)));
    if (shore.length >= 2) streets.push({ id: `${id}-shore`, kind: "lane", width: 4.5, pavement: 1.5, points: shore, houses: true, draw: false, lampEvery: 1000 });
  }

  // Streets parallel to the main road, then cross streets, each cut at the water.
  for (const b of rows) {
    const points = trimToLand(line(local, [uMin, b], [uMax, b]), terrain);
    if (points.length >= 2) streets.push({ id: `${id}-street-${b}`, kind: "street", width: style.streetWidth, points });
  }
  for (const a of cross) {
    const points = trimToLand(line(local, [a, vMin], [a, vMax]), terrain);
    if (points.length >= 2) streets.push({ id: `${id}-cross-${a}`, kind: "street", width: style.streetWidth, points });
  }

  // Junctions: every cross street against the streets it crosses, including the main road at v = 0.
  for (const a of cross) {
    for (const b of [0, ...rows]) {
      const [x, z] = local(a, b);
      if (onLand(x, z)) junctions.push({ x, z, radius: style.streetWidth * 0.9 });
    }
  }
  // Blocks, for the map and for tests: between two cross streets and two row edges.
  for (let i = 0; i < cross.length - 1; i += 1) {
    for (let j = 0; j < rowEdges.length - 1; j += 1) {
      const [a0, a1, b0, b1] = [cross[i], cross[i + 1], rowEdges[j], rowEdges[j + 1]];
      blocks.push({ id: `${id}-block-${i}-${j}`, corners: [local(a0, b0), local(a1, b0), local(a1, b1), local(a0, b1)], a0, a1, b0, b1 });
    }
  }
  return { streets, junctions, blocks, uMax };
}

/**
 * The square on the flatter side of the main road, with a fountain, stalls, benches and the church behind it.
 * @param {Frame} ctx
 * @param {() => number} random only drawn from on terrain-less ground
 * @returns {{square: object|null, props: object[]}}
 */
export function layoutSquare(ctx, random) {
  const { style, terrain, local, u, v } = ctx;
  if (!style.square) return { square: null, props: [] };
  const props = [];
  const [squareWidth, squareDepth] = style.square;
  const side = (() => {
    if (!terrain) return random() < 0.5 ? 1 : -1;
    const left = groundRange(terrain, local(0, 30)[0], local(0, 30)[1], squareWidth);
    const right = groundRange(terrain, local(0, -30)[0], local(0, -30)[1], squareWidth);
    return left.slope <= right.slope ? 1 : -1;
  })();
  const front = MAIN_WIDTH / 2 + style.pavement + 1;
  const b0 = side * front;
  const b1 = side * (front + squareDepth);
  const square = {
    side,
    a0: -squareWidth / 2,
    a1: squareWidth / 2,
    b0: Math.min(b0, b1),
    b1: Math.max(b0, b1),
    center: local(0, (b0 + b1) / 2),
    width: squareWidth,
    depth: squareDepth,
    yaw: Math.atan2(-u[0], -u[1]),
  };
  props.push({ role: "fountains", x: square.center[0], z: square.center[1], yaw: square.yaw, radius: 3 });
  for (const along of [-0.3, 0, 0.3]) {
    const p = local(along * squareWidth, side * (front + squareDepth * 0.72));
    props.push({ role: "stalls", x: p[0], z: p[1], yaw: square.yaw + Math.PI / 2, radius: 2 });
  }
  for (const along of [-0.32, 0.32]) {
    const p = local(along * squareWidth, side * (front + squareDepth * 0.35));
    props.push({ role: "benches", x: p[0], z: p[1], yaw: square.yaw, radius: 1 });
  }
  const church = local(0, side * (front + squareDepth + 8));
  props.push({ role: "church", x: church[0], z: church[1], yaw: Math.atan2(side * v[0], side * v[1]), radius: 7 });
  return { square, props };
}

/**
 * A harbour faces the water: a quay along the shore and a few boats in the bay. The sea direction is the
 * nearest shore of eight directions around the centre.
 * @param {Frame} ctx
 */
export function layoutQuay(ctx) {
  const { kind, terrain, center } = ctx;
  if (kind !== "harbour" || !terrain) return { quay: null, boats: [], props: [] };
  const water = terrain.seaLevel ?? -Infinity;
  let sea = null;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let shore = null;
    for (let r = 10; r <= 180; r += 5) {
      if (terrain.height(center[0] + dx * r, center[1] + dz * r) < water + 1.2) {
        shore = r;
        break;
      }
    }
    if (shore !== null && (!sea || shore < sea.shore)) sea = { shore, dx, dz };
  }
  if (!sea) return { quay: null, boats: [], props: [] };
  const inland = Math.max(0, sea.shore - 8);
  const shoreX = center[0] + sea.dx * inland;
  const shoreZ = center[1] + sea.dz * inland;
  const along = perp2([sea.dx, sea.dz]);
  const quay = { x: shoreX, z: shoreZ, yaw: Math.atan2(-along[0], -along[1]), length: 46, width: 7, sea: [sea.dx, sea.dz] };
  const boats = [];
  for (let i = 0; i < 4; i += 1) {
    const offset = (i - 1.5) * 9;
    boats.push({
      x: shoreX + sea.dx * (18 + (i % 2) * 8) + along[0] * offset,
      z: shoreZ + sea.dz * (18 + (i % 2) * 8) + along[1] * offset,
      yaw: Math.atan2(-sea.dx, -sea.dz) + (i % 2 ? 0.3 : -0.2),
    });
  }
  const props = [
    { role: "stalls", x: shoreX + along[0] * 8, z: shoreZ + along[1] * 8, yaw: quay.yaw, radius: 2 },
    { role: "benches", x: shoreX - along[0] * 8, z: shoreZ - along[1] * 8, yaw: quay.yaw, radius: 1 },
  ];
  return { quay, boats, props };
}
