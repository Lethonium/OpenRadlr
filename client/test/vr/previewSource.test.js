import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewSource, parseHead, previewFrame } from "../../public/js/vr/previewSource.js";
import { PALM_JOINT, gripPoints } from "../../public/js/vr/hands.js";
import { forwardOf } from "../../public/js/vr/xrFrame.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const DEG = Math.PI / 180;

test("parseHead reads yaw and pitch", () => {
  assert.deepEqual(parseHead("?preview=1&head=40,-10"), { yawDeg: 40, pitchDeg: -10, position: [0, 0, 0] });
});

test("parseHead reads a position", () => {
  assert.deepEqual(parseHead("?head=0,5,1,2,3"), { yawDeg: 0, pitchDeg: 5, position: [1, 2, 3] });
});

test("parseHead ignores garbage", () => {
  for (const search of ["", "?head=", "?head=a,b", "?head=1", "?head=1,2,3", "?head=1,,3", "?head=1,2,3,4,x"]) assert.equal(parseHead(search), null, search);
});

test("the preview has two views side by side", () => {
  const frame = previewFrame({ width: 800, height: 400, timeS: 3, pose: { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] } });
  assert.deepEqual(
    frame.views.map((view) => view.rect.x),
    [0, 400],
  );
  assert.deepEqual(frame.size, { width: 800, height: 400 });
  assert.equal(frame.framebuffer, null);
  assert.equal(frame.timeS, 3);
});

test("the preview's eyes are 64 mm apart", () => {
  const [left, right] = previewFrame({ width: 800, height: 400, timeS: 0, pose: { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] } }).views;
  close(right.headFromEye[12] - left.headFromEye[12], 0.064);
});

test("the preview's field of view is 100 by 96 degrees per eye", () => {
  const { projection } = previewFrame({ width: 800, height: 400, timeS: 0, pose: { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] } }).views[0];
  close(2 * Math.atan(1 / projection[0]), 100 * DEG);
  close(2 * Math.atan(1 / projection[5]), 96 * DEG);
});

test("a wide half is letterboxed to the field of view's aspect, centred", () => {
  const [left] = previewFrame({ width: 1600, height: 400, timeS: 0, pose: { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] } }).views;
  assert.equal(left.rect.height, 400);
  assert.ok(left.rect.width < 800 && left.rect.x > 0);
  assert.ok(Math.abs(left.rect.x * 2 + left.rect.width - 800) <= 1);
});

test("the head turns right with positive yaw and looks up with positive pitch", () => {
  const forward = (yawDeg, pitchDeg) => forwardOf(previewFrame({ width: 800, height: 400, timeS: 0, pose: { yawDeg, pitchDeg, position: [0, 0, 0] } }).head);
  const right = forward(90, 0);
  close(right[0], 1);
  close(forward(0, 0)[2], -1);
  assert.ok(forward(0, 30)[1] > 0.49);
});

function source() {
  let drag;
  let key;
  const frames = [];
  const ticks = [];
  const canvas = { width: 0, height: 0, clientWidth: 800, clientHeight: 400 };
  const preview = new PreviewSource({
    canvas,
    schedule: (tick) => ticks.push(tick),
    now: () => 5,
    input: { onDrag: (fn) => (drag = fn), onKey: (fn) => (key = fn) },
    initial: { yawDeg: 10, pitchDeg: 0, position: [0, 0, 0] },
  });
  return { preview, canvas, frames, ticks, drag: (dx, dy) => drag(dx, dy), key: (k) => key(k) };
}

test("dragging 100 px turns the head 25 degrees", () => {
  const { preview, drag } = source();
  drag(100, 0);
  assert.equal(preview.pose.yawDeg, 35);
});

test("pitch stops at 80 degrees", () => {
  const { preview, drag } = source();
  drag(0, -10000);
  assert.equal(preview.pose.pitchDeg, 80);
  drag(0, 10000);
  assert.equal(preview.pose.pitchDeg, -80);
});

test("the arrow keys turn the head 5 degrees", () => {
  const { preview, key } = source();
  key("ArrowRight");
  key("ArrowUp");
  assert.deepEqual([preview.pose.yawDeg, preview.pose.pitchDeg], [15, 5]);
});

test("R recenters", () => {
  const { preview, drag, key } = source();
  drag(200, 40);
  key("R");
  assert.deepEqual(preview.pose, { yawDeg: 10, pitchDeg: 0, position: [0, 0, 0] });
});

test("the source sizes the canvas and hands a frame per scheduled tick until stopped", async () => {
  const { preview, canvas, frames, ticks } = source();
  await preview.start((frame) => frames.push(frame));
  ticks.shift()();
  assert.deepEqual([canvas.width, canvas.height], [800, 400]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].timeS, 5);
  preview.stop();
  ticks.shift()();
  assert.equal(frames.length, 1);
});

test("the preview rests both hands on the grips", () => {
  const { hands } = previewFrame({ width: 800, height: 400, timeS: 0, pose: { yawDeg: 0, pitchDeg: 0, position: [0, 0, 0] } });
  const grips = gripPoints();
  assert.deepEqual(hands.map((hand) => hand.handedness), ["left", "right"]);
  for (const hand of hands) {
    const palm = hand.joints[PALM_JOINT];
    [0, 1, 2].forEach((k) => close(palm[12 + k], grips[hand.handedness][k], 1e-5));
  }
});

test("stopping lets go of the page's input", () => {
  let disposed = 0;
  const preview = new PreviewSource({ canvas: { width: 0, height: 0, clientWidth: 8, clientHeight: 4 }, schedule() {}, now: () => 0, input: { onDrag() {}, onKey() {}, dispose: () => (disposed += 1) } });
  preview.start(() => {});
  assert.equal(disposed, 0, "starting keeps it");
  preview.stop();
  assert.equal(disposed, 1);
});
