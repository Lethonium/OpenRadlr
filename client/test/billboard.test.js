import { test } from "node:test";
import assert from "node:assert/strict";

import { POSTER, billboardFrame, posterQuad } from "../public/js/view3d/assets/props/billboard.js";

const boundsOf = (geometry) => (geometry.computeBoundingBox(), geometry.boundingBox);

test("the frame is about 6.3 m wide, with its top just above the poster", () => {
  const box = boundsOf(billboardFrame({ detail: false }));
  assert.ok(Math.abs(box.max.x - box.min.x - 6.3) <= 0.2, `width ${box.max.x - box.min.x}`);
  const top = POSTER.lift + POSTER.height + 0.15;
  assert.ok(Math.abs(box.max.y - top) <= 0.1, `top ${box.max.y}`);
});

test("the detail frame has more vertices than the plain one", () => {
  const plain = billboardFrame({ detail: false }).attributes.position.count;
  const detailed = billboardFrame({ detail: true }).attributes.position.count;
  assert.ok(plain < detailed, `plain ${plain} detailed ${detailed}`);
});

test("the poster quad spans the poster face with the given uvs", () => {
  const { positions, uvs, index } = posterQuad([0, 0.5, 0.5, 1]);
  const corners = [0, 1, 2, 3].map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} is not ${expected}`); // Float32 storage
  near(Math.min(...xs), -3);
  near(Math.max(...xs), 3);
  near(Math.min(...ys), 2.2);
  near(Math.max(...ys), 5.2);
  for (const [, , z] of corners) near(z, POSTER.inset);
  assert.deepEqual([...uvs], [0, 0.5, 0.5, 0.5, 0.5, 1, 0, 1]);
  assert.deepEqual(index, [0, 1, 2, 0, 2, 3]);
});
