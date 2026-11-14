import { test } from "node:test";
import assert from "node:assert/strict";
import { seatAnchor } from "../../public/js/vr/seatAnchor.js";
import { transformPoint } from "../../public/js/view3d/math.js";
import { RIDER_GEOMETRY } from "../../public/js/view3d/riderModel.js";
import { StudioCamera } from "../../public/js/view3d/studioCamera.js";

const closeVec = (a, b, eps = 1e-5) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} != ${b}`));
const local = (m, point) => transformPoint(m, point).slice(0, 3);

test("the seat sits at head height above the road position", () => {
  const anchor = seatAnchor({ position: [10, 20, 30], forward: [0, 0, -1] });
  closeVec(local(anchor, [0, 0, 0]), [10, 20 + RIDER_GEOMETRY.headHeight, 30]);
});

test("the seat faces along the road on a curve", () => {
  const anchor = seatAnchor({ position: [0, 0, 0], forward: [1, 0, 0] });
  const ahead = local(anchor, [0, 0, -1]);
  closeVec([ahead[0], ahead[2]], [1, 0]);
});

test("the road's slope does not tilt the seat", () => {
  const level = seatAnchor({ position: [0, 0, 0], forward: [0, 0, -1] });
  const climbing = seatAnchor({ position: [0, 0, 0], forward: [0, 0.3, -0.95] });
  closeVec(climbing, level);
});

test("the studio seat uses the studio's pov without bob", () => {
  const site = { position: [100, 100, 80], yaw: 0 };
  const camera = new StudioCamera(site, 0, 3, "pov");
  const before = camera.povPose();
  camera.cadence = 90;
  camera.update(0, 0, 0.37);
  camera.update(0, 0, 0.11);
  assert.deepEqual(camera.povPose(), before);
  const anchor = seatAnchor(null, { studioPov: before });
  closeVec(local(anchor, [0, 0, 0]), before.eye);
  const ahead = local(anchor, [0, 0, -1]);
  const dir = [before.target[0] - before.eye[0], before.target[2] - before.eye[2]];
  const len = Math.hypot(...dir);
  closeVec([ahead[0] - before.eye[0], ahead[2] - before.eye[2]], [dir[0] / len, dir[1] / len]);
});
