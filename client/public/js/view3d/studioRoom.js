/**
 * The training room inside the glass building: a light daylight studio with
 * oak floor, white walls and a pale ceiling with light panels. Pure geometry
 * in the studio's local frame (riders face −Z, up is +Y). `room` is lit by
 * the world's sun and sky, `accents` is drawn self-illuminated. The front
 * wall is the building's glass, so the room has none.
 */
import { MeshBuilder } from "./meshBuilder.js";
import { WHEEL_HUBS } from "./riderModel.js";
import { INSTRUCTOR, RISER, ROOM, ROW_GAP, SEAT_GAP, STAGE, seatPosition } from "./studioLayout.js";
import { hexToRgb } from "./view3d.js";

export const ROOM_COLORS = Object.freeze({
  floor: hexToRgb("#d9b98c"),
  walls: hexToRgb("#f4f1ea"),
  ceiling: hexToRgb("#eceae4"),
  lemon: hexToRgb("#f5d000"),
  orange: hexToRgb("#ff7a1a"),
});

const STAGE_TOP = hexToRgb("#e6e2da");
const RISER_TOP = hexToRgb("#c9a878");
const TRAINER = hexToRgb("#2a2d31");
const TRAINER_FOOT = hexToRgb("#6d7176");
const LIGHT_PANEL = [1, 0.98, 0.92];
const METAL = hexToRgb("#5b6066");
const IRON = hexToRgb("#33363a");
const WOOD = hexToRgb("#b98f5c");
const TERRACOTTA = hexToRgb("#c0653d");
const LEAF = hexToRgb("#4f8a46");
const WHITE = hexToRgb("#fbfaf7");
const WATER = hexToRgb("#79b8e0");
const SCREEN = hexToRgb("#1d2227");
const SCREEN_GLOW = hexToRgb("#7fd4e6");
const MAT = [hexToRgb("#6ba5a0"), hexToRgb("#d98a8a"), hexToRgb("#8e8bc4")];

/** Props hug the side walls; centre distance from the room's middle line. */
const WALL_X = ROOM.halfWidth - 0.7;

const PROPS = Object.freeze([
  { kind: "rack", side: 1, z: -6.8 },
  { kind: "kettlebell", side: 1, z: -4.9 },
  { kind: "kettlebell", side: 1, z: -4.3 },
  { kind: "mat", side: -1, z: -7.2 },
  { kind: "mat", side: -1, z: -6.5 },
  { kind: "plant", side: -1, z: -8.7 },
  { kind: "plant", side: 1, z: -8.7 },
  { kind: "plant", side: 1, z: 5.6 },
  { kind: "water", side: 1, z: 0.4 },
  { kind: "bench", side: -1, z: 3.2 },
  { kind: "plant", side: -1, z: 5.6 },
  { kind: "screen", side: -1, z: -2.2 },
]);

/** A smart trainer under the rear wheel and a block under the front wheel. */
function addTrainer(mesh, [x, y, z]) {
  const rear = WHEEL_HUBS[0][2];
  const front = WHEEL_HUBS[1][2];
  mesh.box([x, y + 0.2, z + rear], [0.3, 0.4, 0.42], TRAINER);
  mesh.box([x, y + 0.03, z + rear], [0.9, 0.06, 0.16], TRAINER_FOOT);
  mesh.box([x, y + 0.02, z + rear + 0.25], [0.6, 0.04, 0.1], TRAINER_FOOT);
  mesh.box([x, y + 0.05, z + front], [0.24, 0.1, 0.36], TRAINER);
}

function addProp(room, accents, { kind, side, z }) {
  const x = side * WALL_X;
  switch (kind) {
    case "rack": {
      room.box([x, 0.5, z], [0.5, 0.06, 1.6], METAL);
      room.box([x, 0.95, z], [0.5, 0.06, 1.6], METAL);
      for (const end of [-0.75, 0.75]) room.box([x, 0.5, z + end], [0.5, 1.0, 0.06], METAL);
      for (let i = 0; i < 5; i += 1) {
        room.box([x, 0.62, z - 0.6 + i * 0.3], [0.26, 0.16, 0.2], IRON);
        room.box([x, 1.07, z - 0.6 + i * 0.3], [0.26, 0.16, 0.2], IRON);
      }
      break;
    }
    case "kettlebell":
      room.box([x, 0.18, z], [0.32, 0.3, 0.32], IRON);
      room.box([x, 0.4, z], [0.2, 0.06, 0.06], IRON);
      break;
    case "mat":
      room.wheel([x, 0.14, z], 0.14, 0.7, MAT[Math.abs(Math.round(z * 3)) % MAT.length], 8);
      break;
    case "plant":
      room.box([x, 0.22, z], [0.44, 0.44, 0.44], TERRACOTTA);
      room.box([x, 0.85, z], [0.6, 0.8, 0.6], LEAF);
      room.box([x, 1.35, z], [0.38, 0.4, 0.38], LEAF);
      break;
    case "water":
      room.box([x, 0.5, z], [0.5, 1.0, 0.5], WHITE);
      room.box([x, 1.25, z], [0.34, 0.5, 0.34], WATER);
      break;
    case "bench":
      room.box([x, 0.22, z], [0.44, 0.44, 1.7], WOOD);
      room.box([x, 0.5, z - 0.5], [0.36, 0.1, 0.5], WHITE);
      room.box([x, 0.5, z + 0.3], [0.36, 0.1, 0.5], WHITE);
      break;
    case "screen":
      room.box([side * (ROOM.halfWidth - 0.05), 1.9, z], [0.08, 1.3, 2.2], SCREEN);
      accents.box([side * (ROOM.halfWidth - 0.1), 1.9, z], [0.02, 1.1, 2.0], SCREEN_GLOW);
      break;
    default:
  }
}

/**
 * The room as two built meshes (`room` lit by the world, `accents` bright) and
 * the prop list. The first five quads of `room` are the shell: floor, ceiling,
 * back wall and the side walls, all facing into the room.
 */
export function buildStudioRoom() {
  const room = new MeshBuilder();
  const accents = new MeshBuilder();
  const { halfWidth: w, front: f, back: b, height: h } = ROOM;
  const panel = (a, b2, c, d, color, direction) => {
    room.triangleFacing(a, b2, c, color, direction);
    room.triangleFacing(a, c, d, color, direction);
  };
  panel([-w, 0, f], [w, 0, f], [w, 0, b], [-w, 0, b], ROOM_COLORS.floor, [0, 1, 0]);
  panel([-w, h, f], [w, h, f], [w, h, b], [-w, h, b], ROOM_COLORS.ceiling, [0, -1, 0]);
  panel([-w, 0, b], [w, 0, b], [w, h, b], [-w, h, b], ROOM_COLORS.walls, [0, 0, -1]);
  panel([-w, 0, f], [-w, 0, b], [-w, h, b], [-w, h, f], ROOM_COLORS.walls, [1, 0, 0]);
  panel([w, 0, f], [w, 0, b], [w, h, b], [w, h, f], ROOM_COLORS.walls, [-1, 0, 0]);

  // Stage with steps, the riser under the back row, and a trainer at every seat.
  room.box([0, STAGE.height / 2, STAGE.z], [STAGE.halfWidth * 2, STAGE.height, STAGE.depth], STAGE_TOP);
  room.box([0, STAGE.height / 4, STAGE.z + STAGE.depth / 2 + 0.25], [1.4, STAGE.height / 2, 0.5], STAGE_TOP);
  room.box([0, RISER / 2, ROW_GAP], [SEAT_GAP * 8 + 0.6, RISER, 2.2], RISER_TOP);
  for (let seat = 0; seat < 16; seat += 1) addTrainer(room, seatPosition(seat));
  addTrainer(room, INSTRUCTOR.position);

  // Long light panels in the ceiling, lemon stage edge, lemon/orange stripe on the back wall.
  for (const x of [-4.5, 0, 4.5]) accents.box([x, h - 0.02, (f + b) / 2], [0.6, 0.04, b - f - 2], LIGHT_PANEL);
  accents.box([0, STAGE.height + 0.02, STAGE.z + STAGE.depth / 2], [STAGE.halfWidth * 2, 0.04, 0.06], ROOM_COLORS.lemon);
  accents.box([0, 1.1, b - 0.02], [w * 2 - 0.4, 0.25, 0.04], ROOM_COLORS.lemon);
  accents.box([0, 0.85, b - 0.02], [w * 2 - 0.4, 0.08, 0.04], ROOM_COLORS.orange);

  for (const prop of PROPS) addProp(room, accents, prop);
  const props = PROPS.map(({ kind, side, z }) => ({ kind, x: side * (kind === "screen" ? ROOM.halfWidth - 0.05 : WALL_X), z }));
  return { room: room.build(), accents: accents.build(), props };
}
