import { test } from "node:test";
import assert from "node:assert/strict";
import { boardErrorKey, myBoardsLines } from "../public/js/view/myBoardsView.js";

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
