/**
 * Town light (#117): the warm windows, ground pools and market lights that
 * make a settlement read as inhabited at dusk.
 *
 * `planTownLight` is plain data and a pure function of the layout and its
 * seed, so the same town looks the same on every client and can be tested
 * without a renderer. `buildTownLight` turns that plan into geometry: emissive
 * quads in `bright`, additive discs in `glow` and the market sign's post in
 * `structures`.
 *
 * No bloom pass and no clock: windows are emissive, pools are additive ground
 * quads and only the nearest few lamps become point lights (High quality).
 */
import { seededRandom } from "./noise.js";

const TAU = Math.PI * 2;

/** The warm colours, how many windows are lit and how strong each layer is. */
export const TOWN_LIGHT = Object.freeze({
  window: Object.freeze([1.0, 0.72, 0.38]),
  lamp: Object.freeze([1.0, 0.66, 0.34]),
  market: Object.freeze([1.0, 0.8, 0.52]),
  /** Share of the street-facing windows that are lit at dusk. */
  lit: 0.65,
  /** How much of the emissive brightness each time of day keeps. */
  brightness: Object.freeze({ day: 0.25, golden: 0.55, dusk: 1 }),
  /** Pools are dusk only: golden hour keeps a warm hint, but no pools. */
  poolAlpha: Object.freeze({ day: 0, golden: 0, dusk: 0.22 }),
});

/** The opaque shader holds this many town lights at once (see renderer.js). */
export const MAX_TOWN_LIGHTS = 8;

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The settlement frame's local `(a, b)` as world `[x, z]`. */
function localOf(layout, a, b) {
  const [x, z] = layout.center;
  const { u, v } = layout.frame;
  return [x + u[0] * a + v[0] * b, z + u[1] * a + v[1] * b];
}

/** The house footprint the settlement builder uses when no model is picked. */
function plotHouse(plot, height) {
  const width = Math.min(plot.width * 0.82, 10);
  const depth = Math.min(plot.depth * 0.62, 9);
  const x = plot.x + plot.facing[0] * (plot.depth - depth) / 2;
  const z = plot.z + plot.facing[1] * (plot.depth - depth) / 2;
  return { x, z, yaw: plot.yaw, facing: plot.facing, width, depth, ground: height(x, z) };
}

/**
 * The light of one settlement: windows, ground pools, point lights and the
 * market's string bulbs, stalls and sign.
 *
 * @param {object} layout from `layoutSettlement`
 * @param {object} [options]
 * @param {"day"|"golden"|"dusk"} [options.mode] pools exist at dusk only
 * @param {(x: number, z: number) => number} [options.height] ground height
 * @param {object[]} [options.houses] built houses (with real widths/depths)
 *   from `buildSettlement`; the layout's plots are used when omitted
 * @returns {{id: string, windows: object[], pools: object[], lights: object[], market: object}}
 */
export function planTownLight(layout, { mode = "dusk", height = () => 0, houses = null } = {}) {
  const empty = { id: layout?.id ?? "", windows: [], pools: [], lights: [], market: { bulbs: [], stalls: [], sign: null } };
  if (!layout) return empty;
  const random = seededRandom((hash(layout.id) ^ 0x70a1) >>> 0);
  const windows = [];
  const pools = [];
  const lights = [];
  const market = { bulbs: [], stalls: [], sign: null };
  const buildings = houses ?? layout.plots.map((plot) => plotHouse(plot, height));

  // Windows: two to four per street-facing facade, most of them lit. The
  // facade is the plot's street edge, which is where `buildSettlement` puts
  // the house; the windows sit a hair in front of it so they never z-fight.
  for (const house of buildings) {
    const facing = house.facing ?? [-Math.sin(house.yaw), -Math.cos(house.yaw)];
    const along = [-facing[1], facing[0]];
    const yaw = Math.atan2(facing[0], facing[1]);
    const ground = house.ground ?? height(house.x, house.z);
    const count = 2 + Math.floor(random() * 3);
    for (let i = 0; i < count; i += 1) {
      const lit = random() < TOWN_LIGHT.lit;
      const spread = ((i + 0.5) / count - 0.5) * house.width * 0.8;
      const floor = random() < 0.65 ? 1 : 2;
      const tone = 0.75 + random() * 0.25;
      if (!lit) continue;
      const width = 0.9 + random() * 0.3;
      const windowHeight = 1.2 + random() * 0.3;
      const front = house.depth / 2 + 0.06;
      windows.push({
        x: house.x + facing[0] * front + along[0] * spread,
        y: ground + 1.55 + (floor - 1) * 2.6,
        z: house.z + facing[1] * front + along[1] * spread,
        yaw,
        width,
        height: windowHeight,
        colour: TOWN_LIGHT.window.map((c) => c * tone),
      });
    }
  }

  // Lamp lights: the head of the biome's street lamp is about 5.1 m up.
  for (const lamp of layout.lamps ?? []) {
    const ground = height(lamp.x, lamp.z);
    lights.push({
      x: lamp.x,
      y: ground + 5.1,
      z: lamp.z,
      colour: TOWN_LIGHT.lamp,
      radius: 12 + random() * 4,
      intensity: 0.75 + random() * 0.25,
    });
  }

  // Pools exist at dusk only. A lamp pool is broad; a shop window spills a
  // little light onto the pavement; a stall on the square gets its own pool.
  const poolAlpha = TOWN_LIGHT.poolAlpha[mode] ?? 0;
  if (poolAlpha > 0) {
    for (const lamp of layout.lamps ?? []) {
      pools.push({
        x: lamp.x,
        y: height(lamp.x, lamp.z) + 0.2,
        z: lamp.z,
        radius: 6 + random() * 3,
        colour: TOWN_LIGHT.lamp,
        alpha: poolAlpha,
        lift: 0.2,
        kind: "lamp",
      });
    }
    if (layout.square) {
      const shops = buildings.filter((house) => Math.hypot(house.x - layout.square.center[0], house.z - layout.square.center[1]) < 45);
      for (const [i, house] of shops.entries()) {
        if (i % 2 === 1) continue;
        const facing = house.facing ?? [-Math.sin(house.yaw), -Math.cos(house.yaw)];
        const front = house.depth / 2 + 1.4;
        const x = house.x + facing[0] * front;
        const z = house.z + facing[1] * front;
        pools.push({
          x,
          y: height(x, z) + 0.2,
          z,
          radius: 2.2 + random() * 0.8,
          colour: TOWN_LIGHT.window,
          alpha: 0.12,
          lift: 0.2,
          kind: "shop",
        });
      }
    }
  }

  // The market: a string of bulbs across the square, a hanging light on each
  // stall and one lit sign by the road. These are the few hero lights that
  // carry the dusk; the rest of the town stays dark.
  if (layout.square) {
    const square = layout.square;
    const b = (square.b0 + square.b1) / 2;
    const a0 = square.a0 * 0.72;
    const a1 = square.a1 * 0.72;
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const [x, z] = localOf(layout, a0 + (a1 - a0) * t, b);
      const y = height(x, z) + 3.9 - Math.sin(t * Math.PI) * 0.45;
      market.bulbs.push({ x, y, z, size: 0.15 });
      if (i % 3 === 1) {
        lights.push({ x, y: y - 0.2, z, colour: TOWN_LIGHT.market, radius: 9, intensity: 0.7 });
      }
    }
    for (const prop of layout.props ?? []) {
      if (prop.role !== "stalls") continue;
      const ground = height(prop.x, prop.z);
      market.stalls.push({ x: prop.x, y: ground + 2.7, z: prop.z, yaw: prop.yaw });
      lights.push({ x: prop.x, y: ground + 2.4, z: prop.z, colour: TOWN_LIGHT.market, radius: 8, intensity: 0.75 });
      if (poolAlpha > 0) {
        pools.push({
          x: prop.x,
          y: ground + 0.3,
          z: prop.z,
          radius: 3 + random() * 0.8,
          colour: TOWN_LIGHT.market,
          alpha: 0.16,
          lift: 0.3,
          kind: "market",
        });
      }
    }
    const [sx, sz] = localOf(layout, square.a1 * 0.55, square.b0 + 2);
    const sy = height(sx, sz);
    market.sign = {
      x: sx,
      y: sy + 2.3,
      z: sz,
      yaw: square.yaw,
      width: 1.4,
      height: 0.5,
      colour: TOWN_LIGHT.market,
    };
    lights.push({ x: sx, y: sy + 2.2, z: sz, colour: TOWN_LIGHT.market, radius: 6, intensity: 0.55 });
  }

  return { id: layout.id, windows, pools, lights, market };
}

/**
 * The `count` lights nearest `eye`, closest first. Ties keep their input
 * order, so the selection does not flicker between frames. Runs once per
 * frame, so it keeps a bounded top list instead of sorting every light.
 *
 * @param {object[]} lights
 * @param {number[]} eye `[x, y, z]`
 * @param {number} [count] never more than the shader's eight
 */
export function nearestLights(lights, eye, count = MAX_TOWN_LIGHTS) {
  if (!Array.isArray(lights) || lights.length === 0 || count <= 0) return [];
  const limit = Math.min(count, MAX_TOWN_LIGHTS, lights.length);
  const best = [];
  const distances = [];
  for (const light of lights) {
    const distance = (light.x - eye[0]) ** 2 + (light.y - eye[1]) ** 2 + (light.z - eye[2]) ** 2;
    // A later light at the same distance loses to the one already kept, which
    // keeps the choice stable while the rider moves.
    if (best.length === limit && distance >= distances[limit - 1]) continue;
    let at = best.length;
    while (at > 0 && distances[at - 1] > distance) at -= 1;
    if (best.length === limit) {
      best.pop();
      distances.pop();
    }
    best.splice(at, 0, light);
    distances.splice(at, 0, distance);
  }
  return best;
}

/**
 * Adds a plan's geometry to the world's chunk groups.
 *
 * @param {object} plan from `planTownLight`
 * @param {object} options
 * @param {object} [options.bright] emissive windows, bulbs and the sign face
 * @param {object} [options.glow] additive ground pools
 * @param {object} [options.structures] the sign's post
 * @param {(x: number, z: number) => number} [options.height] ground height, so
 *   pools follow a slope
 * @returns {{windows: number, pools: number, bulbs: number}}
 */
export function buildTownLight(plan, { bright, glow, structures, height = () => 0 } = {}) {
  if (!plan) return { windows: 0, pools: 0, bulbs: 0 };
  let windows = 0;
  for (const window of plan.windows ?? []) {
    // A soft additive halo around the pane, then the pane itself. The halo is
    // in the glow group (drawn after the buildings) so it is never swallowed
    // by the wall it sits on.
    addQuad(glow, { ...window, width: window.width * 1.9, height: window.height * 1.9 }, window.colour.map((c) => c * 0.22));
    addQuad(bright, window, window.colour);
    windows += 1;
  }
  let bulbs = 0;
  for (const bulb of plan.market?.bulbs ?? []) {
    addBulb(bright, bulb);
    bulbs += 1;
  }
  for (const stall of plan.market?.stalls ?? []) {
    addBulb(bright, { ...stall, size: 0.2 });
    bulbs += 1;
  }
  if (plan.market?.sign) {
    addQuad(bright, plan.market.sign, plan.market.sign.colour);
    addPost(structures, plan.market.sign, height);
  }
  let pools = 0;
  for (const pool of plan.pools ?? []) {
    addPool(glow, pool, height);
    pools += 1;
  }
  return { windows, pools, bulbs };
}

/** A flat quad facing `yaw`, centred on `{x, y, z}`. */
function addQuad(mesh, quad, colour) {
  if (!mesh) return;
  const { x, y, z, yaw } = quad;
  const normal = [Math.sin(yaw), 0, Math.cos(yaw)];
  const along = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const halfWidth = quad.width / 2;
  const halfHeight = quad.height / 2;
  const a = [x - along[0] * halfWidth, y - halfHeight, z - along[2] * halfWidth];
  const b = [x + along[0] * halfWidth, y - halfHeight, z + along[2] * halfWidth];
  const c = [x + along[0] * halfWidth, y + halfHeight, z + along[2] * halfWidth];
  const d = [x - along[0] * halfWidth, y + halfHeight, z - along[2] * halfWidth];
  mesh.triangleFacing(a, b, c, colour, normal);
  mesh.triangleFacing(a, c, d, colour, normal);
}

/** A small warm bulb, as two crossed quads so it reads from every side. */
function addBulb(mesh, bulb) {
  if (!mesh) return;
  const size = bulb.size ?? 0.16;
  for (const yaw of [0, Math.PI / 2]) addQuad(mesh, { ...bulb, yaw, width: size, height: size }, TOWN_LIGHT.market);
}

/** The post under the market sign, so the lit board does not float. */
function addPost(mesh, sign, height) {
  if (!mesh) return;
  const ground = height(sign.x, sign.z);
  const top = sign.y - sign.height / 2;
  mesh.box([sign.x, (ground + top) / 2, sign.z], [0.09, Math.max(0.2, top - ground), 0.09], [0.16, 0.13, 0.1]);
}

/**
 * An additive ground pool: concentric rings fading from the lamp colour to
 * black, because additive blending adds nothing where the colour is black.
 * Three rings keep the edge soft without a texture. The pool's alpha is baked
 * into the colour (additive blending ignores the destination alpha), so dusk's
 * 0.22 stays a glow rather than a flat coat of paint.
 */
function addPool(mesh, pool, height) {
  if (!mesh) return;
  const rings = 3;
  const segments = 12;
  const alpha = pool.alpha ?? 1;
  const at = (a, r) => {
    const x = pool.x + Math.cos(a) * r;
    const z = pool.z + Math.sin(a) * r;
    return [x, height(x, z) + (pool.lift ?? 0.2), z];
  };
  for (let ring = 0; ring < rings; ring += 1) {
    const inner = (ring / rings) * pool.radius;
    const outer = ((ring + 1) / rings) * pool.radius;
    const fade = (1 - ring / rings) ** 2;
    const colour = pool.colour.map((c) => c * fade * alpha);
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * TAU;
      const a1 = ((i + 1) / segments) * TAU;
      mesh.triangleFacing(at(a0, inner), at(a1, inner), at(a1, outer), colour, [0, 1, 0]);
      mesh.triangleFacing(at(a0, inner), at(a1, outer), at(a0, outer), colour, [0, 1, 0]);
    }
  }
}
