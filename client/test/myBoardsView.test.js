import { test } from "node:test";
import assert from "node:assert/strict";
import { boardErrorKey, myBoardsLines, thumbSize } from "../public/js/view/myBoardsView.js";

test("myBoardsLines: 12 of 12 cannot add", () => {
  const lines = myBoardsLines(new Array(12).fill({}), { max: 12 });
  assert.deepEqual(lines, { count: "12 of 12", canAdd: false, empty: null });
});

test("myBoardsLines: none says so and can add", () => {
  const lines = myBoardsLines([], { max: 12 });
  assert.equal(lines.count, "0 of 12");
  assert.equal(lines.canAdd, true);
  assert.equal(lines.empty, "No boards of your own yet.");
});

test("every failure reason has its own message", () => {
  const keys = ["full", "empty", "tooLong", "unreadable", "storage"].map(boardErrorKey);
  assert.equal(new Set(keys).size, 5);
  for (const key of keys) assert.match(key, /^boards\.error\./);
});

test("a thumbnail is painted at its displayed size times the device pixel ratio, 2:1", () => {
  assert.deepEqual(thumbSize(96, 1), { width: 96, height: 48 });
  assert.deepEqual(thumbSize(96, 2), { width: 192, height: 96 });
  assert.deepEqual(thumbSize(96, 1.5), { width: 144, height: 72 });
  assert.deepEqual(thumbSize(96, 0), { width: 96, height: 48 });
});
