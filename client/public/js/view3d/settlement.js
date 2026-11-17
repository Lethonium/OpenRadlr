/**
 * Builds a laid-out settlement (#117): street ribbons, pavements, junction
 * pads, the market square, houses and the props that make it a place.
 *
 * `layoutSettlement` (`land/settlement.js`) decides *what* stands where; this
 * module only turns that data into meshes and instances. It runs in the world
 * worker, so it has no DOM and no clock, and the layout it receives is the
 * only source of randomness that matters.
 */
import { MeshBuilder, appendInstance } from "./meshBuilder.js";
import { placement } from "./math.js";
import { seededRandom } from "./noise.js";

const TAU = Math.PI * 2;

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const length2 = (v) => Math.hypot(v[0], v[1]) || 1;
const normalize2 = (v) => [v[0] / length2(v), v[1] / length2(v)];
const perp2 = (v) => [-v[1], v[0]];

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Lowest terrain height under a rectangular footprint, so nothing floats. */
function groundUnder(terrain, x, z, yaw, width, depth) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let low = Infinity;
  for (const [lx, lz] of [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [-width / 2, depth / 2],
    [width / 2, depth / 2],
    [0, 0],
  ]) {
    low = Math.min(low, terrain.height(x + lx * c + lz * s, z - lx * s + lz * c));
  }
  return low;
}

/** A flat ribbon along a polyline, following the ground. */
function ribbon(mesh, points, width, color, terrain, { lift = 0.02, skip = null } = {}) {
  if (points.length < 2) return;
  const half = width / 2;
  const at = (p) => [p[0], terrain.height(p[0], p[1]) + lift, p[1]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (skip?.((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
    const dir = normalize2(sub2(b, a));
    const n = perp2(dir);
    const p1 = [a[0] + n[0] * half, a[1] + n[1] * half];
    const p2 = [a[0] - n[0] * half, a[1] - n[1] * half];
    const p3 = [b[0] - n[0] * half, b[1] - n[1] * half];
    const p4 = [b[0] + n[0] * half, b[1] + n[1] * half];
    mesh.triangleFacing(at(p1), at(p2), at(p3), color, [0, 1, 0]);
    mesh.triangleFacing(at(p1), at(p3), at(p4), color, [0, 1, 0]);
  }
}

/** A paved pad where two streets meet, so the ribbons do not leave a seam. */
function pad(mesh, x, z, radius, color, terrain, segments = 14) {
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * TAU;
    const b = ((i + 1) / segments) * TAU;
    const p1 = [x + Math.cos(a) * radius, terrain.height(x + Math.cos(a) * radius, z + Math.sin(a) * radius) + 0.04, z + Math.sin(a) * radius];
    const p2 = [x + Math.cos(b) * radius, terrain.height(x + Math.cos(b) * radius, z + Math.sin(b) * radius) + 0.04, z + Math.sin(b) * radius];
    mesh.triangleFacing([x, terrain.height(x, z) + 0.04, z], p1, p2, color, [0, 1, 0]);
  }
}

/** The square's paving, as a grid in the settlement's own frame. */
function paveSquare(mesh, square, frame, center, terrain, color, step = 4) {
  const local = (a, b) => [center[0] + frame.u[0] * a + frame.v[0] * b, center[1] + frame.u[1] * a + frame.v[1] * b];
  const corner = (a, b) => {
    const p = local(a, b);
    return [p[0], terrain.height(p[0], p[1]) + 0.25, p[1]];
  };
  for (let a = square.a0; a < square.a1; a += step) {
    const a1 = Math.min(square.a1, a + step);
    for (let b = square.b0; b < square.b1; b += step) {
      const b1 = Math.min(square.b1, b + step);
      const p0 = corner(a, b);
      const p1 = corner(a1, b);
      const p2 = corner(a1, b1);
      const p3 = corner(a, b1);
      mesh.triangleFacing(p0, p1, p2, color, [0, 1, 0]);
      mesh.triangleFacing(p0, p2, p3, color, [0, 1, 0]);
    }
  }
}

/** The smallest house model that fits a plot, or the smallest one after a few tries. */
function houseFor(kit, plot, random) {
  if (!kit?.has?.("houses")) return null;
  let best = null;
  for (let i = 0; i < 5; i += 1) {
    const model = kit.model("houses", random);
    if (!model) break;
    const width = model.bounds.max[0] - model.bounds.min[0];
    const depth = model.bounds.max[2] - model.bounds.min[2];
    const score = Math.max(width - plot.width, depth - plot.depth);
    if (!best || score < best.score) best = { model, width, depth, score };
    if (score <= 0.8) break;
  }
  return best && best.score <= 2.5 ? best : null;
}

/**
 * Turn a layout into the world.
 *
 * @param {object} layout from `layoutSettlement`
 * @param {object} options
 * @param {object} options.terrain world terrain
 * @param {object} options.structures chunked mesh for streets, pads and paving
 * @param {object} options.bright chunked mesh for lamp heads
 * @param {{near: object, far?: object, trees?: object}} options.into building groups
 * @param {object} options.biome season
 * @param {object|null} [options.kit] the scenery kit (houses, church, props)
 * @param {object|null} [options.flora] the scenery flora, for garden trees
 * @param {object|null} [options.occupancy] existing occupancy
 * @returns {{houses: number, props: number, lamps: number}}
 */
export function buildSettlement(layout, {
  terrain,
  structures,
  bright,
  into,
  biome,
  kit = null,
  flora = null,
  occupancy = null,
  water = -Infinity,
} = {}) {
  if (!layout || !terrain || !structures || !into?.near) return { houses: 0, props: 0, lamps: 0 };
  const random = seededRandom((hash(layout.id) ^ 0x51e7) >>> 0);
  const palette = biome.palette;
  const roadColor = biome.road?.surface ?? [0.25, 0.26, 0.28];
  const pavement = layout.pavement ?? 2.2;
  let houses = 0;
  let props = 0;
  let lamps = 0;

  // Streets, pavements and junctions. A new street stops short of an existing
  // road: the existing asphalt is the junction, and a ribbon laid over it
  // would z-fight.
  const nearExisting = (x, z) => terrain.distanceToRoad(x, z) < 8;
  for (const street of layout.streets) {
    if (street.draw === false) continue;
    const skip = street.existing ? null : nearExisting;
    if (!street.existing) ribbon(structures, street.points, street.width, roadColor, terrain, { skip });
    const walk = street.pavement ?? pavement;
    for (const side of [-1, 1]) {
      const offset = street.width / 2 + walk / 2;
      const points = street.points.map((p, i) => {
        const a = street.points[Math.max(0, i - 1)];
        const b = street.points[Math.min(street.points.length - 1, i + 1)];
        const n = perp2(normalize2(sub2(b, a)));
        return [p[0] + n[0] * side * offset, p[1] + n[1] * side * offset];
      });
      ribbon(structures, points, walk, palette.pavement, terrain, { lift: 0.14, skip });
    }
  }
  for (const junction of layout.junctions) pad(structures, junction.x, junction.z, junction.radius, roadColor, terrain);

  if (layout.square) paveSquare(structures, layout.square, layout.frame, layout.center, terrain, palette.pavement);

  // A harbour's quay, jetty and boats. The quay is a paved strip along the
  // shore; the boats sit on the water surface, not the ground.
  if (layout.quay) {
    const { quay } = layout;
    const along = [-Math.sin(quay.yaw), -Math.cos(quay.yaw)];
    const across = quay.sea;
    const corner = (a, b) => {
      const x = quay.x + along[0] * a + across[0] * b;
      const z = quay.z + along[1] * a + across[1] * b;
      return [x, terrain.height(x, z) + 0.2, z];
    };
    const p0 = corner(-quay.length / 2, -quay.width / 2);
    const p1 = corner(quay.length / 2, -quay.width / 2);
    const p2 = corner(quay.length / 2, quay.width / 2);
    const p3 = corner(-quay.length / 2, quay.width / 2);
    structures.triangleFacing(p0, p1, p2, palette.pavement, [0, 1, 0]);
    structures.triangleFacing(p0, p2, p3, palette.pavement, [0, 1, 0]);
    // Bollards along the sea edge.
    for (let a = -quay.length / 2 + 5; a <= quay.length / 2 - 5; a += 8) {
      const x = quay.x + along[0] * a + across[0] * (quay.width / 2 - 0.4);
      const z = quay.z + along[1] * a + across[1] * (quay.width / 2 - 0.4);
      structures.box([x, terrain.height(x, z) + 0.45, z], [0.28, 0.9, 0.28], palette.stoneDark);
    }
    // A jetty into the water and four boats.
    const jetty = new MeshBuilder();
    jetty.box([0, 0, 0], [2.2, 0.16, 10], [0.45, 0.32, 0.2]);
    const jettyX = quay.x + across[0] * (quay.width / 2 + 5);
    const jettyZ = quay.z + across[1] * (quay.width / 2 + 5);
    structures.append(jetty.build(), placement([jettyX, water + 0.35, jettyZ], Math.atan2(-across[0], -across[1])));
    const boat = new MeshBuilder();
    boat.box([0, 0.35, 0], [3.2, 0.7, 1.4], [0.82, 0.82, 0.8]);
    boat.box([0, 0.8, 0], [2.2, 0.25, 1.0], [0.25, 0.3, 0.45]);
    boat.box([0, 2.0, 0], [0.1, 2.4, 0.1], [0.35, 0.28, 0.2]);
    const hull = boat.build();
    for (const b of layout.boats ?? []) {
      structures.append(hull, placement([b.x, water + 0.12, b.z], b.yaw));
    }
  }

  // Houses along the plots. The kit supplies the models; without one, the
  // biome's own house keeps the city visible in a world without a town kit.
  for (const plot of layout.plots) {
    const picked = houseFor(kit, plot, random);
    const model = picked?.model ?? null;
    const width = picked?.width ?? Math.min(plot.width * 0.82, 10);
    const depth = picked?.depth ?? Math.min(plot.depth * 0.62, 9);
    const facing = plot.facing;
    const pos = [
      plot.x + facing[0] * (plot.depth - depth) / 2,
      plot.z + facing[1] * (plot.depth - depth) / 2,
    ];
    if (occupancy?.blocked?.(pos[0], pos[1], Math.max(width, depth) * 0.45)) continue;
    const y = groundUnder(terrain, pos[0], pos[1], plot.yaw, width, depth);
    // A coastal plot can be on land at its centre and over the drop at its
    // seaward corner; a house standing in the water is never right.
    if (Number.isFinite(water) && y < water + 1) continue;
    const matrix = placement([pos[0], y, pos[1]], plot.yaw);
    if (model) {
      appendInstance(into.near, model.near, matrix);
      if (model.far && into.far) appendInstance(into.far, model.far, matrix);
    } else {
      const house = biome.models.house({
        w: width,
        d: depth,
        floors: 2,
        wall: palette.walls[Math.floor(random() * palette.walls.length)],
        roof: palette.roofs[Math.floor(random() * palette.roofs.length)],
        chimney: random() < 0.5,
      });
      structures.append(house, matrix);
    }
    occupancy?.add?.(pos[0], pos[1], Math.max(width, depth) * 0.45);
    houses += 1;
    // A garden tree behind every fifth house near the centre, where the kit
    // has one. The city is a town, not a wood; the trees are a garnish.
    if (flora && into.trees && houses % 5 === 0 && Math.hypot(pos[0] - layout.center[0], pos[1] - layout.center[1]) < 150) {
      const bx = pos[0] - facing[0] * (depth / 2 + 3);
      const bz = pos[1] - facing[1] * (depth / 2 + 3);
      // A garden tree, not a wood tree: the kit's mature trees are 9–12 m, and
      // a house's back garden wants half of that.
      flora.tree({ mesh: into.trees, x: bx, y: terrain.height(bx, bz), z: bz, kind: 0.9, random, role: "leafy", scale: 0.45 });
    }
  }

  // Props: the square, the church, the windmill.
  for (const prop of layout.props) {
    if (occupancy?.blocked?.(prop.x, prop.z, prop.radius ?? 2)) continue;
    const picked = kit?.model?.(prop.role, random) ?? null;
    if (!picked) {
      if (prop.role === "church" && biome.models.church) {
        const y = groundUnder(terrain, prop.x, prop.z, prop.yaw, 10, 18);
        if (Number.isFinite(water) && y < water + 1) continue;
        structures.append(biome.models.church(), placement([prop.x, y, prop.z], prop.yaw));
        occupancy?.add?.(prop.x, prop.z, prop.radius ?? 7);
        props += 1;
      }
      continue;
    }
    const width = picked.bounds.max[0] - picked.bounds.min[0];
    const depth = picked.bounds.max[2] - picked.bounds.min[2];
    const y = groundUnder(terrain, prop.x, prop.z, prop.yaw, width, depth);
    if (Number.isFinite(water) && y < water + 1) continue;
    const matrix = placement([prop.x, y, prop.z], prop.yaw);
    appendInstance(into.near, picked.near, matrix);
    if (picked.far && into.far) appendInstance(into.far, picked.far, matrix);
    occupancy?.add?.(prop.x, prop.z, Math.max(width, depth) * 0.5);
    props += 1;
  }

  // Lamps: the biome's street lamp, with its head in the bright group.
  if (biome.models.lamp) {
    const lamp = biome.models.lamp();
    for (const spot of layout.lamps) {
      const y = terrain.height(spot.x, spot.z);
      const matrix = placement([spot.x, y, spot.z], random() * TAU);
      structures.append(lamp.pole, matrix);
      bright?.append?.(lamp.head, matrix);
      lamps += 1;
    }
  }

  return { houses, props, lamps };
}
