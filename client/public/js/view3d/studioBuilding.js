/**
 * The spin studio's shell: a modern glass box. Local frame as in the studio:
 * origin on the ground at the middle of the footprint, riders face −Z, the
 * glass front is at `STUDIO_FOOTPRINT.front`, up is +Y. The shell comes as
 * parts so the layer can stack as many storeys as the studio has rooms:
 * `base` once, `floor` and `glass` per storey (each from y = 0 to
 * FLOOR_HEIGHT), `roof` once on top (it starts at y = 0).
 */
import { hexToRgb } from "./view3d.js";
import { MeshBuilder } from "./meshBuilder.js";
import { STUDIO_FOOTPRINT } from "./features.js";
import { pixelText } from "./pixelFont.js";

/** 4.6 m of room plus a 0.3 m slab. */
export const FLOOR_HEIGHT = 4.9;
const SLAB = 0.3;
const WALL = 0.3;
const MULLION_SPACING = 2;

const COLORS = Object.freeze({
  slab: hexToRgb("#b9b8b2"),
  render: hexToRgb("#f4f2ed"),
  frame: hexToRgb("#3b4249"),
  glass: [0.55, 0.72, 0.82, 0],
  plinth: hexToRgb("#8d8c87"),
  door: hexToRgb("#2c4a5c"),
  signBoard: hexToRgb("#23272b"),
  signText: hexToRgb("#f5d000"),
});

const { halfWidth, front, back } = STUDIO_FOOTPRINT;
const depth = back - front;
const middle = (front + back) / 2;

/** One storey: slab, solid side and back walls in white render, mullions in front of the glass. */
function buildFloor() {
  const m = new MeshBuilder();
  m.box([0, SLAB / 2, middle], [halfWidth * 2, SLAB, depth], COLORS.slab);
  const wallHeight = FLOOR_HEIGHT - SLAB;
  const wallY = SLAB + wallHeight / 2;
  for (const side of [-1, 1]) m.box([side * (halfWidth - WALL / 2 - 0.1), wallY, middle], [WALL, wallHeight, depth], COLORS.render);
  m.box([0, wallY, back - WALL / 2], [halfWidth * 2 - 0.2 - WALL * 2, wallHeight, WALL], COLORS.render);
  for (let x = -halfWidth + 0.5; x <= halfWidth - 0.5; x += MULLION_SPACING) {
    m.box([x, wallY, front + 0.12], [0.12, wallHeight, 0.2], COLORS.frame);
  }
  return m.build();
}

/** One storey's front pane, inside the mullions. */
function buildGlass() {
  const m = new MeshBuilder();
  const w = halfWidth - 0.1;
  m.quad([-w, SLAB, front], [w, SLAB, front], [w, FLOOR_HEIGHT, front], [-w, FLOOR_HEIGHT, front], COLORS.glass);
  return m.build();
}

/** Flat roof with a parapet and the lit "Spin Studio" sign facing the road. */
function buildRoof() {
  const m = new MeshBuilder();
  m.box([0, SLAB / 2, middle], [halfWidth * 2, SLAB, depth], COLORS.slab);
  const parapet = 0.7;
  const y = SLAB + parapet / 2;
  m.box([0, y, front + 0.15], [halfWidth * 2, parapet, 0.3], COLORS.render);
  m.box([0, y, back - 0.15], [halfWidth * 2, parapet, 0.3], COLORS.render);
  for (const side of [-1, 1]) m.box([side * (halfWidth - 0.15), y, middle], [0.3, parapet, depth - 0.6], COLORS.render);
  const board = [0, SLAB + parapet + 0.9, front + 0.45];
  m.box(board, [13.4, 1.8, 0.2], COLORS.signBoard);
  pixelText(m, "SPIN STUDIO", { // i18n-ok (brand name)
    origin: [board[0], board[1], board[2] - 0.11],
    right: [-1, 0, 0],
    up: [0, 1, 0],
    facing: [0, 0, -1],
    pixel: 0.18,
    color: COLORS.signText,
  });
  return m.build();
}

/** Plinth, entrance step and door at the left side (looks only). */
function buildBase() {
  const m = new MeshBuilder();
  m.box([0, -0.75, middle], [halfWidth * 2, 1.5, depth], COLORS.plinth);
  m.box([-halfWidth + 0.5, 0.075, back - 4.5], [1, 0.15, 2.4], COLORS.slab);
  m.box([-halfWidth + 0.05, 1.2, back - 4.5], [0.1, 2.1, 1.4], COLORS.door);
  return m.build();
}

export function buildStudioShell() {
  return { base: buildBase(), floor: buildFloor(), roof: buildRoof(), glass: buildGlass() };
}
