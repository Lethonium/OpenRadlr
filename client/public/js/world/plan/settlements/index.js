/**
 * A settlement laid out as data (#117): streets, junctions, blocks, plots, a square and the lamps that will
 * light it. A town is a *network*: a main street, parallel streets, cross streets, junctions and blocks. This
 * decides that network from the settlement's seed and the terrain without building a triangle, so the same
 * layout can be tested, drawn by the world and compared on the top-down map.
 *
 * Coordinates are world metres: `x` east, `z` south. A settlement has a local frame `u` (along its main road)
 * and `v` (across it); every street is a polyline of `[x, z]` points. A pure function of the id, seed, terrain
 * and roads.
 */
import { seededRandom } from "../../noise.js";
import { SETTLEMENT_KIND, SETTLEMENT_STYLE } from "./styles.js";
import { hash, nearestRoad, normalize2, perp2, roadSamples, sub2 } from "./lines.js";
import { layoutQuay, layoutSquare, layoutStreets } from "./streets.js";
import { layoutPlots } from "./plots.js";

export { SETTLEMENT_KIND, SETTLEMENT_STYLE };

/** Lamps: at the junctions first, then every few metres along the streets the road layer draws. */
function layoutLamps({ style }, streets, junctions, toLocal, local) {
  const lamps = [];
  for (const junction of junctions) {
    const p = toLocal(junction.x, junction.z);
    const lamp = local(p[0] + style.streetWidth * 0.6, p[1] + style.streetWidth * 0.6);
    lamps.push({ x: lamp[0], z: lamp[1] });
  }
  for (const street of streets) {
    if (street.existing || street.draw === false) continue;
    const stride = Math.max(1, Math.round((street.lampEvery ?? style.lampEvery) / 8));
    let side = 1;
    for (let i = 0; i < street.points.length; i += stride) {
      const a = street.points[Math.max(0, i - 1)];
      const b = street.points[Math.min(street.points.length - 1, i + 1)];
      const normal = perp2(normalize2(sub2(b, a)));
      const p = street.points[i];
      const offset = street.width / 2 + style.pavement * 0.5;
      lamps.push({ x: p[0] + normal[0] * side * offset, z: p[1] + normal[1] * side * offset });
      side = -side;
    }
  }
  return lamps;
}

/**
 * Lay out one settlement.
 *
 * @param {object} options
 * @param {string} options.id stable id, part of the seed
 * @param {string} [options.kind] one of `SETTLEMENT_KIND`
 * @param {[number, number]} options.center world `[x, z]`
 * @param {number} [options.radius] how far the settlement reaches, metres
 * @param {number} [options.seed] settlement seed
 * @param {{height: (x: number, z: number) => number, seaLevel?: number, riverDistance?: (x: number, z: number) => number}|null} [options.terrain]
 * @param {object[]} [options.roads] `RouteGeometry` roads near the settlement
 * @returns {{id: string, kind: string, center: number[], frame: {u: number[], v: number[]}, radius: number, pavement: number, streetWidth: number, garden: number, streets: object[], junctions: object[], blocks: object[], plots: object[], square: object|null, lamps: object[], props: object[], quay: object|null, boats: object[]}}
 */
export function layoutSettlement({ id = "settlement", kind = SETTLEMENT_KIND.village, center, radius = 220, seed = 0, terrain = null, roads = [] }) {
  const style = SETTLEMENT_STYLE[kind] ?? SETTLEMENT_STYLE.village;
  const random = seededRandom((hash(id) ^ (seed >>> 0)) >>> 0);
  const nearest = nearestRoad(roads, center[0], center[1]);
  const u = nearest?.u ?? [1, 0];
  const v = nearest?.v ?? [0, 1];
  const local = (a, b) => [center[0] + u[0] * a + v[0] * b, center[1] + u[1] * a + v[1] * b];
  const toLocal = (x, z) => {
    const d = sub2([x, z], center);
    return [d[0] * u[0] + d[1] * u[1], d[0] * v[0] + d[1] * v[1]];
  };
  const sea = terrain?.seaLevel;
  const onLand = (x, z) => !Number.isFinite(sea) || terrain.height(x, z) >= sea + 1.2;
  const ctx = { id, kind, style, center, radius, terrain, nearest, u, v, local, toLocal, onLand };

  const { streets, junctions, blocks, uMax } = layoutStreets(ctx);
  const { square, props } = layoutSquare(ctx, random);
  const harbour = layoutQuay(ctx);
  props.push(...harbour.props);
  const lamps = layoutLamps(ctx, streets, junctions, toLocal, local);
  const surface = roadSamples(roads, center, radius * 1.6, style.pavement);
  const plots = layoutPlots(ctx, { streets, square, surface }, random);

  // A windmill on the edge of the settlement, as a landmark.
  if (style.blocks) {
    const edge = local(uMax + style.block * 0.4, random() < 0.5 ? -style.block : style.block);
    props.push({ role: "windmills", x: edge[0], z: edge[1], yaw: random() * Math.PI * 2, radius: 6 });
  }
  // A prop in the water or on a road that crosses the town is not part of the layout, so the map and world agree.
  const offRoad = (prop) => !surface.some((s) => Math.hypot(s.x - prop.x, s.z - prop.z) < s.clear + (prop.radius ?? 2));
  const dryProps = props.filter((prop) => onLand(prop.x, prop.z) && offRoad(prop));

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
    props: dryProps,
    quay: harbour.quay,
    boats: harbour.boats,
  };
}
