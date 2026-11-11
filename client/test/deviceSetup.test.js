import { test } from "node:test";
import assert from "node:assert/strict";
import { addonsShown, chooseRideMode, connectErrorText, controllerCheck, controllerLine, controllerSide, deviceActions, deviceLine, expectsOtherHalf, heartRateCheck, liveCheck, missingHalfHint, needsDownButton, remapForDown, DOWN_BUTTON, rideModes } from "../public/js/view/deviceSetup.js";

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
  assert.match(connectErrorText(err("SecurityError")), /isn't allowed to use Bluetooth.*site settings.*phone's settings/);
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
  assert.equal(controllerLine([click(null, null), click(null, null)]), "Zwift Click · both halves", "a pair before anything is known");
  assert.equal(controllerLine([click("−", 70), click(null, null)]), "Zwift Click − 70 % · other half");
  assert.equal(controllerLine([click("−", 70)]), "Zwift Click − 70 %");
  assert.equal(controllerLine([click("−", 70), click("+", 68, false)]), "Zwift Click − 70 % · + reconnecting…");
  assert.equal(controllerLine([click("+", 68), { label: "Zwift Play", seen: new Set(), battery: 50, connected: true }]), "Zwift Click + 68 % · Zwift Play 50 %");
});

test("one Click or Play half connected: the other half is expected", () => {
  const half = (label, seen = []) => ({ label, seen: new Set(seen), connected: true });
  // Click v2 halves differ: one relays the other, one sends only its own side. Both, to be sure.
  assert.equal(expectsOtherHalf([half("Zwift Click", ["shiftUp"])]), true);
  assert.equal(expectsOtherHalf([half("Zwift Play")]), true);
  assert.equal(expectsOtherHalf([half("Zwift Play", ["shiftUp", "shiftDown"])]), false);
  assert.equal(expectsOtherHalf([half("Zwift Ride")]), false);
  assert.equal(expectsOtherHalf([half("Zwift Click"), half("Zwift Click")]), false);
  assert.equal(expectsOtherHalf([]), false);
  assert.deepEqual(deviceActions({ kind: "controller", connected: true, remembered: false, otherHalf: true }), { reconnect: false, other: "Add other half" });
});

test("a lone Click half that only sends its own side asks for the other half", () => {
  const half = (seen, relays) => ({ label: "Zwift Click", seen: new Set(seen), connected: true, relays });
  assert.equal(missingHalfHint([half(["shiftUp"], false)]), "Right half only: + shifts up, B shifts down. Add the other half for the − lever.");
  assert.equal(missingHalfHint([half([], false)]), "Right half only: + shifts up, B shifts down. Add the other half for the − lever.");
  assert.equal(missingHalfHint([half([], true)]), null, "it relays: both sides arrive");
  assert.equal(missingHalfHint([half([], false), half([], true)]), null, "both connected");
  assert.equal(missingHalfHint([{ label: "Zwift Ride", seen: new Set(), connected: true, relays: false }]), null);
});

test("picking the half that's already connected says which one to pick", () => {
  assert.match(connectErrorText(new Error("Zwift Click is already connected.")), /already connected: pick the other Zwift Click/);
});


// --- Click v2: shifting down when the left half can't ------------------------------------

const clickHalf = ({ relays, locked = false, connected = true }) => ({ label: "Zwift Click", seen: new Set(), relays, locked, connected });

test("a fallback button for shifting down is needed when no unlocked left Click half is connected", () => {
  assert.equal(needsDownButton([clickHalf({ relays: true })]), false, "the left half shifts down itself");
  assert.equal(needsDownButton([clickHalf({ relays: true, locked: true })]), true, "locked by Zwift's firmware");
  assert.equal(needsDownButton([clickHalf({ relays: false })]), true, "the right half alone has no −");
  assert.equal(needsDownButton([clickHalf({ relays: true }), clickHalf({ relays: false })]), false);
  assert.equal(needsDownButton([clickHalf({ relays: true, locked: true }), clickHalf({ relays: false })]), true);
  assert.equal(needsDownButton([{ label: "Zwift Ride", seen: new Set(), relays: true, locked: false, connected: true }]), false, "only the Click v2");
  assert.equal(needsDownButton([]), false);
});

test("while needed, B on the right half shifts down (BikeControl's right-side mapping); otherwise buttons stay as they are", () => {
  assert.equal(DOWN_BUTTON, "b");
  assert.deepEqual(remapForDown(["b"], true), ["shiftDown"]);
  assert.deepEqual(remapForDown(["b", "shiftUp"], true), ["shiftDown", "shiftUp"]);
  assert.deepEqual(remapForDown(["b"], false), ["b"]);
  assert.deepEqual(remapForDown(["a"], true), ["a"]);
});

const strap = (connected = true) => ({ label: "Fitbit Air", connected });

test("a device line with nothing connected or remembered names the kind and what it's for", () => {
  assert.deepEqual(deviceLine({ kind: "hr" }), { state: "idle", title: "Heart rate", detail: "Optional" });
  assert.deepEqual(deviceLine({ kind: "trainer" }), { state: "idle", title: "Smart trainer", detail: "Not connected" });
  assert.deepEqual(deviceLine({ kind: "controller" }), { state: "idle", title: "Controller", detail: "Zwift or OpenBikeControl" });
});

test("a remembered device that isn't connected is named, with its state", () => {
  assert.deepEqual(deviceLine({ kind: "hr", remembered: ["Fitbit Air"] }), { state: "remembered", title: "Fitbit Air", detail: "Saved" });
  assert.equal(deviceLine({ kind: "controller", remembered: ["Zwift Click", "Zwift Click"] }).title, "Zwift Click + Zwift Click");
});

test("while the picker is open or a device connects, the line says so under the name", () => {
  const picking = deviceLine({ kind: "hr", attempt: { state: "pending", text: "Pick your heart rate strap…" } });
  assert.deepEqual(picking, { state: "pending", title: "Heart rate", detail: "Pick your heart rate strap…" });
  assert.equal(deviceLine({ kind: "hr", remembered: ["Fitbit Air"], attempt: { state: "pending", text: "Looking for Fitbit Air…" } }).title, "Fitbit Air");
});

test("a connected device shows its name and what it measures right now", () => {
  assert.deepEqual(deviceLine({ kind: "hr", device: strap() }), { state: "connected", title: "Fitbit Air", detail: "Connected" });
  assert.deepEqual(deviceLine({ kind: "hr", device: strap(), live: { state: "live", text: "144 bpm" } }), { state: "live", title: "Fitbit Air", detail: "144 bpm" });
  assert.equal(deviceLine({ kind: "trainer", device: { label: "KICKR", connected: true }, live: { state: "silent", text: "No data for 7 s" } }).state, "silent");
  assert.equal(deviceLine({ kind: "trainer", device: { label: "KICKR", connected: true }, live: { state: "waiting", text: "Connected · waiting for data…" } }).state, "connected");
});

test("a connected device stays on its line when trying another one fails or is cancelled", () => {
  const line = deviceLine({ kind: "hr", device: strap(), live: { state: "live", text: "144 bpm" }, attempt: { state: "error", text: "Cancelled" } });
  assert.deepEqual(line, { state: "live", title: "Fitbit Air", detail: "144 bpm" });
});

test("picking another device while one is connected keeps the connected name in view", () => {
  const line = deviceLine({ kind: "controller", device: { label: "Zwift Click +", connected: true }, attempt: { state: "pending", text: "Pick the other Zwift Click…" } });
  assert.deepEqual(line, { state: "pending", title: "Zwift Click +", detail: "Pick the other Zwift Click…" });
});

test("a dropped device is reconnecting, not gone", () => {
  assert.deepEqual(deviceLine({ kind: "hr", device: strap(false), live: { state: "live", text: "144 bpm" } }), { state: "reconnecting", title: "Fitbit Air", detail: "Reconnecting…" });
});

test("a failed connect says what to try, under the device it was for", () => {
  const error = { state: "error", text: "No answer from Fitbit Air." };
  assert.deepEqual(deviceLine({ kind: "hr", remembered: ["Fitbit Air"], attempt: error }), { state: "error", title: "Fitbit Air", detail: "No answer from Fitbit Air." });
  assert.equal(deviceLine({ kind: "trainer", attempt: error }).title, "Smart trainer");
});

test("the heart rate check: waiting for the first beat, the bpm, a hint when beats stop", () => {
  assert.deepEqual(heartRateCheck({ sinceDataMs: null, heartRate: null }), { state: "waiting", text: "Connected · waiting for data…" });
  assert.deepEqual(heartRateCheck({ sinceDataMs: 800, heartRate: 144 }), { state: "live", text: "♥ 144 bpm" });
  assert.equal(heartRateCheck({ sinceDataMs: 12000, heartRate: 144 }).state, "silent");
  assert.match(heartRateCheck({ sinceDataMs: 12000, heartRate: 144 }).text, /12 s/);
});
