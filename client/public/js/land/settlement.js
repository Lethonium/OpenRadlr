/**
 * A settlement laid out as data (#117): streets, junctions, blocks, plots, a
 * square and the lamps that will light it.
 *
 * The old village was one row of houses along the rideable road. A town is a
 * *network*: a main street, parallel streets, cross streets, junctions and
 * blocks. This module decides that network from the map seed and the terrain,
 * without building a single triangle, so the same layout can be tested, drawn
 * by the world and compared on the top-down map.
 *
 * Coordinates are world metres: `x` east, `z` south. A settlement has a local
 * frame `u` (along its main road) and `v` (across it); every street is a
 * polyline of `[x, z]` points, and every plot knows the direction its front
 * faces. Everything is a pure function of the settlement seed and the roads.
 */

/** The kinds of settlement the island knows. */
export const SETTLEMENT_KIND = Object.freeze({
  city: "city",
  town: "town",
  village: "village",
  harbour: "harbour",
  hamlet: "hamlet",
});

/**
 * How each kind is laid out. A city is a grid; a village is a main street with
 * one cross lane; a hamlet is a farm cluster with no grid at all.
 */
export const SETTLEMENT_STYLE = Object.freeze({
  city: Object.freeze({
    block: 100,
    crossFrom: -3,
    crossTo: 3,
    rows: [-2, -1, 1, 2],
    streetWidth: 7,
    pavement: 2.4,
    garden: 3,
    gap: [2, 5],
    plotWidth: [7, 12],
    plotDepth: [10, 15],
    square: [50, 40],
    lampEvery: 26,
    mainHouses: true,
    blocks: true,
  }),
  town: Object.freeze({
    block: 84,
    crossFrom: -1,
    crossTo: 1,
    rows: [-1, 1],
    streetWidth: 6.4,
    pavement: 2.2,
    garden: 3,
    gap: [2.5, 6],
    plotWidth: [7, 13],
    plotDepth: [10, 15],
    square: [34, 28],
    lampEvery: 28,
    mainHouses: true,
    blocks: true,
  }),
  village: Object.freeze({
    block: 72,
    crossFrom: 0,
    crossTo: 0,
    rows: [-1, 1],
    streetWidth: 5.6,
    pavement: 2,
    garden: 3,
    gap: [3, 7],
    plotWidth: [8, 14],
    plotDepth: [9, 14],
    square: [26, 22],
    lampEvery: 32,
    mainHouses: true,
    blocks: true,
  }),
  harbour: Object.freeze({
    block: 68,
    crossFrom: 0,
    crossTo: 0,
    rows: [-1, 1],
    streetWidth: 5.4,
    pavement: 2,
    garden: 2.5,
    gap: [3, 8],
    plotWidth: [8, 14],
    plotDepth: [9, 13],
    square: [28, 20],
    lampEvery: 30,
    mainHouses: true,
    blocks: true,
  }),
  hamlet: Object.freeze({
    block: 58,
    crossFrom: 0,
    crossTo: 0,
    rows: [-1, 1],
    streetWidth: 4.6,
    pavement: 1.6,
    garden: 3,
    gap: [6, 12],
    plotWidth: [10, 16],
    plotDepth: [10, 15],
    square: null,
    lampEvery: 40,
    mainHouses: false,
    blocks: false,
  }),
});

/** A stable 32-bit hash of a settlement id. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small deterministic PRNG, so the layout does not depend on the world's order. */
function randomOf(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const length2 = (v) => Math.hypot(v[0], v[1]);
const normalize2 = (v) => {
  const l = length2(v) || 1;
  return [v[0] / l, v[1] / l];
};
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale2 = (v, k) => [v[0] * k, v[1] * k];
const perp2 = (v) => [-v[1], v[0]];

/** The nearest road sample to a point, and the road's local frame there. */
function nearestRoad(roads, x, z) {
  let best = null;
  for (const road of roads) {
    for (let d = 0; d < road.length; d += 6) {
      const p = road.positionAt(d);
      const dx = p.x - x;
      const dz = -p.y - z;
      const squared = dx * dx + dz * dz;
      if (!best || squared < best.squared) best = { road, d, squared, x: p.x, z: -p.y };
    }
  }
  if (!best) return null;
  const a = best.road.positionAt(best.d);
  const b = best.road.positionAt(Math.min(best.road.length, best.d + 10));
  const u = normalize2([b.x - a.x, -(b.y - a.y)]);
  return { ...best, u, v: perp2(u) };
}

/** A polyline sampled between two local points. */
function line(local, a, b, step = 8) {
  const points = [];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const count = Math.max(2, Math.ceil(length / step));
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push(local(a[0] + dx * t, a[1] + dz * t));
  }
  return points;
}

/** Distance from a point to a polyline, for keeping plots off the streets. */
function distanceToLine(x, z, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
  }
  return best;
}

/** The slope and height range under a small square footprint. */
function groundRange(terrain, x, z, size) {
  if (!terrain) return { low: 0, high: 0, slope: 0 };
  const h = terrain.height;
  const values = [];
  for (const [dx, dz] of [
    [-size / 2, -size / 2],
    [size / 2, -size / 2],
    [-size / 2, size / 2],
    [size / 2, size / 2],
    [0, 0],
  ]) values.push(h(x + dx, z + dz));
  const low = Math.min(...values);
  const high = Math.max(...values);
  return { low, high, slope: (high - low) / size };
}

/**
 * Lay out one settlement.
 *
 * @param {object} options
 * @param {string} options.id stable id, part of the seed
 * @param {string} [options.kind] one of `SETTLEMENT_KIND`
 * @param {[number, number]} options.center world `[x, z]`
 * @param {number} [options.radius] how far the settlement reaches, metres
 * @param {number} [options.seed] map seed
 * @param {object|null} [options.terrain] `{ height(x, z) }` for slopes and heights
 * @param {object[]} [options.roads] `RouteGeometry` roads near the settlement
 * @returns {object} streets, junctions, blocks, plots, square, lamps and props
 */
export function layoutSettlement({
  id = "settlement",
  kind = SETTLEMENT_KIND.village,
  center,
  radius = 220,
  seed = 0,
  terrain = null,
  roads = [],
}) {
  const style = SETTLEMENT_STYLE[kind] ?? SETTLEMENT_STYLE.village;
  const random = randomOf((hash(id) ^ (seed >>> 0)) >>> 0);
  const nearest = nearestRoad(roads, center[0], center[1]);
  const u = nearest?.u ?? [1, 0];
  const v = nearest?.v ?? [0, 1];
  const local = (a, b) => [center[0] + u[0] * a + v[0] * b, center[1] + u[1] * a + v[1] * b];
  const toLocal = (x, z) => {
    const d = sub2([x, z], center);
    return [d[0] * u[0] + d[1] * u[1], d[0] * v[0] + d[1] * v[1]];
  };

  const streets = [];
  const junctions = [];
  const blocks = [];
  const plots = [];
  const lamps = [];
  const props = [];

  const cross = [];
  for (let i = style.crossFrom; i <= style.crossTo; i += 1) cross.push(i * style.block);
  const rows = [...style.rows];
  const rowEdges = [...new Set([...rows, 0].sort((a, b) => a - b))];
  const uMin = cross[0] - style.block / 2;
  const uMax = cross[cross.length - 1] + style.block / 2;
  const vMin = rows[0] - style.block / 2;
  const vMax = rows[rows.length - 1] + style.block / 2;

  // The main road is already drawn. Its entry exists for pavements, houses and
  // the square, not for a second ribbon of asphalt.
  if (nearest) {
    const from = Math.max(0, nearest.d - radius);
    const to = Math.min(nearest.road.length, nearest.d + radius);
    const points = [];
    for (let d = from; d <= to; d += 8) {
      const p = nearest.road.positionAt(d);
      points.push([p.x, -p.y]);
    }
    streets.push({
      id: `${id}-main`,
      kind: "main",
      existing: true,
      width: 7.4,
      points,
      from,
      to,
      route: nearest.road,
    });
  }

  // Streets parallel to the main road, then cross streets.
  for (const b of rows) {
    streets.push({
      id: `${id}-street-${b}`,
      kind: "street",
      width: style.streetWidth,
      points: line(local, [uMin, b], [uMax, b]),
    });
  }
  for (const a of cross) {
    streets.push({
      id: `${id}-cross-${a}`,
      kind: "street",
      width: style.streetWidth,
      points: line(local, [a, vMin], [a, vMax]),
    });
  }

  // Junctions: every new street against every street it crosses, including the
  // main road at v = 0.
  for (const a of cross) {
    for (const b of [0, ...rows]) {
      junctions.push({ x: local(a, b)[0], z: local(a, b)[1], radius: style.streetWidth * 0.9 });
    }
  }

  // Blocks, for the map and for tests. A block is a rectangle between two
  // cross streets and two row edges.
  for (let i = 0; i < cross.length - 1; i += 1) {
    for (let j = 0; j < rowEdges.length - 1; j += 1) {
      const a0 = cross[i];
      const a1 = cross[i + 1];
      const b0 = rowEdges[j];
      const b1 = rowEdges[j + 1];
      blocks.push({
        id: `${id}-block-${i}-${j}`,
        corners: [local(a0, b0), local(a1, b0), local(a1, b1), local(a0, b1)],
        a0,
        a1,
        b0,
        b1,
      });
    }
  }

  // The square sits on the flatter side of the main road at the centre.
  let square = null;
  if (style.square) {
    const [squareWidth, squareDepth] = style.square;
    const side = (() => {
      if (!terrain) return random() < 0.5 ? 1 : -1;
      const left = groundRange(terrain, local(0, 30)[0], local(0, 30)[1], squareWidth);
      const right = groundRange(terrain, local(0, -30)[0], local(0, -30)[1], squareWidth);
      return left.slope <= right.slope ? 1 : -1;
    })();
    const front = 7.4 / 2 + style.pavement + 1;
    const b0 = side * front;
    const b1 = side * (front + squareDepth);
    square = {
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
    // Fountain in the middle, stalls along the far side, benches and trees.
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
  }

  // Lamps: junctions first, then every few metres along the new streets.
  for (const junction of junctions) {
    const p = toLocal(junction.x, junction.z);
    const lamp = local(p[0] + style.streetWidth * 0.6, p[1] + style.streetWidth * 0.6);
    lamps.push({ x: lamp[0], z: lamp[1] });
  }
  for (const street of streets) {
    if (street.existing) continue;
    const step = style.lampEvery;
    const stride = Math.max(1, Math.round(step / 8));
    let side = 1;
    for (let i = 0; i < street.points.length; i += stride) {
      const a = street.points[Math.max(0, i - 1)];
      const b = street.points[Math.min(street.points.length - 1, i + 1)];
      const dir = normalize2(sub2(b, a));
      const normal = perp2(dir);
      const p = street.points[i];
      const offset = street.width / 2 + style.pavement * 0.5;
      lamps.push({ x: p[0] + normal[0] * side * offset, z: p[1] + normal[1] * side * offset });
      side = -side;
    }
  }

  // Plots: both sides of every street, walked at a house's width plus a gap.
  // A plot that lands on another street or on the square is left out; the
  // block simply has a garden there.
  const nearStreet = (x, z, margin) => {
    for (const street of streets) {
      if (distanceToLine(x, z, street.points) < street.width / 2 + margin) return true;
    }
    return false;
  };
  const inSquare = (x, z, margin = 2) => {
    if (!square) return false;
    const p = toLocal(x, z);
    return p[0] > square.a0 - margin && p[0] < square.a1 + margin && p[1] > square.b0 - margin && p[1] < square.b1 + margin;
  };

  // Two frontages meet at a corner; without this a house on one street can
  // stand in the garden of a house on the other. A coarse local grid is enough
  // to keep the footprints apart and is deterministic.
  const occupied = new Set();
  const CELL = 2;
  const footprint = (x, z, facing, width, depth) => {
    const along = perp2(facing);
    const corners = [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ].map(([a, b]) => toLocal(
      x + along[0] * a + facing[0] * b,
      z + along[1] * a + facing[1] * b,
    ));
    const xs = corners.map((p) => p[0]);
    const zs = corners.map((p) => p[1]);
    return {
      a0: Math.floor(Math.min(...xs) / CELL),
      a1: Math.floor(Math.max(...xs) / CELL),
      b0: Math.floor(Math.min(...zs) / CELL),
      b1: Math.floor(Math.max(...zs) / CELL),
    };
  };
  const freeFootprint = (box) => {
    for (let a = box.a0; a <= box.a1; a += 1) {
      for (let b = box.b0; b <= box.b1; b += 1) {
        if (occupied.has(`${a},${b}`)) return false;
      }
    }
    return true;
  };
  const markFootprint = (box) => {
    for (let a = box.a0; a <= box.a1; a += 1) {
      for (let b = box.b0; b <= box.b1; b += 1) occupied.add(`${a},${b}`);
    }
  };

  const placeAlong = (street, side) => {
    const points = street.points;
    if (points.length < 2) return;
    let carry = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const segment = sub2(b, a);
      const length = length2(segment);
      if (length < 0.01) continue;
      const dir = normalize2(segment);
      const normal = perp2(dir);
      let at = carry;
      while (at < length) {
        const slot = style.plotWidth[0] + random() * (style.plotWidth[1] - style.plotWidth[0]);
        const depth = style.plotDepth[0] + random() * (style.plotDepth[1] - style.plotDepth[0]);
        const width = Math.min(slot, length - at);
        if (width < 5) break;
        const station = add2(a, scale2(dir, at + width / 2));
        const front = street.width / 2 + style.pavement + style.garden;
        const centerPlot = add2(station, scale2(normal, side * (front + depth / 2)));
        const facing = scale2(normal, -side);
        const [x, z] = centerPlot;
        const ground = groundRange(terrain, x, z, Math.min(width, depth));
        const box = footprint(x, z, facing, width, depth);
        const fits = !nearStreet(x, z, 1.4) && !inSquare(x, z) && freeFootprint(box) && (ground.slope < 0.35 || !terrain);
        if (fits) {
          markFootprint(box);
          plots.push({
            x,
            z,
            yaw: Math.atan2(-facing[0], -facing[1]),
            facing,
            width,
            depth,
            front,
            street: street.id,
            side,
          });
        }
        at += width + style.gap[0] + random() * (style.gap[1] - style.gap[0]);
      }
      carry = at - length;
    }
  };
  for (const street of streets) {
    if (!style.mainHouses && street.existing) continue;
    placeAlong(street, 1);
    placeAlong(street, -1);
  }

  // A windmill or a farm on the edge of the settlement, as a landmark.
  if (style.blocks) {
    const edge = local(uMax + style.block * 0.4, random() < 0.5 ? -style.block : style.block);
    props.push({ role: "windmills", x: edge[0], z: edge[1], yaw: random() * Math.PI * 2, radius: 6 });
  }

  return {
    id,
    kind,
    center: [center[0], center[1]],
    frame: { u, v },
    radius,
    pavement: style.pavement,
    streetWidth: style.streetWidth,
    garden: style.garden,
    streets,
    junctions,
    blocks,
    plots,
    square,
    lamps,
    props,
  };
}
