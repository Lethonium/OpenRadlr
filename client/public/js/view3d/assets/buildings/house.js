/**
 * A village house in four styles: cottage (pastel plaster, shutters, window
 * boxes), whitewashed (flat roofs, blue trim), timber (half-timbered, dark
 * roofs) and stone (sandstone walls, terracotta roofs). The door faces +z,
 * the ground is y = 0 with a plinth down to -0.55. Winter lays snow on the
 * roofs. Restyled from the reference's scenic house.
 */
import { box, colour, deepFreeze } from "../geom.js";
import { defineBuilding } from "./building.js";
import { gable, onWall, quad, facing } from "./shapes.js";

/** The style names, in the order the workbench lists them. */
export const HOUSE_STYLES = Object.freeze(["cottage", "whitewashed", "timber", "stone"]);

const SNOW = "#f1f5f9";
const GLASS = "#3d4a5c";

const PALETTE = deepFreeze({
  cottage: {
    walls: ["#f1ebdc", "#ebe0c8", "#f3eee3", "#e6dcc3", "#e9ded0"], roofs: ["#7a4a3a", "#625e5e", "#8a5238", "#5c6064"],
    wood: "#7a5233", shutters: ["#4a7550", "#7a4a2c", "#55708a"], frame: "#f4f1ea", stone: "#9a948a", door: "#6a4528", beams: null, pitch: 0.8, overhang: 0.7, upper: 0.35,
  },
  whitewashed: {
    walls: ["#f6f1e6", "#efe4cc", "#f3e3c3", "#f4efe4"], roofs: ["#b5603e", "#a5533a"],
    wood: "#8a6a4a", shutters: ["#3f7fa8", "#4f8a6a", "#2f6f9a"], frame: "#f6f1e6", stone: "#d8c9a8", door: "#3f6f8f", beams: null, pitch: 0.5, overhang: 0.45, flat: 0.5, upper: 0,
  },
  timber: {
    walls: ["#d6c8b0", "#c9b394", "#e0d4bc", "#c4a07a"], roofs: ["#4e4a46", "#5c4536", "#3f4448", "#6a4a3a"],
    wood: "#6a4a33", shutters: ["#5a3a28", "#3f5a3f"], frame: "#ece6d8", stone: "#8a8276", door: "#4a3220", beams: "#4a3424", pitch: 0.8, overhang: 0.6, upper: 0,
  },
  stone: {
    walls: ["#cdb48a", "#c8ae82", "#d3bc94", "#c2a97c"], roofs: ["#b8603c", "#a9573a", "#c06c46"],
    wood: "#7a5a3a", shutters: ["#4f6a4a", "#6a4a32"], frame: "#e6d6b4", stone: "#a89a80", door: "#5a3a24", beams: null, quoins: "#e0cda4", pitch: 0.45, overhang: 0.55, upper: 0,
  },
});

const FLOOR = 3;
const PLINTH = 0.3;

/** A window on a wall at (x, y, z) facing `yaw`: dark glass, a frame and sill when detailed, and the night pane. */
function windowAt(out, glows, style, x, y, z, yaw, { detail, shutter, flowers }) {
  const [nx, nz] = facing(yaw);
  const at = (push) => [x + nx * push, z + nz * push];
  const flat = (width, height, color, push) => out.push(quad(width, height, color, at(push)[0], y, at(push)[1], yaw));
  if (detail) flat(1.2, 1.45, colour(style.frame), 0.04);
  flat(0.95, 1.2, colour(GLASS), 0.06);
  glows.push(quad(0.95, 1.2, colour("#ffffff"), at(0.08)[0], y, at(0.08)[1], yaw));
  if (!detail) return;
  out.push(onWall(box(1.35, 0.1, 0.28, colour(style.stone)), ...[at(0.12)[0], y - 0.74, at(0.12)[1]], yaw));
  if (shutter) {
    for (const side of [-1, 1]) out.push(quad(0.5, 1.4, shutter, x + Math.cos(yaw) * side * 0.88 + nx * 0.07, y, z - Math.sin(yaw) * side * 0.88 + nz * 0.07, yaw));
  }
  if (flowers) {
    out.push(onWall(box(1.1, 0.24, 0.26, colour("#6a4a33")), at(0.2)[0], y - 0.6, at(0.2)[1], yaw));
    out.push(onWall(box(1.0, 0.14, 0.2, colour(flowers)), at(0.2)[0], y - 0.42, at(0.2)[1], yaw));
  }
}

/** Half-timbering on a facade: corner posts, a mid post and a band at every floor line. */
function beamsAt(out, style, w, h, zFace, yaw, floors) {
  const beam = colour(style.beams);
  const [, nz] = facing(yaw);
  const z = zFace + nz * 0.02;
  for (const x of [-w / 2 + 0.15, 0, w / 2 - 0.15]) out.push(quad(0.28, h, beam, x, h / 2 + PLINTH, z, yaw));
  for (let f = 0; f <= floors; f += 1) out.push(quad(w, 0.24, beam, 0, PLINTH + 0.12 + Math.min(f * FLOOR, h - 0.24), z, yaw));
}

/** The pitched or flat roof with its snow. Returns the near and far pieces. */
function roofOf(style, { w, d, top, flat, snowy, color, wall, rise, detail }) {
  const near = [];
  const oh = style.overhang;
  if (flat) {
    near.push(box(w + 0.2, 0.3, d + 0.2, colour(style.frame), 0, top + 0.15, 0));
    near.push(box(w * 0.35, 2.4, d * 0.4, wall, -w * 0.25, top + 1.2, -d * 0.2));
    if (snowy) near.push(box(w + 0.1, 0.16, d + 0.1, colour(SNOW), 0, top + 0.38, 0));
    return { near, far: [box(w + 0.2, 0.3, d + 0.2, colour(snowy ? SNOW : style.frame), 0, top + 0.15, 0)] };
  }
  near.push(gable(w + oh * 2, d + oh * 2, rise, color).translate(0, top, 0));
  if (detail) near.push(box(w + oh * 2 + 0.06, 0.14, 0.24, color.clone().multiplyScalar(0.8), 0, top + rise + 0.02, 0));
  if (snowy) near.push(gable(w + oh * 2 + 0.1, d + oh * 2 + 0.1, rise + 0.05, colour(SNOW)).translate(0, top + 0.18, 0));
  return { near, far: [gable(w + oh * 2, d + oh * 2, rise, snowy ? colour(SNOW) : color).translate(0, top, 0)] };
}

/**
 * The house's geometry lists, so a farmstead can place the same house.
 * @param {{style?: string, season: string, detail: boolean, big: boolean, dice: ReturnType<typeof import("./shapes.js").dice>}} options
 */
export function houseGeometry({ style: name = "cottage", season, detail, big, dice }) {
  const style = PALETTE[name] ?? PALETTE.cottage;
  const snowy = season === "winter";
  const { pick, range, chance } = dice;
  const w = big ? range(11, 13) : range(7, 10);
  const d = big ? range(8, 10) : range(6, 8.5);
  const floors = big ? 2 : chance(0.55) ? 2 : 1;
  const h = FLOOR * floors + (big ? 1 : 0.2);
  const top = h + PLINTH;
  const wall = colour(pick(style.walls));
  const roofColour = colour(pick(style.roofs));
  const shutter = chance(0.85) ? colour(pick(style.shutters)) : null;
  const flat = chance(style.flat ?? 0);
  const woodUp = floors === 2 && chance(style.upper);
  const rise = style.pitch * d * 0.5 * range(0.9, 1.1);
  const near = [box(w + 0.35, 0.8, d + 0.35, colour(style.stone), 0, -0.15, 0)];
  const glows = [];
  if (woodUp) near.push(box(w, FLOOR, d, wall, 0, FLOOR / 2 + PLINTH, 0), box(w + 0.14, h - FLOOR, d + 0.14, colour(style.wood), 0, FLOOR + PLINTH + (h - FLOOR) / 2, 0));
  else near.push(box(w, h, d, wall, 0, h / 2 + PLINTH, 0));
  const roof = roofOf(style, { w, d, top, flat, snowy, color: roofColour, wall, rise, detail });
  near.push(...roof.near);
  if (style.beams) for (const yaw of [0, Math.PI]) beamsAt(near, style, w, h, (d / 2) * Math.cos(yaw), yaw, floors);
  if (style.quoins) for (const sx of [-1, 1]) for (const yaw of [0, Math.PI]) near.push(quad(0.5, h, colour(style.quoins), sx * (w / 2 - 0.25) * Math.cos(yaw), h / 2 + PLINTH, (d / 2 + 0.03) * Math.cos(yaw), yaw));
  if (detail && !flat && chance(0.6)) {
    const cx = w * 0.25;
    near.push(box(0.7, rise + 1.2, 0.7, colour(style.stone), cx, top + rise * 0.5 + 0.4, -d * 0.15), box(0.85, 0.12, 0.85, colour("#555a60"), cx, top + rise + 1.05, -d * 0.15));
  }
  const dx = range(-w * 0.18, w * 0.18);
  near.push(box(1.25, 2.25, 0.14, colour(style.door), dx, 1.45, d / 2 + 0.06), box(1.7, 0.22, 0.9, colour(style.stone), dx, 0.33, d / 2 + 0.45));
  if (detail) near.push(box(1.45, 0.14, 0.18, colour(style.frame), dx, 2.62, d / 2 + 0.08), box(2.0, 0.12, 1.1, colour(style.wood), dx, 3.0, d / 2 + 0.55));
  glows.push(quad(0.5, 0.5, colour("#ffffff"), dx, 1.95, d / 2 + 0.15));
  const flowers = name === "cottage" ? "#d8343a" : null;
  const options = { detail, shutter };
  for (let f = 0; f < floors; f += 1) {
    const y = 1.9 + f * FLOOR;
    const columns = Math.max(1, Math.floor(w / 2.6));
    for (let i = 0; i < columns; i += 1) {
      const x = -w / 2 + ((i + 0.5) * w) / columns;
      const front = f !== 0 || Math.abs(x - dx) >= 1.6;
      if (front) windowAt(near, glows, style, x, y, d / 2, 0, { ...options, flowers: f === 0 ? flowers : null });
      windowAt(near, glows, style, x, y, -d / 2, Math.PI, { ...options, shutter: null });
    }
    const rows = Math.max(1, Math.floor(d / 3.2));
    for (let i = 0; i < rows; i += 1) {
      const z = -d / 2 + ((i + 0.5) * d) / rows;
      for (const side of [-1, 1]) windowAt(near, glows, style, (side * w) / 2, y, z, (side * Math.PI) / 2, { ...options, shutter: null });
    }
  }
  const far = [box(w, top, d, wall, 0, top / 2, 0), ...roof.far];
  return { near, far, glows, width: w, depth: d, eaves: top, door: { x: dx, y: 1.45, z: d / 2 } };
}

export const house = defineBuilding(
  { id: "house", name: "House", description: "A village house: cottage, whitewashed, timber or stone, with winter snow on its roof.", options: { style: { type: "select", values: HOUSE_STYLES, default: "cottage" } } }, // i18n-ok
  (options) => houseGeometry({ ...options, style: options.style ?? "cottage" }),
);
