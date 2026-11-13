import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOM_COLORS, buildStudioRoom } from "../../public/js/view3d/studioRoom.js";
import { INSTRUCTOR, ROOM, STAGE, STUDIO_CAMERAS, seatPosition, studioCamera } from "../../public/js/view3d/studioScene.js";

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const { props } = buildStudioRoom();
const seats = Array.from({ length: 16 }, (_, seat) => seatPosition(seat));

test("the floor is light", () => {
  assert.ok(luma(ROOM_COLORS.floor) > 0.6);
});

test("every prop stands along a side wall, clear of the aisles", () => {
  assert.ok(props.length > 0);
  for (const { kind, x, z } of props) {
    assert.ok(Math.abs(x) > ROOM.halfWidth - 1.2, `${kind} along a side wall`);
    for (const seat of [...seats, INSTRUCTOR.position]) assert.ok(Math.hypot(seat[0] - x, seat[2] - z) > 1, `${kind} clear of a bike`);
    const dx = Math.max(Math.abs(x) - STAGE.halfWidth, 0);
    const dz = Math.max(Math.abs(z - STAGE.z) - STAGE.depth / 2, 0);
    assert.ok(Math.hypot(dx, dz) > 1, `${kind} clear of the stage`);
  }
});

test("no prop blocks a camera", () => {
  for (const mode of STUDIO_CAMERAS) {
    for (let seat = 0; seat < 16; seat += 1) {
      const { eye } = studioCamera(mode, seat);
      for (const { kind, x, z } of props) assert.ok(Math.hypot(eye[0] - x, eye[2] - z) > 0.8, `${kind} away from the ${mode} camera`);
    }
  }
});
