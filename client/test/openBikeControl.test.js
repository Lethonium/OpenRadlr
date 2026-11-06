import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_INFO_CHARACTERISTIC, BUTTON_STATE_CHARACTERISTIC, OBC_BUTTONS, OBC_SERVICE, encodeAppInfo, parseButtonState } from "../public/js/ble/openBikeControlProtocol.js";
import { OpenBikeControlController } from "../public/js/ble/openBikeControl.js";
import { connectController, openController } from "../public/js/ble/controllers.js";
import { ZwiftController } from "../public/js/ble/zwiftController.js";
import { ASYNC_CHARACTERISTIC, SYNC_RX_CHARACTERISTIC, SYNC_TX_CHARACTERISTIC, ZWIFT_SERVICE, encodeHandshake } from "../public/js/ble/zwiftProtocol.js";
import { ControllerInput } from "../public/js/input/controller.js";
import { DeviceLog } from "../public/js/ble/deviceLog.js";
import { fakeTrainer } from "./fakeBluetooth.js";
import { dataView } from "./helpers.js";

// ------------------------------------------------------------- protocol ---

test("a button state message lists the changed buttons with their states", () => {
  // Shift Up pressed, Shift Down released (the spec's example)
  assert.deepEqual(parseButtonState(dataView([0x01, 0x01, 0x01, 0x02, 0x00])), { kind: "buttons", changes: [[0x01, 1], [0x02, 0]] });
});

test("an analog state is kept as it is", () => {
  assert.deepEqual(parseButtonState(dataView([0x01, 0x1b, 0x94])).changes, [[0x1b, 0x94]]);
});

test("a trailing button ID without a state is ignored", () => {
  assert.deepEqual(parseButtonState(dataView([0x01, 0x01, 0x01, 0x14])).changes, [[0x01, 1]]);
});

test("other message types are unknown", () => {
  assert.deepEqual(parseButtonState(dataView([0x03, 0x01, 0x00, 0x00])), { kind: "unknown", type: 0x03 });
  assert.deepEqual(parseButtonState(dataView([])), { kind: "unknown", type: -1 });
});

test("the app information message matches the spec's example", () => {
  const bytes = encodeAppInfo({ appId: "zwift", appVersion: "1.52.0", buttons: [0x01, 0x02, 0x10, 0x14] });
  const text = (s) => [...s].map((c) => c.charCodeAt(0));
  assert.deepEqual([...bytes], [0x04, 0x01, 0x05, ...text("zwift"), 0x06, ...text("1.52.0"), 0x04, 0x01, 0x02, 0x10, 0x14]);
});

// ---------------------------------------------------------------- input ---

test("select, difficulty and camera act only where they make sense", () => {
  const input = new ControllerInput({ now: () => 0 });
  assert.deepEqual(input.update(["harder"], false), ["powerUp"]);
  assert.deepEqual(input.update(["easier", "camera", "select"], false), ["powerDown", "cycleCamera"]);
  assert.deepEqual(input.update([], true), []);
  assert.deepEqual(input.update(["select", "harder", "camera"], true), ["select"]);
});

// --------------------------------------------------------------- device ---

function fakeObc({ name = "BikeControl", appInfo = true } = {}) {
  const fake = fakeTrainer({
    name,
    services: { [OBC_SERVICE]: { [BUTTON_STATE_CHARACTERISTIC]: {}, ...(appInfo ? { [APP_INFO_CHARACTERISTIC]: {} } : {}) } },
  });
  return { ...fake, buttons: fake.characteristics[BUTTON_STATE_CHARACTERISTIC], appInfo: fake.characteristics[APP_INFO_CHARACTERISTIC] };
}

test("the chooser lists Zwift and OpenBikeControl controllers", async () => {
  const fake = fakeObc();
  await connectController(fake.bluetooth);
  const request = fake.bluetooth.requests[0];
  assert.ok(request.filters.some((filter) => filter.services?.includes(OBC_SERVICE)));
  assert.ok(request.filters.some((filter) => filter.namePrefix === "Zwift"));
  assert.ok(request.optionalServices.includes(OBC_SERVICE));
  assert.ok(request.optionalServices.includes(ZWIFT_SERVICE));
});

test("a device with the OpenBikeControl service connects as one and is told which buttons we use", async () => {
  const fake = fakeObc();
  const controller = await connectController(fake.bluetooth);
  assert.ok(controller instanceof OpenBikeControlController);
  assert.equal(controller.label, "BikeControl");
  assert.equal(fake.buttons.notifying, true);
  const [info] = fake.appInfo.writes;
  assert.equal(info[0], 0x04);
  assert.deepEqual(info.slice(-OBC_BUTTONS.size - 1), [OBC_BUTTONS.size, ...OBC_BUTTONS.keys()]);
});

test("a Zwift controller still connects as one, with its handshake", async () => {
  const fake = fakeTrainer({ name: "Zwift Click", services: { [ZWIFT_SERVICE]: { [ASYNC_CHARACTERISTIC]: {}, [SYNC_RX_CHARACTERISTIC]: {}, [SYNC_TX_CHARACTERISTIC]: {} } } });
  const controller = await openController(fake.device);
  assert.ok(controller instanceof ZwiftController);
  assert.deepEqual(fake.characteristics[SYNC_RX_CHARACTERISTIC].writes, [[...encodeHandshake()]]);
});

test("a controller without app information still connects", async () => {
  const fake = fakeObc({ appInfo: false });
  const controller = await openController(fake.device);
  assert.equal(controller.connected, true);
});

test("button changes add up to the buttons held now", async () => {
  const fake = fakeObc();
  const controller = await openController(fake.device);
  const states = [];
  controller.on("buttons", (buttons) => states.push(buttons));
  fake.buttons.notify([0x01, 0x01, 0x01]);
  fake.buttons.notify([0x01, 0x02, 0x01]);
  fake.buttons.notify([0x01, 0x01, 0x00]);
  fake.buttons.notify([0x01, 0x02, 0x00]);
  assert.deepEqual(states, [["shiftUp"], ["shiftUp", "shiftDown"], ["shiftDown"], []]);
});

test("several IDs for one press act as one button; unknown IDs appear in hex", async () => {
  const fake = fakeObc();
  const controller = await openController(fake.device);
  const states = [];
  controller.on("buttons", (buttons) => states.push(buttons));
  // Left and Steer Left together, then Emote
  fake.buttons.notify([0x01, 0x12, 0x01, 0x18, 0x01]);
  fake.buttons.notify([0x01, 0x12, 0x00, 0x18, 0x00, 0x20, 0x01]);
  assert.deepEqual(states, [["left"], ["0x20"]]);
});

test("every button change is logged once with its bytes", async () => {
  const fake = fakeObc();
  const log = new DeviceLog();
  await openController(fake.device, { log });
  for (const bytes of [[0x01, 0x01, 0x01], [0x01, 0x01, 0x01], [0x01, 0x01, 0x00]]) fake.buttons.notify(bytes);
  const lines = log.entries.filter((e) => e.level === "info" && e.message.startsWith("BikeControl:")).map((e) => e.message);
  assert.deepEqual(lines, ["BikeControl: shiftUp (01 01 01)", "BikeControl: released (01 01 00)"]);
});

test("reconnects after the link drops, forgetting what was held and telling the app again", async () => {
  const fake = fakeObc();
  const timers = [];
  const controller = await openController(fake.device, { setTimeout: (fn) => timers.push(fn), clearTimeout: () => {} });
  const events = [];
  controller.on("disconnected", () => events.push("disconnected"));
  controller.on("reconnected", () => events.push("reconnected"));
  controller.on("buttons", (buttons) => events.push(buttons));
  fake.buttons.notify([0x01, 0x01, 0x01]);
  fake.device.gatt.disconnect();
  assert.equal(controller.connected, false);
  await timers.at(-1)();
  fake.buttons.notify([0x01, 0x02, 0x01]);
  assert.deepEqual(events, [["shiftUp"], "disconnected", "reconnected", ["shiftDown"]]);
  assert.equal(fake.appInfo.writes.length, 2);
});

test("a device without either controller service is rejected and released", async () => {
  const fake = fakeTrainer({ name: "KICKR", services: { 0x1826: { 0x2ad2: {} } } });
  await assert.rejects(connectController(fake.bluetooth), /not a Zwift Click/);
  assert.equal(fake.device.connected, false);
});
