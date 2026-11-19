// Builds the village kit from Kenney's Fantasy Town Kit (#117).
//
//   node tools/scenery/assemble.mjs <pack "GLB format" dir> <out dir>
//   node tools/scenery/assemble.mjs --cathedral-only <kit dir>   (adds just the cathedral, no pack needed)
//
// The pack is a modular kit on a one-unit grid: a wall panel stands on the +x
// edge of its tile, one panel is one storey, and a roof tile is one slope with
// its ridge on the +x edge. Parts keep the pack's own origin when imported, so
// laying them out tile by tile gives a house whose walls meet. A cottage is a
// combination of the pack's models, recoloured, not a new model; the pack's
// CC0 licence covers it.
//
// Every building is written twice: `<name>.geo.json` to draw up close and
// `<name>-far.geo.json`, a box and a roof in the same colours, for distance.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importGlb, writeModel } from "./import.mjs";

/** Metres per kit tile. A door is 0.75 of a tile, so 2.25 m. */
export const TILE = 3;

/** The pack's own colours that a building takes from its palette (rounded to 2 places). */
const ROOF_COLOURS = ["0.40,0.78,0.70", "0.95,0.33,0.35"];
const ROOF_EDGE_COLOURS = ["0.32,0.73,0.52", "0.93,0.73,0.53"];
const WALL_COLOURS = ["0.77,0.81,0.97"];

/** Roofs and walls a temperate village is built in: tile, slate and render. */
export const ROOFS = Object.freeze({
  tile: [0.74, 0.34, 0.25],
  brown: [0.52, 0.29, 0.22],
  slate: [0.36, 0.39, 0.45],
  moss: [0.42, 0.5, 0.36],
});
export const WALLS = Object.freeze({
  cream: [0.94, 0.89, 0.78],
  white: [0.95, 0.94, 0.91],
  ochre: [0.92, 0.8, 0.6],
  rose: [0.92, 0.79, 0.74],
  stone: [0.78, 0.76, 0.72],
});

/** The named parts from `dir`, as triangles in tile units at the pack's own origin. */
export function loadParts(dir, names) {
  const parts = {};
  for (const name of names) {
    parts[name] = importGlb(readFileSync(join(dir, `${name}.glb`)), { name, baseDir: dir, origin: "keep" }).triangles;
  }
  return parts;
}

/**
 * Appends `tris` moved to tile `(x, y, z)` and turned by `quarter` quarter
 * turns about the vertical: one turn takes +x to -z. `grow` sizes the part
 * about its own origin first.
 */
export function put(out, tris, [x, y, z], quarter = 0, grow = 1) {
  const a = (quarter * Math.PI) / 2;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  for (const t of tris) {
    const px = t[0] * grow;
    const pz = t[2] * grow;
    out.push([px * c + pz * s + x, t[1] * grow + y, -px * s + pz * c + z, t[3], t[4], t[5]]);
  }
}

const key = (r, g, b) => `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}`;

/** The pack's roof and wall colours swapped for `roof` and `wall`; the timber keeps its own. */
export function recoloured(tris, { roof = null, wall = null } = {}) {
  return tris.map((t) => {
    const k = key(t[3], t[4], t[5]);
    if (roof && ROOF_COLOURS.includes(k)) return [t[0], t[1], t[2], ...roof];
    if (roof && ROOF_EDGE_COLOURS.includes(k)) return [t[0], t[1], t[2], ...roof.map((c) => c * 0.82)];
    if (wall && WALL_COLOURS.includes(k)) return [t[0], t[1], t[2], ...wall];
    return t;
  });
}

/** The parts each style of wall is built from. */
const STYLES = Object.freeze({
  render: { plain: "wall", door: "wall-door", windows: ["wall-window-small", "wall-window-glass"] },
  timber: { plain: "wall-wood", door: "wall-wood-door", windows: ["wall-wood-window-shutters", "wall-wood-window-small"] },
});

/** Every part the kit's buildings are made of. */
export const PARTS = Object.freeze([
  ...new Set([
    ...Object.values(STYLES).flatMap((s) => [s.plain, s.door, ...s.windows]),
    "roof", "roof-left", "roof-right", "roof-window",
    "roof-high", "roof-high-left", "roof-high-right", "roof-high-window", "roof-high-point",
    "chimney", "wall-window-round", "wall-doorway-round", "windmill",
  ]),
]);

/** Appends `parts` turned and moved, then recoloured: the last step of every building. */
function finished(tris, { roof, wall }) {
  return recoloured(tris, { roof, wall });
}

/**
 * A cottage two tiles deep and `length` tiles long, its door facing -z: the
 * side `placement` turns towards the road.
 *
 * Laid out with the ridge along z and the front on +x, then turned a quarter
 * so the eaves face the street. `gable: true` puts the door in the -z gable
 * end instead and is not turned, the way a town house stands with its gable
 * to the street.
 *
 * @returns {number[][]} triangles in tile units, footprint centred on the origin
 */
export function cottage(parts, { length = 3, floors = 1, ground = "render", upper = ground, high = false, dormer = false, gable = false, roof = ROOFS.tile, wall = WALLS.cream } = {}) {
  const out = [];
  const zs = Array.from({ length }, (_, i) => i - (length - 1) / 2);
  const [zMin, zMax] = [zs[0], zs.at(-1)];
  const middle = zs[Math.floor((length - 1) / 2)];
  for (let floor = 0; floor < floors; floor += 1) {
    const style = STYLES[floor === 0 ? ground : upper];
    const window = (i) => style.windows[(i + floor) % style.windows.length];
    // Upstairs every bay has a window; downstairs every other one, so a facade is not a grid.
    const bay = (i, doorHere) => (doorHere && floor === 0 ? style.door : floor > 0 || i % 2 === 0 ? window(i) : style.plain);
    zs.forEach((z, i) => {
      put(out, parts[bay(i, !gable && z === middle)], [0.5, floor, z], 0);
      put(out, parts[i % 2 === 0 ? window(i + 1) : style.plain], [-0.5, floor, z], 2);
    });
    // The gable ends, two bays each.
    put(out, parts[gable && floor === 0 ? style.door : floor > 0 ? window(1) : style.plain], [0.5, floor, zMin], 1);
    put(out, parts[floor > 0 || gable ? window(0) : style.plain], [-0.5, floor, zMin], 1);
    put(out, parts[floor > 0 ? window(0) : style.plain], [0.5, floor, zMax], 3);
    put(out, parts[style.plain], [-0.5, floor, zMax], 3);
  }
  const slope = high ? "roof-high" : "roof";
  for (const z of zs) {
    const end = z === zMin ? "min" : z === zMax ? "max" : null;
    const front = end === "min" ? `${slope}-right` : end === "max" ? `${slope}-left` : dormer && z === middle ? `${slope}-window` : slope;
    const back = end === "min" ? `${slope}-left` : end === "max" ? `${slope}-right` : slope;
    put(out, parts[front], [0.5, floors, z], 2);
    put(out, parts[back], [-0.5, floors, z], 0);
  }
  put(out, parts.chimney, [-0.6, floors - 0.15, zMax], 0, 1.2);
  const turned = [];
  put(turned, out, [0, 0, 0], gable ? 0 : 1);
  return finished(turned, { roof, wall });
}

/**
 * A village church: a nave under a steep roof with round-headed windows, and
 * a tower over the door at its -z end, with a spire.
 */
export function church(parts, { roof = ROOFS.slate, wall = WALLS.stone, length = 4, towerFloors = 4 } = {}) {
  const out = [];
  const zs = Array.from({ length }, (_, i) => i - (length - 1) / 2 + 0.5);
  const [zMin, zMax] = [zs[0], zs.at(-1)];
  for (const floor of [0, 1]) {
    for (const z of zs) {
      put(out, parts[floor === 0 ? "wall-window-round" : "wall"], [0.5, floor, z], 0);
      put(out, parts[floor === 0 ? "wall-window-round" : "wall"], [-0.5, floor, z], 2);
    }
    for (const x of [0.5, -0.5]) {
      put(out, parts.wall, [x, floor, zMax], 3);
      put(out, parts.wall, [x, floor, zMin], 1);
    }
  }
  for (const z of zs) {
    const end = z === zMin ? "min" : z === zMax ? "max" : null;
    put(out, parts[end === "min" ? "roof-high-right" : end === "max" ? "roof-high-left" : "roof-high"], [0.5, 2, z], 2);
    put(out, parts[end === "min" ? "roof-high-left" : end === "max" ? "roof-high-right" : "roof-high"], [-0.5, 2, z], 0);
  }
  // The tower: one tile square in front of the nave, its door facing -z.
  const tz = zMin - 1;
  for (let floor = 0; floor < towerFloors; floor += 1) {
    const top = floor === towerFloors - 1;
    put(out, parts[floor === 0 ? "wall-doorway-round" : top ? "wall-window-round" : "wall"], [0, floor, tz], 1);
    put(out, parts[top ? "wall-window-round" : "wall"], [0, floor, tz], 0);
    put(out, parts[top ? "wall-window-round" : "wall"], [0, floor, tz], 2);
    // Below the nave's roof the tower's back is the nave's own end wall.
    if (floor >= 2) put(out, parts[top ? "wall-window-round" : "wall"], [0, floor, tz], 3);
  }
  put(out, parts["roof-high-point"], [0, towerFloors, tz], 0, 1.05);
  return finished(out, { roof, wall });
}

/** A windmill: a tower three storeys high, a pointed cap and its sails on the -z face. */
export function windmill(parts, { roof = ROOFS.tile, wall = WALLS.white } = {}) {
  const out = [];
  for (let floor = 0; floor < 3; floor += 1) {
    const style = STYLES[floor === 0 ? "render" : "timber"];
    for (const q of [0, 1, 2, 3]) {
      const face = q === 3 && floor === 0 ? style.door : (q + floor) % 2 === 0 ? style.windows[0] : style.plain;
      put(out, parts[face], [0, floor, 0], q);
    }
  }
  put(out, parts["roof-high-point"], [0, 3, 0], 0, 1.1);
  // The sails turn about x in the pack; a quarter turn sets them on the -z face.
  put(out, parts.windmill, [0, 2.4, -0.82], 1, 1.25);
  return finished(out, { roof, wall });
}

/**
 * A building's far twin: a box to the eaves and a ridge roof over it, in the
 * building's own wall and roof colours. A dozen faces where the model has a
 * thousand, and from a few hundred metres the eye cannot tell.
 *
 * `ridge` is the axis the ridge runs along ("x" or "z"); `eaves` and `top`
 * are the heights of the walls and the ridge, in metres.
 */
export function farTwin({ bounds, eaves, top, ridge = "x", wall, roof }) {
  const [x0, , z0] = bounds.min;
  const [x1, , z1] = bounds.max;
  const t = [];
  const tri = (a, b, c, colour) => t.push([...a, ...colour], [...b, ...colour], [...c, ...colour]);
  const quad = (a, b, c, d, colour) => {
    tri(a, b, c, colour);
    tri(a, c, d, colour);
  };
  quad([x0, 0, z1], [x1, 0, z1], [x1, eaves, z1], [x0, eaves, z1], wall);
  quad([x1, 0, z0], [x0, 0, z0], [x0, eaves, z0], [x1, eaves, z0], wall);
  quad([x1, 0, z1], [x1, 0, z0], [x1, eaves, z0], [x1, eaves, z1], wall);
  quad([x0, 0, z0], [x0, 0, z1], [x0, eaves, z1], [x0, eaves, z0], wall);
  if (ridge === "x") {
    const zm = (z0 + z1) / 2;
    quad([x0, eaves, z1], [x1, eaves, z1], [x1, top, zm], [x0, top, zm], roof);
    quad([x1, eaves, z0], [x0, eaves, z0], [x0, top, zm], [x1, top, zm], roof);
    tri([x1, eaves, z1], [x1, eaves, z0], [x1, top, zm], wall);
    tri([x0, eaves, z0], [x0, eaves, z1], [x0, top, zm], wall);
  } else {
    const xm = (x0 + x1) / 2;
    quad([x1, eaves, z1], [x1, eaves, z0], [xm, top, z0], [xm, top, z1], roof);
    quad([x0, eaves, z0], [x0, eaves, z1], [xm, top, z1], [xm, top, z0], roof);
    tri([x0, eaves, z1], [x1, eaves, z1], [xm, top, z1], wall);
    tri([x1, eaves, z0], [x0, eaves, z0], [xm, top, z0], wall);
  }
  return t;
}

const q = (v) => Math.round(v * 100) / 100 + 0;

/** Triangles in tile units → a model in metres, standing on the ground, centred on its footprint (of `frame`, when a twin shares its original's). */
export function modelOf(name, tris, scale = TILE, frame = tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of frame) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  }
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const triangles = tris.map(([x, y, z, r, g, b]) => [q((x - cx) * scale), q((y - min[1]) * scale), q((z - cz) * scale), q(r), q(g), q(b)]);
  const bounds = { min: [q((min[0] - cx) * scale), 0, q((min[2] - cz) * scale)], max: [q((max[0] - cx) * scale), q((max[1] - min[1]) * scale), q((max[2] - cz) * scale)] };
  return { name, triangles, bounds, vertices: triangles.length };
}

/**
 * A building and its far twin. The twin's box stops at the walls, not at the
 * roof's overhang, and its ridge at the building's own height.
 */
export function building(name, tris, { floors, high = false, ridge = "x", wall, roof }) {
  const near = modelOf(name, tris);
  const inset = 0.25;
  const bounds = {
    min: [near.bounds.min[0] + inset, 0, near.bounds.min[2] + inset],
    max: [near.bounds.max[0] - inset, 0, near.bounds.max[2] - inset],
  };
  const eaves = floors * TILE;
  const top = Math.min(near.bounds.max[1], eaves + (high ? 1.11 : 0.63) * TILE);
  const triangles = farTwin({ bounds, eaves, top, ridge, wall, roof });
  return { near, far: { name: `${name}-far`, triangles, bounds: near.bounds, vertices: triangles.length } };
}

/** What the cathedral's glass and portal are made of. */
const GLASS = [0.32, 0.4, 0.55];
const OAK = [0.35, 0.2, 0.12];

/**
 * The market city's cathedral, in metres: one oversized church, about twice
 * the village church's height. The pack has no such building, so it is drawn
 * here in the kit's own stone and slate rather than from its tiles: a long
 * nave under a steep slate roof, a transept with a small spire over the
 * crossing, an eight-sided apse at +z and two west towers with spires at -z
 * around a portal and a rose window, the way the church's door faces the
 * square.
 *
 * @returns {{near: number[][], far: number[][]}} triangles in metres, origin where it was drawn
 */
export function cathedralTriangles({ wall = WALLS.stone, roof = ROOFS.slate } = {}) {
  const edge = roof.map((c) => c * 0.82);
  const dark = wall.map((c) => c * 0.88);
  const light = wall.map((c) => Math.min(1, c * 1.06));
  const near = [];
  const far = [];
  const NAVE = 5;
  const WALL_TOP = 11;
  const RIDGE = 17;
  const TOWERS = [1.5, 6.5];
  const APSE = { z: 12, r: 5 };

  /** The shapes, drawn into `out`; counter-clockwise from outside. */
  const shapes = (out) => {
    const tri = (a, b, c, colour) => out.push([...a, ...colour], [...b, ...colour], [...c, ...colour]);
    const quad = (a, b, c, d, colour) => {
      tri(a, b, c, colour);
      tri(a, c, d, colour);
    };
    return {
      tri,
      quad,
      /** Four walls, and the top when `cap`. */
      box(x0, x1, y0, y1, z0, z1, colour, cap = false) {
        quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour);
        quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour);
        quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], colour);
        quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], colour);
        if (cap) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colour);
      },
      /** A four-sided spire over a square. */
      spire(x0, x1, z0, z1, y0, apex) {
        const xm = (x0 + x1) / 2;
        const zm = (z0 + z1) / 2;
        tri([x0, y0, z1], [x1, y0, z1], [xm, apex, zm], roof);
        tri([x1, y0, z0], [x0, y0, z0], [xm, apex, zm], roof);
        tri([x1, y0, z1], [x1, y0, z0], [xm, apex, zm], edge);
        tri([x0, y0, z0], [x0, y0, z1], [xm, apex, zm], edge);
      },
      /** A gabled roof from `base` to `top`; the ridge runs along z or x, the gable walls are stone. */
      gable(x0, x1, z0, z1, base, top, ridge) {
        const o = 0.35;
        if (ridge === "z") {
          const xm = (x0 + x1) / 2;
          quad([x1 + o, base - 0.3, z1], [x1 + o, base - 0.3, z0], [xm, top, z0], [xm, top, z1], roof);
          quad([x0 - o, base - 0.3, z0], [x0 - o, base - 0.3, z1], [xm, top, z1], [xm, top, z0], edge);
          tri([x0, base, z1], [x1, base, z1], [xm, top, z1], wall);
          tri([x1, base, z0], [x0, base, z0], [xm, top, z0], wall);
        } else {
          const zm = (z0 + z1) / 2;
          quad([x0, base - 0.3, z1 + o], [x1, base - 0.3, z1 + o], [x1, top, zm], [x0, top, zm], roof);
          quad([x1, base - 0.3, z0 - o], [x0, base - 0.3, z0 - o], [x0, top, zm], [x1, top, zm], edge);
          tri([x1, base, z1], [x1, base, z0], [x1, top, zm], wall);
          tri([x0, base, z0], [x0, base, z1], [x0, top, zm], wall);
        }
      },
      /**
       * A pointed window flat on a wall: `centre` is a point on the wall at the
       * sill, `normal` its outward horizontal unit vector.
       */
      window(centre, normal, y0, y1, half, colour = GLASS) {
        const u = [normal[2], 0, -normal[0]]; // up x normal: to the viewer's right
        const at = (s, y) => [centre[0] + normal[0] * 0.06 + u[0] * s, y, centre[2] + normal[2] * 0.06 + u[2] * s];
        const shoulder = y1 - half * 1.3;
        quad(at(-half, y0), at(half, y0), at(half, shoulder), at(-half, shoulder), colour);
        tri(at(-half, shoulder), at(half, shoulder), at(0, y1), colour);
      },
    };
  };

  const n = shapes(near);
  // Nave z -11..12 and transept z 2..10 under the same ridge.
  n.box(-NAVE, NAVE, 0, WALL_TOP, -11, 12, wall);
  n.gable(-NAVE, NAVE, -11, 12, WALL_TOP, RIDGE, "z");
  n.box(-9, 9, 0, WALL_TOP, 2, 10, wall);
  n.gable(-9, 9, 2, 10, WALL_TOP, RIDGE, "x");
  for (const z of [-9.5, -5.5, -1.5]) {
    n.box(NAVE, NAVE + 0.7, 0, 9, z - 0.3, z + 0.3, dark, true);
    n.box(-NAVE - 0.7, -NAVE, 0, 9, z - 0.3, z + 0.3, dark, true);
  }
  for (const z of [-7.5, -3.5, 0.5]) {
    n.window([NAVE, 0, z], [1, 0, 0], 3.2, 9.4, 0.8);
    n.window([-NAVE, 0, z], [-1, 0, 0], 3.2, 9.4, 0.8);
  }
  for (const side of [-1, 1]) n.window([side * 9, 0, 6], [side, 0, 0], 3.5, 12.5, 1.1);
  // The apse: half an octagon of wall under a cone.
  const ring = (a) => [Math.cos(a) * APSE.r, Math.sin(a) * APSE.r + APSE.z];
  for (let i = 0; i < 4; i += 1) {
    const [x0, z0] = ring((i * Math.PI) / 4);
    const [x1, z1] = ring(((i + 1) * Math.PI) / 4);
    n.quad([x1, 0, z1], [x0, 0, z0], [x0, WALL_TOP, z0], [x1, WALL_TOP, z1], wall);
    const grow = (x, z) => [x * 1.08, WALL_TOP - 0.3, APSE.z + (z - APSE.z) * 1.08];
    n.tri(...[[x1, z1], [x0, z0]].map(([x, z]) => grow(x, z)), [0, 17.5, APSE.z], i % 2 ? edge : roof);
    const mid = ((i + 0.5) * Math.PI) / 4;
    const [mx, mz] = ring(mid);
    n.window([mx, 0, mz], [Math.cos(mid), 0, Math.sin(mid)], 3.5, 8.8, 0.7);
  }
  // A lantern and small spire over the crossing.
  n.box(-1.6, 1.6, RIDGE - 0.5, RIDGE + 4, 4.4, 7.6, light, true);
  n.spire(-1.9, 1.9, 4.1, 7.9, RIDGE + 4, RIDGE + 11);
  // The west front: a narthex between the towers with the portal and a rose window.
  n.box(-TOWERS[0], TOWERS[0], 0, 9, -16, -11, wall);
  n.gable(-TOWERS[0], TOWERS[0], -16, -11, 9, 13.5, "z");
  n.quad([-1, 0, -16.05], [-1, 4.2, -16.05], [1, 4.2, -16.05], [1, 0, -16.05], OAK);
  n.tri([-1, 4.2, -16.05], [1, 4.2, -16.05], [0, 5.6, -16.05], OAK);
  for (let i = 0; i < 8; i += 1) {
    const [a0, a1] = [(i * Math.PI) / 4, ((i + 1) * Math.PI) / 4];
    n.tri([0, 10.6, -16.06], [Math.sin(a0) * 1.6, 10.6 + Math.cos(a0) * 1.6, -16.06], [Math.sin(a1) * 1.6, 10.6 + Math.cos(a1) * 1.6, -16.06], GLASS);
  }
  // The towers: stone to 24 m, light string courses, slits and belfry openings, a slate spire to 34 m.
  for (const side of [-1, 1]) {
    const [x0, x1] = [Math.min(side * TOWERS[0], side * TOWERS[1]), Math.max(side * TOWERS[0], side * TOWERS[1])];
    const xm = (x0 + x1) / 2;
    n.box(x0, x1, 0, 24, -16, -11, wall);
    for (const y of [11.6, 22.6]) n.box(x0 - 0.15, x1 + 0.15, y, y + 0.4, -16.15, -10.85, light, true);
    n.spire(x0 - 0.35, x1 + 0.35, -16.35, -10.65, 24, 34);
    for (const [y0, y1, half] of [[5, 9.5, 0.45], [16.5, 21.5, 0.9]]) {
      n.window([xm, 0, -16], [0, 0, -1], y0, y1, half);
      n.window([side > 0 ? x1 : x0, 0, -13.5], [side, 0, 0], y0, y1, half);
    }
  }

  // The far twin: the same masses with no detail, 52 triangles.
  const f = shapes(far);
  f.box(-NAVE, NAVE, 0, WALL_TOP, -11, 12, wall);
  f.gable(-NAVE, NAVE, -11, 12, WALL_TOP, RIDGE, "z");
  f.box(-9, 9, 0, WALL_TOP, 2, 10, wall);
  f.gable(-9, 9, 2, 10, WALL_TOP, RIDGE, "x");
  for (const side of [-1, 1]) {
    const [x0, x1] = [Math.min(side * TOWERS[0], side * TOWERS[1]), Math.max(side * TOWERS[0], side * TOWERS[1])];
    f.box(x0, x1, 0, 24, -16, -11, wall);
    f.spire(x0 - 0.35, x1 + 0.35, -16.35, -10.65, 24, 34);
  }
  return { near, far };
}

/** The cathedral and its far twin as kit models, both in the near model's frame. */
export function cathedral(options) {
  const { near, far } = cathedralTriangles(options);
  const model = modelOf("cathedral", near, 1);
  return { near: model, far: modelOf("cathedral-far", far, 1, near) };
}

/**
 * The houses the kit ships: one-storey cottages with their eaves to the
 * street, two-storey houses, and town houses with a steep gable to the street.
 * Few enough to download, varied enough that a row of them is not one house.
 */
export const COTTAGES = Object.freeze([
  { name: "cottage-a", length: 3, floors: 1, ground: "render", roof: ROOFS.tile, wall: WALLS.cream, dormer: true },
  { name: "cottage-b", length: 2, floors: 1, ground: "timber", roof: ROOFS.brown, wall: WALLS.white },
  { name: "cottage-c", length: 3, floors: 2, ground: "render", upper: "timber", roof: ROOFS.tile, wall: WALLS.white },
  { name: "cottage-d", length: 4, floors: 2, ground: "render", roof: ROOFS.slate, wall: WALLS.ochre },
  { name: "cottage-e", length: 3, floors: 1, ground: "render", roof: ROOFS.slate, wall: WALLS.rose, high: true },
  { name: "cottage-f", length: 2, floors: 2, ground: "render", upper: "timber", roof: ROOFS.tile, wall: WALLS.cream, high: true, gable: true },
  { name: "cottage-g", length: 3, floors: 2, ground: "timber", roof: ROOFS.brown, wall: WALLS.cream, high: true, gable: true, dormer: true },
  { name: "cottage-h", length: 2, floors: 1, ground: "render", roof: ROOFS.moss, wall: WALLS.stone },
]);

/** The pack's props a village uses as they are: the part, its name in the kit, and its role. */
export const PROPS = Object.freeze([
  { part: "fountain-round", name: "fountain", role: "fountains" },
  { part: "stall", name: "stall", role: "stalls" },
  { part: "stall-red", name: "stall-red", role: "stalls" },
  { part: "stall-green", name: "stall-green", role: "stalls" },
  { part: "stall-bench", name: "bench", role: "benches" },
  { part: "lantern", name: "lantern", role: "lanterns" },
  { part: "fence", name: "fence", role: "fences" },
  { part: "hedge", name: "hedge", role: "hedges" },
  { part: "cart", name: "cart", role: "carts" },
]);

export const PROVENANCE = Object.freeze({
  pack: "https://kenney.nl/assets/fantasy-town-kit",
  licence: "https://creativecommons.org/publicdomain/zero/1.0/",
  taken: "2026-11-16",
  note: "Kenney's Fantasy Town Kit 2.0, whose own License.txt says CC0 1.0. Cottages, the church and the windmill are assembled from the pack's parts by tools/scenery/assemble.mjs and recoloured; the props are the pack's models as they are. The cathedral is drawn in assemble.mjs in the same stone and slate, not taken from the pack.",
});

/** Every model of the kit and its manifest, built from the pack's GLB folder. */
export function buildKit(packDir) {
  const parts = loadParts(packDir, PARTS);
  const files = [];
  const models = {};
  const add = (name, role, tris, shape) => {
    const { near, far } = building(name, tris, shape);
    files.push(near, far);
    models[name] = { role, file: near.name, far: far.name };
  };
  for (const spec of COTTAGES) add(spec.name, "houses", cottage(parts, spec), { floors: spec.floors, high: spec.high, ridge: spec.gable ? "z" : "x", wall: spec.wall, roof: spec.roof });
  add("church", "church", church(parts), { floors: 2, high: true, ridge: "z", wall: WALLS.stone, roof: ROOFS.slate });
  add("windmill", "windmills", windmill(parts), { floors: 3, high: true, ridge: "x", wall: WALLS.white, roof: ROOFS.tile });
  for (const prop of PROPS) {
    const model = importGlb(readFileSync(join(packDir, `${prop.part}.glb`)), { name: prop.name, baseDir: packDir, scale: TILE });
    files.push(model);
    models[prop.name] = { role: prop.role, file: prop.name };
  }
  const crown = cathedral();
  files.push(crown.near, crown.far);
  models.cathedral = { role: "cathedral", file: crown.near.name, far: crown.far.name };
  return { files, manifest: { name: "fantasy-town", licence: "CC0-1.0", provenance: PROVENANCE, models } };
}

/**
 * Adds the cathedral to a kit already written to `outDir`, with no pack: it is
 * drawn here, not taken from the pack's tiles, so nothing else is touched.
 */
export function addCathedral(outDir) {
  const manifestPath = join(outDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const crown = cathedral();
  for (const model of [crown.near, crown.far]) writeModel(model, join(outDir, `${model.name}.geo.json`));
  manifest.provenance = PROVENANCE;
  manifest.models.cathedral = { role: "cathedral", file: crown.near.name, far: crown.far.name };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return crown;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [packDir, outDir] = process.argv.slice(2);
  if (packDir === "--cathedral-only" && outDir) {
    const { near, far } = addCathedral(outDir);
    console.log(`cathedral: ${near.triangles.length / 3} triangles, far ${far.triangles.length / 3}`);
    process.exit(0);
  }
  if (!packDir || !outDir) {
    console.error('usage: node tools/scenery/assemble.mjs <pack "GLB format" dir> <out dir>');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const { files, manifest } = buildKit(packDir);
  for (const model of files) {
    writeModel(model, join(outDir, `${model.name}.geo.json`));
    console.log(`${model.name}: ${model.triangles.length / 3} triangles`);
  }
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
