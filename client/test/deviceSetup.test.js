import { test } from "node:test";
import assert from "node:assert/strict";
import { addonsShown, chooseRideMode, rideModes } from "../public/js/view/deviceSetup.js";

const road = { id: "col" };
const studio = { id: "spin-studio", kind: "studio" };
const ids = (modes) => modes.map((mode) => mode.id);

test("the ways to ride: a smart trainer, phone paddles and the simulator, as far as the server allows", () => {
  assert.deepEqual(ids(rideModes({ info: {}, picked: road })), ["trainer", "paddles", "sim"]);
  assert.deepEqual(ids(rideModes({ info: { paddle_mode: false }, picked: road })), ["trainer", "sim"]);
  assert.deepEqual(ids(rideModes({ info: { simulated_trainer: false }, picked: road })), ["trainer", "paddles"]);
  assert.deepEqual(ids(rideModes({ info: null, picked: null })), ["trainer", "paddles", "sim"]);
});

test("phone paddles ride the roads only: in the studio they're offered but unavailable, with the reason", () => {
  const paddles = rideModes({ info: {}, picked: studio }).find((mode) => mode.id === "paddles");
  assert.equal(paddles.available, false);
  assert.match(paddles.reason, /trainer/);
  assert.equal(rideModes({ info: {}, picked: road }).find((mode) => mode.id === "paddles").available, true);
});

test("the remembered way to ride is kept while it's available", () => {
  const modes = rideModes({ info: {}, picked: road });
  assert.equal(chooseRideMode("paddles", modes, true), "paddles");
  assert.equal(chooseRideMode("sim", modes, false), "sim");
});

test("without a choice: the smart trainer where Bluetooth works, else phone paddles, else the simulator", () => {
  const modes = rideModes({ info: {}, picked: road });
  assert.equal(chooseRideMode(null, modes, true), "trainer");
  assert.equal(chooseRideMode(null, modes, false), "paddles");
  assert.equal(chooseRideMode(null, rideModes({ info: { paddle_mode: false }, picked: road }), false), "sim");
  assert.equal(chooseRideMode(null, rideModes({ info: { paddle_mode: false, simulated_trainer: false }, picked: road }), false), "trainer");
});

test("a remembered choice that isn't available here falls back like no choice", () => {
  assert.equal(chooseRideMode("paddles", rideModes({ info: {}, picked: studio }), true), "trainer");
  assert.equal(chooseRideMode("sim", rideModes({ info: { simulated_trainer: false }, picked: road }), false), "paddles");
  assert.equal(chooseRideMode("bogus", rideModes({ info: {}, picked: road }), true), "trainer");
});

test("heart rate and controller are add-ons to Bluetooth riding: not with paddles, heart rate alone for the workout", () => {
  assert.deepEqual(addonsShown("trainer", true, road), { hr: true, controller: true });
  assert.deepEqual(addonsShown("sim", true, road), { hr: true, controller: true });
  assert.deepEqual(addonsShown("paddles", true, road), { hr: false, controller: false });
  assert.deepEqual(addonsShown("trainer", false, road), { hr: false, controller: false });
  assert.deepEqual(addonsShown("paddles", true, { kind: "workout" }), { hr: true, controller: false });
  assert.deepEqual(addonsShown("trainer", false, { kind: "workout" }), { hr: false, controller: false });
});
