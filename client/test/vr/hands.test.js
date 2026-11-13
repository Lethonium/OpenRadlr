import { test } from "node:test";
import assert from "node:assert/strict";
import { HAND_BONES, PALM_JOINT, boneModels, gripPoints, restingHand, snapHand } from "../../public/js/vr/hands.js";
import { positionOf } from "../../public/js/vr/xrFrame.js";

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const GRIP = [0.2, -0.5, -0.4];

/** A hand whose palm is `offset` metres from the grip along X. */
function handAt(offset) {
  const rested = restingHand("right", GRIP);
  const shift = offset;
  return { ...rested, joints: rested.joints.map((m) => Object.assign(new Float32Array(m), { 12: m[12] + shift })) };
}
const palmOf = (hand) => positionOf(hand.joints[PALM_JOINT]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("snapHand leaves a far hand alone", () => {
  const hand = handAt(0.2);
  assert.equal(snapHand(hand, GRIP), hand);
});

test("snapHand puts a near hand on the grip", () => {
  const snapped = snapHand(handAt(0.03), GRIP);
  assert.ok(distance(palmOf(snapped), GRIP) < 1e-3);
});

test("snapHand blends in between", () => {
  const hand = handAt(0.07);
  const gap = distance(palmOf(snapHand(hand, GRIP)), GRIP);
  assert.ok(gap > 1e-3 && gap < 0.07, `${gap}`);
});

test("snapHand never rotates the hand", () => {
  const hand = handAt(0.03);
  const snapped = snapHand(hand, GRIP);
  snapped.joints.forEach((m, i) => assert.deepEqual([...m].slice(0, 12), [...hand.joints[i]].slice(0, 12)));
});

test("snapHand moves every joint by the same amount", () => {
  const hand = handAt(0.03);
  const snapped = snapHand(hand, GRIP);
  const moved = (i) => positionOf(snapped.joints[i]).map((v, k) => v - positionOf(hand.joints[i])[k]);
  for (const i of [0, 4, 24]) moved(i).forEach((v, k) => close(v, moved(PALM_JOINT)[k], 1e-6));
});

test("HAND_BONES has 24 bones over 25 joints", () => {
  assert.equal(HAND_BONES.length, 24);
  assert.deepEqual([...new Set(HAND_BONES.flat())].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
});

test("the grips are the bike's hands, in seat space", () => {
  const { left, right } = gripPoints();
  assert.ok(left[0] < 0 && right[0] > 0);
  assert.ok(left[1] < 0, "below the head");
  assert.ok(left[2] < 0, "ahead of the seat");
});

test("a resting hand has 25 joints with its palm on the grip", () => {
  const hand = restingHand("left", GRIP);
  assert.equal(hand.joints.length, 25);
  assert.equal(hand.radii.length, 25);
  assert.deepEqual(palmOf(hand).map((v) => Math.round(v * 1e4) / 1e4), GRIP);
});

test("a bone's box spans its two joints", () => {
  const hand = restingHand("right", GRIP);
  const models = boneModels(hand);
  assert.equal(models.length, 24);
  const [from, to] = HAND_BONES[0];
  const m = models[0];
  const a = positionOf(hand.joints[from]);
  const b = positionOf(hand.joints[to]);
  [0, 1, 2].forEach((k) => close(m[12 + k], (a[k] + b[k]) / 2, 1e-6));
  close(Math.hypot(m[8], m[9], m[10]), distance(a, b), 1e-5);
  close(Math.hypot(m[0], m[1], m[2]), 2 * hand.radii[to], 1e-6);
});

test("a resting hand's fingers reach forward over the bars, the wrist behind them", () => {
  const hand = restingHand("right", [0.2, -0.56, -0.46]);
  const wrist = positionOf(hand.joints[0]);
  const middleTip = positionOf(hand.joints[14]);
  assert.ok(wrist[2] > -0.46, "the wrist is on the rider's side of the grip");
  assert.ok(middleTip[2] < wrist[2] - 0.1, "the fingertip is well ahead of the wrist (−Z is forward)");
});
