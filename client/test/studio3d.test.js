import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTOR, ROOM, STUDIO_CAMERAS, buildStudioRoom, seatPosition, studioCamera } from "../public/js/view3d/studioScene.js";

test("seats: two rows of eight facing the stage, the back row raised", () => {
  const front = [0, 1, 2, 3, 4, 5, 6, 7].map(seatPosition);
  const back = [8, 9, 10, 11, 12, 13, 14, 15].map(seatPosition);
  assert.ok(front.every((p) => p[2] === front[0][2] && p[1] === 0));
  assert.ok(back.every((p) => p[2] > front[0][2] && p[1] > 0), "behind and on a riser");
  for (let i = 1; i < 8; i += 1) assert.ok(front[i][0] - front[i - 1][0] >= 1.2, "room between bikes");
  assert.ok(Math.abs(front[3][0] + front[4][0]) < 1e-9, "seats 3 and 4 frame the middle");
  assert.ok(INSTRUCTOR.position[2] < front[0][2] - 3, "the instructor rides in front");
  assert.ok([...front, ...back].every((p) => Math.abs(p[0]) < ROOM.halfWidth - 0.8 && p[2] < ROOM.back - 0.8));
});

test("every camera stays inside the room and looks towards its target", () => {
  for (const mode of STUDIO_CAMERAS) {
    for (const seat of [0, 3, 15]) {
      const { eye, target } = studioCamera(mode, seat);
      assert.ok(Math.abs(eye[0]) < ROOM.halfWidth && eye[2] > ROOM.front && eye[2] < ROOM.back, `${mode} eye inside`);
      assert.ok(eye[1] > 0.5 && eye[1] < ROOM.height, `${mode} eye height`);
      assert.notDeepEqual(eye, target);
    }
  }
  const { eye } = studioCamera("seat", 3);
  assert.ok(eye[2] > seatPosition(3)[2], "behind my bike");
});

test("the room mesh: walls and floor face into the room, neon strips glow separately", () => {
  const { room, neon } = buildStudioRoom();
  assert.ok(room.vertexCount > 300 && neon.vertexCount > 0);
  const centre = [0, ROOM.height / 2, (ROOM.front + ROOM.back) / 2];
  // The shell (first triangles) faces the centre of the room.
  for (let i = 0; i < 6 * 6; i += 3) {
    const normal = [room.normals[i * 3], room.normals[i * 3 + 1], room.normals[i * 3 + 2]];
    const p = [room.positions[i * 3], room.positions[i * 3 + 1], room.positions[i * 3 + 2]];
    const toCentre = centre.map((c, axis) => c - p[axis]);
    assert.ok(normal.reduce((sum, n, axis) => sum + n * toCentre[axis], 0) > 0, `shell triangle ${i / 3} faces inwards`);
  }
});
