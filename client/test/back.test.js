import { test } from "node:test";
import assert from "node:assert/strict";
import { backAction } from "../public/js/input/back.js";

const at = (state) => backAction({ finished: false, panelOpen: false, riding: false, workout: null, figureOpen: false, ...state });

test("on the start menu, back leaves the app", () => {
  assert.equal(at({}), "leaveApp");
});

test("an open panel steps back first, in the menu and on the ride", () => {
  assert.equal(at({ panelOpen: true }), "stepBack");
  assert.equal(at({ panelOpen: true, riding: true }), "stepBack");
});

test("riding without a panel open asks before finishing, never ends the ride", () => {
  assert.equal(at({ riding: true }), "askFinish");
});

test("the summary goes back to the menu, whatever else is open", () => {
  assert.equal(at({ finished: true, riding: true, panelOpen: true }), "leaveRide");
});

test("an open exercise of the Workout tab closes before the app is left", () => {
  assert.equal(at({ figureOpen: true }), "closeFigure");
});

test("a café workout asks before it ends, and its summary goes back to the menu", () => {
  assert.equal(at({ riding: true, workout: "running" }), "askEndWorkout");
  assert.equal(at({ riding: true, workout: "summary" }), "leaveWorkout");
});
