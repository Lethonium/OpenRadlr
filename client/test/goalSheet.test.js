import { test } from "node:test";
import assert from "node:assert/strict";
import { GOAL_POSTER, createGoalSheet } from "../public/js/view3d/posters/goalSheet.js";

function fakeCanvas(width, height) {
  const calls = [];
  const ctx = new Proxy({ font: "10px x" }, {
    get: (target, prop) => (prop === "calls" ? calls : prop === "measureText" ? () => ({ width: 10 }) : prop in target ? target[prop] : (...args) => calls.push([String(prop), ...args])),
    set: (target, prop, value) => ((target[prop] = value), true),
  });
  return { width, height, getContext: () => ctx, ctx };
}

test("the sheet holds two posters side by side", () => {
  const sheet = createGoalSheet(fakeCanvas);
  assert.equal(sheet.canvas.width, GOAL_POSTER.width * 2);
  assert.equal(sheet.canvas.height, GOAL_POSTER.height);
});

test("a slot is painted in its own half, and only when its text changes", () => {
  const sheet = createGoalSheet(fakeCanvas);
  assert.equal(sheet.paint(1, "Beat 20:00"), true);
  const moved = sheet.canvas.ctx.calls.find(([name]) => name === "translate");
  assert.deepEqual(moved.slice(1), [GOAL_POSTER.width, 0]);
  assert.equal(sheet.paint(1, "Beat 20:00"), false);
  assert.equal(sheet.paint(1, "Other"), true);
});
