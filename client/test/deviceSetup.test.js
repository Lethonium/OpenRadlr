import { test } from "node:test";
import assert from "node:assert/strict";
import { addonsShown, chooseRideMode, connectErrorText, controllerCheck, controllerLine, controllerSide, deviceActions, expectsOtherHalf, liveCheck, rideModes } from "../public/js/view/deviceSetup.js";

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

test("connect errors in plain words: what to do, not what the browser said", () => {
  const err = (name, message = "") => Object.assign(new Error(message), { name });
  assert.equal(connectErrorText(err("NotFoundError", "User cancelled the requestDevice() chooser.")), "Cancelled");
  assert.match(connectErrorText(err("NotFoundError", "Bluetooth adapter not available.")), /Bluetooth is off/);
  assert.match(connectErrorText(err("TimeoutError"), "KICKR CORE"), /No answer from KICKR CORE.*other apps/);
  assert.match(connectErrorText(err("NetworkError", "GATT operation failed for unknown reason.")), /Couldn't connect.*pedal/);
  assert.match(connectErrorText(err("SecurityError")), /blocked .*browser settings/);
  assert.match(connectErrorText(new Error("This device offers neither FTMS Indoor Bike Data nor Cycling Power data.")), /doesn't send power/);
  assert.match(connectErrorText(new Error("Something odd")), /Something odd.*Device diagnostics/);
});

test("the live check: waiting, connected and still, the numbers once power flows, a hint when data stops", () => {
  assert.deepEqual(liveCheck({ sinceDataMs: null }), { state: "waiting", text: "Connected · waiting for data…" });
  assert.deepEqual(liveCheck({ sinceDataMs: 200, power: 0, cadence: 0 }), { state: "idle", text: "Connected · pedal to check" });
  assert.deepEqual(liveCheck({ sinceDataMs: 200, power: 182.4, cadence: 88 }), { state: "live", text: "✓ 182 W · 88 rpm" });
  assert.deepEqual(liveCheck({ sinceDataMs: 200, power: 150 }), { state: "live", text: "✓ 150 W · – rpm" });
  const silent = liveCheck({ sinceDataMs: 7_400, power: 182 });
  assert.equal(silent.state, "silent");
  assert.match(silent.text, /No data for 7 s/);
});

test("each device line has one main action: reconnect the known one, add or change, never both squeezed in", () => {
  assert.deepEqual(deviceActions({ kind: "controller", connected: false, remembered: true }), { reconnect: true, other: "Other" });
  assert.deepEqual(deviceActions({ kind: "controller", connected: false, remembered: false }), { reconnect: false, other: "Add" });
  assert.deepEqual(deviceActions({ kind: "controller", connected: true, remembered: false }), { reconnect: false, other: "Add another" });
  assert.deepEqual(deviceActions({ kind: "hr", connected: true, remembered: true }), { reconnect: false, other: "Change" });
  assert.deepEqual(deviceActions({ kind: "hr", connected: false, remembered: false }), { reconnect: false, other: "Add" });
  assert.deepEqual(deviceActions({ kind: "trainer", connected: false, remembered: false }), { reconnect: false, other: "Connect" });
  assert.deepEqual(deviceActions({ kind: "trainer", connected: true, remembered: true }), { reconnect: false, other: "Change" });
});

test("the controller check confirms + and − one by one: with two Click halves, both must arrive", () => {
  assert.equal(controllerCheck({ seen: new Set() }), "Press + and − to check");
  assert.equal(controllerCheck({ seen: new Set(["shiftUp"]) }), "✓ + works · press − to check");
  assert.equal(controllerCheck({ seen: new Set(["shiftDown"]) }), "✓ − works · press + to check");
  assert.equal(controllerCheck({ seen: new Set(["shiftUp", "shiftDown"]) }), "✓ + and − both work");
  assert.equal(controllerCheck({ seen: new Set(["a"]), last: { label: "Zwift Play", buttons: ["a"] } }), "✓ Zwift Play: A · press + and − to check");
});

test("a controller's side comes from its first shift: a Click v2 half sends only + or only −", () => {
  assert.equal(controllerSide(new Set()), null);
  assert.equal(controllerSide(new Set(["shiftUp", "y"])), "+");
  assert.equal(controllerSide(new Set(["shiftDown"])), "−");
  assert.equal(controllerSide(new Set(["shiftUp", "shiftDown"])), null, "a one-piece controller has both");
});

test("the controller line lists each half with its side and battery", () => {
  const click = (side, battery, connected = true) => ({ label: "Zwift Click", seen: new Set(side ? [side === "+" ? "shiftUp" : "shiftDown"] : []), battery, connected });
  assert.equal(controllerLine([click("−", 70), click("+", 68)]), "Zwift Click − 70 % · + 68 %", "a pair: the name once");
  assert.equal(controllerLine([click(null, null)]), "Zwift Click");
  assert.equal(controllerLine([click("−", 70)]), "Zwift Click − 70 %");
  assert.equal(controllerLine([click("−", 70), click("+", 68, false)]), "Zwift Click − 70 % · + reconnecting…");
  assert.equal(controllerLine([click("+", 68), { label: "Zwift Play", seen: new Set(), battery: 50, connected: true }]), "Zwift Click + 68 % · Zwift Play 50 %");
});

test("one Click or Play half connected: the other half is expected", () => {
  const half = (label, seen = []) => ({ label, seen: new Set(seen), connected: true });
  assert.equal(expectsOtherHalf([half("Zwift Click", ["shiftUp"])]), true);
  assert.equal(expectsOtherHalf([half("Zwift Play")]), true);
  assert.equal(expectsOtherHalf([half("Zwift Click", ["shiftUp", "shiftDown"])]), false, "a one-piece Click v1");
  assert.equal(expectsOtherHalf([half("Zwift Ride")]), false);
  assert.equal(expectsOtherHalf([half("Zwift Click"), half("Zwift Click")]), false);
  assert.equal(expectsOtherHalf([]), false);
  assert.deepEqual(deviceActions({ kind: "controller", connected: true, remembered: false, otherHalf: true }), { reconnect: false, other: "Add other half" });
});

test("picking the half that's already connected says which one to pick", () => {
  assert.match(connectErrorText(new Error("Zwift Click is already connected.")), /already connected: pick the other Zwift Click/);
});

