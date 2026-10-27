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
import { CONTROLLER_RECONNECT_DELAYS_MS, ZwiftController } from "../public/js/ble/zwiftController.js";
import { ControllerInput, MergedControllers, controllerNavigates } from "../public/js/input/controller.js";
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

test("reconnects after the controller falls asleep, trying every few seconds: a woken controller advertises only briefly", async () => {
  const fake = fakeController();
  const log = new DeviceLog();
  const controller = await ZwiftController.connect(fake.bluetooth, { ...fake.scheduler, log });
  const events = [];
  controller.on("disconnected", () => events.push("disconnected"));
  controller.on("reconnected", () => events.push("reconnected"));

  fake.device.failConnect = true;
  fake.device.gatt.disconnect();
  assert.deepEqual(events, ["disconnected"]);
  assert.equal(fake.scheduler.pending()[0].ms, CONTROLLER_RECONNECT_DELAYS_MS[0]);

  await fake.scheduler.runNext(); // still asleep
  assert.equal(fake.scheduler.pending()[0].ms, CONTROLLER_RECONNECT_DELAYS_MS[1]);
  for (let i = 0; i < 5; i += 1) await fake.scheduler.runNext();
  assert.ok(fake.scheduler.pending()[0].ms <= 2000, "never waits long: a press wakes it for a few seconds only");

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

test("a reconnect attempt that hangs gives up and tries again, instead of never reconnecting", async () => {
  const fake = fakeController();
  const controller = await ZwiftController.connect(fake.bluetooth, fake.scheduler);
  const events = [];
  controller.on("reconnected", () => events.push("reconnected"));
  fake.device.gatt.disconnect();
  fake.device.hangConnect = true;
  const attempt = fake.scheduler.runNext(); // the attempt starts and hangs
  await new Promise((resolve) => setTimeout(resolve, 1));
  const timeout = fake.scheduler.pending().find((timer) => timer.ms === 15_000);
  assert.ok(timeout, "the attempt has a timeout");
  fake.device.hangConnect = false;
  await timeout.fn();
  await attempt;
  assert.ok(fake.scheduler.pending().some((timer) => timer.ms <= 2000), "and another attempt is planned");
  while (fake.scheduler.pending().length) await fake.scheduler.runNext();
  assert.deepEqual(events, ["reconnected"]);
});

test("the device report keeps room for what matters: a repeated battery level is counted, not logged", async () => {
  const fake = fakeController();
  const log = new DeviceLog();
  await ZwiftController.connect(fake.bluetooth, { ...fake.scheduler, log });
  for (let i = 0; i < 30; i += 1) fake.notifications.notify([0x19, 0x10, 0x46]);
  fake.notifications.notify([0x19, 0x10, 0x45]);
  fake.notifications.notify([0xff, 0x05, 0x00, 0xea]);
  const packets = log.entries.filter((e) => e.level === "packet").map((e) => e.message);
  assert.equal(packets.filter((m) => m.includes('"battery"')).length, 2, "the first level and the change");
  assert.ok(packets.some((m) => m.includes("ff 05 00 ea")), "an unknown message still makes it into the report");
  assert.equal(log.packets["zwift battery"], 29);
});

test("focus goes on from where it is, also from a button controllers skip (the one just clicked to pair)", () => {
  const { doc, root, elements, isVisible } = fakeDom(5);
  elements[2].dataset = { gestureOnly: "" };
  doc.activeElement = elements[2];
  assert.equal(moveFocus(root, +1, { doc, isVisible }).id, 3, "the next one, not back to the top");
  doc.activeElement = elements[2];
  assert.equal(moveFocus(root, -1, { doc, isVisible }).id, 1, "the previous one, not the very end");
});

test("controllers skip small print marked data-nav-skip (build label, privacy link)", () => {
  const { root, elements, isVisible } = fakeDom(3);
  elements[0].dataset = { navSkip: "" };
  assert.deepEqual(focusableIn(root, isVisible).map((e) => e.id), [1, 2]);
});

test("a menu opened by mouse keeps the shifters shifting; one opened with the controller is navigated with it", () => {
  assert.equal(controllerNavigates({ screen: null, openedByController: false }), false, "riding");
  assert.equal(controllerNavigates({ screen: "drawer", openedByController: false }), false, "menu opened by mouse: still shifting");
  assert.equal(controllerNavigates({ screen: "drawer", openedByController: true }), true);
  assert.equal(controllerNavigates({ screen: "setup", openedByController: false }), true, "nothing to shift in the start menu");
  assert.equal(controllerNavigates({ screen: "finish", openedByController: false }), true, "nor after the ride");
});

// The Click's status message from a rider's report: "ff 05 00 ea 05", then protobuf; field 2 is its mode.
const clickStatus = (mode) => [0xff, 0x05, 0x00, 0xea, 0x05, 0x18, 0x0a, 0x0c, ...Array.from("D4060F92D980", (c) => c.charCodeAt(0)), 0x10, mode, 0x18, 0x0f, 0x20, 0x08, 0x28, 0x09, 0x30, 0x06];

test("a Click half that reports mode 1 is locked (no plain buttons): it says so instead of reconnecting", async () => {
  const fake = fakeController();
  const controller = await ZwiftController.connect(fake.bluetooth, fake.scheduler);
  const events = [];
  controller.on("locked", (locked) => events.push(locked));
  controller.on("disconnected", () => events.push("disconnected"));
  assert.equal(controller.locked, false);
  fake.notifications.notify(clickStatus(0));
  assert.deepEqual(events, [], "mode 0: unlocked, as it was");
  fake.notifications.notify(clickStatus(1));
  fake.notifications.notify(clickStatus(1));
  assert.equal(controller.locked, true);
  assert.deepEqual(events, [true], "once");
  assert.equal(fake.device.connectCalls, 1, "no reconnect: it wouldn't unlock it");
  fake.notifications.notify(clickStatus(0));
  assert.equal(controller.locked, false);
  assert.deepEqual(events, [true, false]);
});

test("the Click's status message is decoded: its mode, the partner id", () => {
  const view = (bytes) => new DataView(Uint8Array.from(bytes).buffer);
  assert.deepEqual(parseControllerMessage(view(clickStatus(1))), { kind: "status", mode: 1 });
  assert.deepEqual(parseControllerMessage(view(clickStatus(0))), { kind: "status", mode: 0 });
  assert.equal(parseControllerMessage(view([0xff, 0x03, 0x00, 0x0a, 0x21])).kind, "unknown", "the encrypted-looking ones stay unknown");
});

// --- two halves of one Click: one stream -------------------------------------------

test("two halves reporting the same press (one relays the other) shift once", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  assert.deepEqual(merged.update("right", ["shiftUp"], false), ["shiftUp"]);
  t = 30;
  assert.deepEqual(merged.update("left", ["shiftUp"], false), [], "the relayed copy");
  t = 200;
  merged.update("right", [], false);
  assert.deepEqual(merged.update("left", [], false), []);
});

test("a relayed copy that comes just after the release still counts as the same press", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  assert.deepEqual(merged.update("right", ["shiftUp"], false), ["shiftUp"]);
  t = 150;
  merged.update("right", [], false);
  t = 200;
  assert.deepEqual(merged.update("left", ["shiftUp"], false), [], "50 ms after the release: the same press");
  t = 260;
  merged.update("left", [], false);
});

test("separate presses still shift every time, also quickly one after another", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  const shifts = [];
  for (let i = 0; i < 3; i += 1) {
    shifts.push(...merged.update("right", ["shiftUp"], false));
    t += 120;
    merged.update("right", [], false);
    t += 200; // the rider's fastest real repeats were about 200 ms apart
  }
  assert.deepEqual(shifts, ["shiftUp", "shiftUp", "shiftUp"]);
  assert.deepEqual(merged.update("left", ["shiftDown"], false), ["shiftDown"], "the other half's own button");
});

test("a half that drops is forgotten: its held buttons don't block the other half", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  merged.update("left", ["shiftDown"], false);
  merged.forget("left");
  t = 400;
  assert.deepEqual(merged.update("right", ["shiftDown"], false), ["shiftDown"]);
});

test("fast repeats on the same half always shift: only a copy from the other half is merged", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  const shifts = [];
  // The rider's fastest repeats: pressed again about 90 ms after the release.
  for (let i = 0; i < 4; i += 1) {
    shifts.push(...merged.update("right", ["shiftUp"], false));
    t += 100;
    merged.update("right", [], false);
    t += 90;
  }
  assert.deepEqual(shifts, ["shiftUp", "shiftUp", "shiftUp", "shiftUp"]);
});

test("a half that never says more than its own buttons doesn't relay; one that sends battery or status does", async () => {
  const relaying = fakeController();
  const a = await ZwiftController.connect(relaying.bluetooth, relaying.scheduler);
  assert.equal(a.relays, false);
  relaying.notifications.notify([0x19, 0x10, 0x46]);
  assert.equal(a.relays, true, "battery: the half that relays");
  const own = fakeController();
  const b = await ZwiftController.connect(own.bluetooth, own.scheduler);
  own.notifications.notify([0x23, 0x08, 0xff, 0xdf, 0xff, 0xff, 0x0f]);
  assert.equal(b.relays, false, "buttons only");
});

test("a locked left half is rebooted with 0x18 (zwiftboard's pod reset), once per lock, and comes back by itself", async () => {
  const fake = fakeController();
  const log = new DeviceLog();
  const controller = await ZwiftController.connect(fake.bluetooth, { ...fake.scheduler, log });
  const events = [];
  controller.on("disconnected", () => events.push("disconnected"));
  controller.on("reconnected", () => events.push("reconnected"));
  // The reset reboots the pod: it drops the link, then advertises again.
  fake.commands.onWrite = (bytes) => bytes.length === 1 && bytes[0] === 0x18 && setTimeout(() => fake.device.gatt.disconnect(), 0);
  fake.notifications.notify(clickStatus(1));
  fake.notifications.notify(clickStatus(1));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(fake.commands.writes.filter((w) => w.length === 1), [[0x18]], "one reset");
  assert.deepEqual(events, [], "a planned reboot: no 'disconnected' for the rider");
  await fake.scheduler.runNext(); // the reconnect after the reboot
  assert.ok(controller.connected);
  assert.equal(fake.commands.writes.at(-1).length, 6, "the handshake again");
  assert.ok(log.entries.some((e) => e.message.includes("rebooting")));
});

test("+ then − quickly is two shifts, not both together (which opens the menu)", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  assert.deepEqual(merged.update("left", ["shiftUp"], false), ["shiftUp"]);
  t = 180;
  merged.update("left", [], false);
  t = 210; // the rider's report: − 30 ms after + was let go
  assert.deepEqual(merged.update("left", ["shiftDown"], false), ["shiftDown"]);
});

test("pressing + and − together still opens the menu", () => {
  let t = 0;
  const merged = new MergedControllers(new ControllerInput({ now: () => t }), { now: () => t });
  merged.update("left", ["shiftUp"], false);
  t = 60;
  assert.deepEqual(merged.update("left", ["shiftUp", "shiftDown"], false), ["shiftDown", "toggleMenu"]);
});
