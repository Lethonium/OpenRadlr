import { test } from "node:test";
import assert from "node:assert/strict";
import { createPanelStack } from "../public/js/input/panelStack.js";

function fakePanel(log, name) {
  return { close: () => log.push(name) };
}

test("closeTop closes the last pushed panel first", () => {
  const log = [];
  const stack = createPanelStack();
  stack.push(fakePanel(log, "drawer"));
  stack.push(fakePanel(log, "dialog"));
  assert.equal(stack.closeTop(), true);
  assert.deepEqual(log, ["dialog"]);
});

test("closeTop with nothing open returns false", () => {
  const stack = createPanelStack();
  assert.equal(stack.closeTop(), false);
  assert.equal(stack.isOpen, false);
});

test("the remover takes a panel out without closing it", () => {
  const log = [];
  const stack = createPanelStack();
  const remove = stack.push(fakePanel(log, "drawer"));
  remove();
  assert.equal(stack.isOpen, false);
  assert.deepEqual(log, []);
});
