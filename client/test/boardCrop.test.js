import { test } from "node:test";
import assert from "node:assert/strict";
import { cropWindow } from "../public/js/profile/myBoards.js";
import { dragCrop, initialCrop, zoomCrop } from "../public/js/view/boardCrop.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const size = { imageW: 4000, imageH: 1000, frameW: 400 };

test("initialCrop covers the frame, centred, unzoomed", () => {
  assert.deepEqual(initialCrop(), { x: 0.5, y: 0.5, scale: 1 });
  const { sx, sw, sh } = cropWindow(4000, 1000, initialCrop());
  assert.equal(sw, 2000);
  assert.equal(sh, 1000);
  assert.equal(sx, 1000);
});

test("dragging the picture right moves the window left", () => {
  const crop = dragCrop({ x: 0.5, y: 0.5, scale: 1 }, 100, 0, size);
  // 100 frame px = 500 source px (2000 / 400 per px); room left over is 2000
  near(crop.x, 0.5 - 500 / 2000);
});

test("dragCrop cannot move the window past the image edge", () => {
  assert.equal(dragCrop({ x: 0.1, y: 0.5, scale: 1 }, 100000, 0, size).x, 0);
  assert.equal(dragCrop({ x: 0.9, y: 0.5, scale: 1 }, -100000, 0, size).x, 1);
});

test("dragCrop leaves an axis with no room alone", () => {
  const crop = dragCrop({ x: 0.5, y: 0.5, scale: 1 }, 0, 80, size);
  assert.equal(crop.y, 0.5);
});

test("dragCrop moves vertically in a portrait picture", () => {
  const portrait = { imageW: 1000, imageH: 4000, frameW: 400 };
  const crop = dragCrop({ x: 0.5, y: 0.5, scale: 1 }, 0, -40, portrait);
  // window 1000 x 500 shows 1000/400 source px per frame px: 40 px = 100 source px of 3500 room
  near(crop.y, 0.5 + 100 / 3500);
});

test("zoomCrop to 2 halves the source window and keeps its centre", () => {
  const before = cropWindow(4000, 1000, { x: 0.3, y: 0.5, scale: 1 });
  const crop = zoomCrop({ x: 0.3, y: 0.5, scale: 1 }, 2, size);
  assert.equal(crop.scale, 2);
  const after = cropWindow(4000, 1000, crop);
  near(after.sw, before.sw / 2);
  near(after.sx + after.sw / 2, before.sx + before.sw / 2);
  near(after.sy + after.sh / 2, before.sy + before.sh / 2);
});

test("zoomCrop clamps the scale to 1..8 and the window to the image", () => {
  assert.equal(zoomCrop({ x: 0.5, y: 0.5, scale: 2 }, 0.2, size).scale, 1);
  assert.equal(zoomCrop({ x: 0.5, y: 0.5, scale: 2 }, 99, size).scale, 8);
  const edge = zoomCrop({ x: 1, y: 0.5, scale: 1 }, 4, size);
  assert.ok(edge.x >= 0 && edge.x <= 1);
});
