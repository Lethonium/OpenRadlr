import { test } from "node:test";
import assert from "node:assert/strict";
import { addonsShown, chooseRideMode, connectErrorText, controllerCheck, deviceActions, liveCheck, rideModes } from "../public/js/view/deviceSetup.js";

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

test("the controller check names what was pressed, in the rider's terms", () => {
  assert.equal(controllerCheck(null), "Press + or − to check");
  assert.equal(controllerCheck({ label: "Zwift Click", buttons: ["shiftUp"] }), "✓ Zwift Click: shift up (+)");
  assert.equal(controllerCheck({ label: "Zwift Play", buttons: ["a", "shiftDown"] }), "✓ Zwift Play: A, shift down (−)");
  assert.equal(controllerCheck({ label: "Zwift Ride", buttons: ["0x400"] }), "✓ Zwift Ride: button 0x400");
});
