import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASYNC_CHARACTERISTIC,
  SYNC_RX_CHARACTERISTIC,
  SYNC_TX_CHARACTERISTIC,
  ZWIFT_COMPANY_ID,
  ZWIFT_SERVICE,
  encodeHandshake,
  parseControllerMessage,
  readFields,
} from "../public/js/ble/zwiftProtocol.js";
import { RECONNECT_DELAYS_MS, ZwiftController } from "../public/js/ble/zwiftController.js";
import { ControllerInput } from "../public/js/input/controller.js";
import { activateFocused, focusableIn, moveFocus } from "../public/js/input/focusNav.js";
import { DeviceLog } from "../public/js/ble/deviceLog.js";
import { fakeTrainer } from "./fakeBluetooth.js";
import { dataView } from "./helpers.js";

// ------------------------------------------------------------- protocol ---

test("the handshake is the ASCII text RideOn", () => {
  assert.equal(new TextDecoder().decode(encodeHandshake()), "RideOn");
});

test("recognises the controller's RideOn answer", () => {
  assert.deepEqual(parseControllerMessage(dataView([...encodeHandshake(), 0x01, 0x03])), { kind: "handshake" });
});

test("click: plus pressed, minus released", () => {
  // type 0x37, field 1 = 0 (pressed), field 2 = 1 (released)
  assert.deepEqual(parseControllerMessage(dataView([0x37, 0x08, 0x00, 0x10, 0x01])), { kind: "buttons", buttons: ["shiftUp"] });
});

test("click: both pressed and both released", () => {
  assert.deepEqual(parseControllerMessage(dataView([0x37, 0x08, 0x00, 0x10, 0x00])).buttons, ["shiftUp", "shiftDown"]);
  assert.deepEqual(parseControllerMessage(dataView([0x37, 0x08, 0x01, 0x10, 0x01])).buttons, []);
});

test("click: a missing field counts as not pressed", () => {
  assert.deepEqual(parseControllerMessage(dataView([0x37, 0x10, 0x00])).buttons, ["shiftDown"]);
});

test("play: the right half has Y/Z/A/B and shifts up", () => {
  // right pad (1 = 0), A pressed (4 = 0), shift paddle pressed (7 = 0), the rest released
  const bytes = [0x07, 0x08, 0x00, 0x10, 0x01, 0x18, 0x01, 0x20, 0x00, 0x28, 0x01, 0x30, 0x01, 0x38, 0x00];
  assert.deepEqual(parseControllerMessage(dataView(bytes)).buttons, ["a", "shiftUp"]);
});

test("play: the left half has the d-pad and shifts down", () => {
  // left pad (1 = 1), Y/up pressed (2 = 0), shift paddle pressed
  const bytes = [0x07, 0x08, 0x01, 0x10, 0x00, 0x18, 0x01, 0x20, 0x01, 0x28, 0x01, 0x38, 0x00];
  assert.deepEqual(parseControllerMessage(dataView(bytes)).buttons, ["up", "shiftDown"]);
});

test("ride: cleared bits in the button map are pressed buttons", () => {
  // all released except LEFT (0x1) and right lever shift up (0x2000)
  const map = 0xffffffff - 0x1 - 0x2000;
  const bytes = [0x23, 0x08, ...varint(map)];
  assert.deepEqual(parseControllerMessage(dataView(bytes)).buttons, ["left", "shiftUp"]);
});

test("ride: both buttons of a lever give one shift", () => {
  assert.deepEqual(parseControllerMessage(dataView([0x23, 0x08, ...varint(0xffffffff - 0x1000 - 0x2000)])).buttons, ["shiftUp"]);
  assert.deepEqual(parseControllerMessage(dataView([0x23, 0x08, ...varint(0xffffffff - 0x100 - 0x200)])).buttons, ["shiftDown"]);
});

test("click v2: bytes recorded from a real controller", () => {
  const buttons = (hex) => parseControllerMessage(dataView(hex.split(" ").map((b) => parseInt(b, 16)))).buttons;
  assert.deepEqual(buttons("23 08 fd ff ff ff 0f"), ["up"]);
  assert.deepEqual(buttons("23 08 f7 ff ff ff 0f"), ["down"]);
  assert.deepEqual(buttons("23 08 fe ff ff ff 0f"), ["left"]);
  assert.deepEqual(buttons("23 08 fb ff ff ff 0f"), ["right"]);
  assert.deepEqual(buttons("23 08 ff fd ff ff 0f"), ["shiftDown"], "−");
  assert.deepEqual(buttons("23 08 ef ff ff ff 0f"), ["a"]);
  assert.deepEqual(buttons("23 08 df ff ff ff 0f"), ["b"]);
  assert.deepEqual(buttons("23 08 bf ff ff ff 0f"), ["y"]);
  assert.deepEqual(buttons("23 08 ff fe ff ff 0f"), ["z"]);
  assert.deepEqual(buttons("23 08 ff df ff ff 0f"), ["shiftUp"], "+");
  assert.deepEqual(buttons("23 08 ff ff ff ff 0f"), []);
});

test("ride: analog paddle data after the button map is skipped", () => {
  const map = 0xffffffff - 0x10;
  const analog = [0x12, 0x04, 0x08, 0x00, 0x10, 0x05]; // field 2, length-delimited
  assert.deepEqual(parseControllerMessage(dataView([0x23, 0x08, ...varint(map), ...analog])).buttons, ["a"]);
});

test("ride: pressed bits without a known name are reported in hex", () => {
  const map = 0xffffffff - 0x400;
  assert.deepEqual(parseControllerMessage(dataView([0x23, 0x08, ...varint(map)])).buttons, ["0x400"]);
});

test("ride: a message without a button map is not a release", () => {
  assert.deepEqual(parseControllerMessage(dataView([0x23, 0x12, 0x02, 0x08, 0x00])), { kind: "idle" });
});

test("battery level and idle messages", () => {
  assert.deepEqual(parseControllerMessage(dataView([0x19, 0x10, 0x64])), { kind: "battery", level: 100 }, "recorded from a Click v2");
  assert.deepEqual(parseControllerMessage(dataView([0x19, 0x08, 0x5a])), { kind: "battery", level: 90 });
  assert.deepEqual(parseControllerMessage(dataView([0x15])), { kind: "idle" });
  assert.deepEqual(parseControllerMessage(dataView([0x42, 0x08, 0x01])), { kind: "unknown", type: 0x42 });
});

test("protobuf reader stops at truncated data instead of throwing", () => {
  assert.deepEqual([...readFields(Uint8Array.from([0x08, 0x96, 0x01, 0x10]))], [[1, 150]]);
});

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return bytes;
}

// ---------------------------------------------------------------- input ---

function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

test("shift buttons shift while riding, as soon as they are pressed", () => {
  const input = new ControllerInput({ now: clock().now });
  assert.deepEqual(input.update(["shiftUp"], false), ["shiftUp"]);
  assert.deepEqual(input.update(["shiftUp"], false), [], "holding does not repeat");
  assert.deepEqual(input.update([], false), [], "releasing does nothing");
  assert.deepEqual(input.update(["shiftDown"], false), ["shiftDown"]);
});

test("the same buttons move the focus while navigating", () => {
  const input = new ControllerInput({ now: clock().now });
  assert.deepEqual(input.update(["shiftUp"], true), ["focusNext"]);
  assert.deepEqual(input.update([], true), []);
  assert.deepEqual(input.update(["shiftDown"], true), ["focusPrev"]);
});

test("pressing both shift buttons at once opens the menu while riding", () => {
  const input = new ControllerInput({ now: clock().now });
  assert.deepEqual(input.update(["shiftUp", "shiftDown"], false), ["toggleMenu"]);
  assert.deepEqual(input.update(["shiftDown"], false), [], "letting go of one is not a new press");
});

test("a chord right after the first button undoes that button's shift", () => {
  const c = clock();
  const input = new ControllerInput({ now: c.now, chordMs: 250 });
  assert.deepEqual(input.update(["shiftUp"], false), ["shiftUp"]);
  c.t = 120;
  assert.deepEqual(input.update(["shiftUp", "shiftDown"], false), ["shiftDown", "toggleMenu"]);
});

test("a chord selects while navigating, undoing the focus step", () => {
  const c = clock();
  const input = new ControllerInput({ now: c.now });
  assert.deepEqual(input.update(["shiftDown"], true), ["focusPrev"]);
  c.t = 100;
  assert.deepEqual(input.update(["shiftDown", "shiftUp"], true), ["focusNext", "select"]);
});

test("holding one shift button and pressing the other later is just a shift", () => {
  const c = clock();
  const input = new ControllerInput({ now: c.now, chordMs: 250 });
  input.update(["shiftUp"], false);
  c.t = 1000;
  assert.deepEqual(input.update(["shiftUp", "shiftDown"], false), ["shiftDown"]);
});

test("d-pad and face buttons map to game actions", () => {
  const input = new ControllerInput({ now: clock().now });
  assert.deepEqual(input.update(["left"], false), ["laneLeft"]);
  assert.deepEqual(input.update(["right", "y"], false), ["laneRight", "toggleMenu"]);
  assert.deepEqual(input.update([], true), []);
  assert.deepEqual(input.update(["down"], true), ["focusNext"]);
  assert.deepEqual(input.update(["a"], true), ["select"]);
  assert.deepEqual(input.update(["b"], true), ["closePanels"]);
});

// --------------------------------------------------------------- device ---

function fakeController({ name = "Zwift Click" } = {}) {
  const fake = fakeTrainer({
    name,
    services: { [ZWIFT_SERVICE]: { [ASYNC_CHARACTERISTIC]: {}, [SYNC_RX_CHARACTERISTIC]: {}, [SYNC_TX_CHARACTERISTIC]: {} } },
  });
  const timers = [];
  const scheduler = {
    setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimeout: (id) => (timers[id] = null),
    pending: () => timers.filter(Boolean),
    async runNext() {
      const index = timers.findIndex(Boolean);
      const timer = timers[index];
      timers[index] = null;
      await timer.fn();
    },
  };
  return { ...fake, scheduler, notifications: fake.characteristics[ASYNC_CHARACTERISTIC], commands: fake.characteristics[SYNC_RX_CHARACTERISTIC] };
}

test("connecting asks for Zwift devices, subscribes and sends the handshake", async () => {
  const fake = fakeController();
  const controller = await ZwiftController.connect(fake.bluetooth, fake.scheduler);
  const request = fake.bluetooth.requests[0];
  assert.deepEqual(request.filters[0], { manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] });
  assert.ok(request.optionalServices.includes(ZWIFT_SERVICE));
  assert.equal(fake.notifications.notifying, true);
  assert.deepEqual(fake.commands.writes, [[...encodeHandshake()]]);
  assert.equal(controller.label, "Zwift Click");
});

test("button notifications are emitted as button names", async () => {
  const fake = fakeController();
  const controller = await ZwiftController.connect(fake.bluetooth, fake.scheduler);
  const states = [];
  controller.on("buttons", (buttons) => states.push(buttons));
  fake.notifications.notify([0x37, 0x08, 0x00, 0x10, 0x01]);
  fake.notifications.notify([0x37, 0x08, 0x01, 0x10, 0x01]);
  assert.deepEqual(states, [["shiftUp"], []]);
});

test("battery notifications update the battery level", async () => {
  const fake = fakeController();
  const controller = await ZwiftController.connect(fake.bluetooth, fake.scheduler);
  fake.notifications.notify([0x19, 0x10, 0x40]);
  assert.equal(controller.battery, 64);
});

test("every button change is logged once with its bytes", async () => {
  const fake = fakeController();
  const log = new DeviceLog();
  await ZwiftController.connect(fake.bluetooth, { ...fake.scheduler, log });
  for (const bytes of [[0x37, 0x08, 0x00, 0x10, 0x01], [0x37, 0x08, 0x00, 0x10, 0x01], [0x37, 0x08, 0x01, 0x10, 0x01]]) fake.notifications.notify(bytes);
  const lines = log.entries.filter((e) => e.level === "info" && e.message.startsWith("Zwift Click:")).map((e) => e.message);
  assert.deepEqual(lines, ["Zwift Click: shiftUp (37 08 00 10 01)", "Zwift Click: released (37 08 01 10 01)"]);
});

test("the same controller cannot be connected twice", async () => {
  const fake = fakeController();
  await assert.rejects(ZwiftController.connect(fake.bluetooth, { ...fake.scheduler, isConnected: () => true }), /already connected/);
  assert.deepEqual(fake.commands.writes, [], "no second handshake");
});

test("a device without the controller service is rejected and released", async () => {
  const fake = fakeTrainer({ name: "Zwift Hub", services: { 0x1826: { 0x2ad2: {} } } });
  await assert.rejects(ZwiftController.connect(fake.bluetooth), /not a Zwift Click/);
  assert.equal(fake.device.connected, false);
});

test("reconnects after the controller falls asleep, with a growing delay", async () => {
  const fake = fakeController();
  const log = new DeviceLog();
  const controller = await ZwiftController.connect(fake.bluetooth, { ...fake.scheduler, log });
  const events = [];
  controller.on("disconnected", () => events.push("disconnected"));
  controller.on("reconnected", () => events.push("reconnected"));

  fake.device.failConnect = true;
  fake.device.gatt.disconnect();
  assert.deepEqual(events, ["disconnected"]);
  assert.equal(fake.scheduler.pending()[0].ms, RECONNECT_DELAYS_MS[0]);

  await fake.scheduler.runNext(); // still asleep
  assert.equal(fake.scheduler.pending()[0].ms, RECONNECT_DELAYS_MS[1]);

  fake.device.failConnect = false;
  await fake.scheduler.runNext();
  assert.deepEqual(events, ["disconnected", "reconnected"]);
  assert.equal(fake.scheduler.pending().length, 0);
  assert.equal(fake.commands.writes.length, 2, "handshake sent again");

  const states = [];
  controller.on("buttons", (buttons) => states.push(buttons));
  fake.notifications.notify([0x37, 0x08, 0x01, 0x10, 0x00]);
  assert.deepEqual(states, [["shiftDown"]], "one listener, not two");
});

test("disconnecting on purpose stops reconnecting", async () => {
  const fake = fakeController();
  const controller = await ZwiftController.connect(fake.bluetooth, fake.scheduler);
  fake.device.failConnect = true;
  fake.device.gatt.disconnect();
  assert.equal(fake.scheduler.pending().length, 1);
  controller.disconnect();
  assert.equal(fake.scheduler.pending().length, 0);
});

// ---------------------------------------------------------------- focus ---

function fakeDom(count, { disabled = [] } = {}) {
  const doc = { activeElement: null, body: { tag: "body" } };
  const elements = Array.from({ length: count }, (_, i) => ({
    id: i,
    disabled: disabled.includes(i),
    clicks: 0,
    focus() {
      doc.activeElement = this;
    },
    click() {
      this.clicks += 1;
    },
  }));
  const root = { querySelectorAll: () => elements, contains: (element) => elements.includes(element) };
  doc.activeElement = doc.body;
  return { doc, root, elements, isVisible: () => true };
}

test("focus starts at the first element and wraps around", () => {
  const { doc, root, isVisible } = fakeDom(3);
  assert.equal(moveFocus(root, +1, { doc, isVisible }).id, 0);
  assert.equal(moveFocus(root, +1, { doc, isVisible }).id, 1);
  assert.equal(moveFocus(root, +1, { doc, isVisible }).id, 2);
  assert.equal(moveFocus(root, +1, { doc, isVisible }).id, 0);
  assert.equal(moveFocus(root, -1, { doc, isVisible }).id, 2);
});

test("focus skips disabled elements and starts at the end going back", () => {
  const { doc, root, isVisible } = fakeDom(3, { disabled: [2] });
  assert.deepEqual(focusableIn(root, isVisible).map((e) => e.id), [0, 1]);
  assert.equal(moveFocus(root, -1, { doc, isVisible }).id, 1);
});

test("focus skips buttons that need a real tap", () => {
  const { root, elements, isVisible } = fakeDom(3);
  elements[1].dataset = { gestureOnly: "" };
  assert.deepEqual(focusableIn(root, isVisible).map((e) => e.id), [0, 2]);
});

test("select clicks the focused element only inside the root", () => {
  const { doc, root, elements, isVisible } = fakeDom(2);
  assert.equal(activateFocused(root, { doc }), false);
  moveFocus(root, +1, { doc, isVisible });
  assert.equal(activateFocused(root, { doc }), true);
  assert.equal(elements[0].clicks, 1);
});
