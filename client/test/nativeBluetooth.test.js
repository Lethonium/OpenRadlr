import { test } from "node:test";
import assert from "node:assert/strict";
import { HeartRateMonitor, SmartTrainer, isBluetoothAvailable } from "../public/js/ble/devices.js";
import { grantedDevices } from "../public/js/ble/knownDevices.js";
import { encodeRequestControl, encodeSimulationParameters, encodeStartOrResume } from "../public/js/ble/ftms.js";
import { NativeBluetooth, dataViewOf, hexOf, scanOptions, uuidString } from "../public/js/ble/nativeBluetooth.js";
import { ZWIFT_COMPANY_ID } from "../public/js/ble/zwiftProtocol.js";
import { base64Of, installNativeApp, nativePlugins, nativeWakeLock, shareFiles } from "../public/js/native/app.js";
import { fakeBlePlugin, memoryStorage, strapDevice, trainerDevice } from "./fakeBlePlugin.js";

const FTMS = "00001826-0000-1000-8000-00805f9b34fb";
const BIKE_DATA = "00002ad2-0000-1000-8000-00805f9b34fb";
const CONTROL = "00002ad9-0000-1000-8000-00805f9b34fb";
/** Indoor Bike Data with cadence and power. */
const bikeData = (power, cadence) => hexOf(Uint8Array.from([0x44, 0x00, 0x00, 0x00, (cadence * 2) & 0xff, (cadence * 2) >> 8, power & 0xff, power >> 8]));

/** Timers that only run when the test says so. */
function manualTimers() {
  const timers = [];
  return {
    setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimeout: (id) => (timers[id] = null),
    async runNext() {
      const index = timers.findIndex(Boolean);
      const timer = timers[index];
      timers[index] = null;
      await timer.fn();
    },
  };
}

function setup(devices = [trainerDevice()], options) {
  const fake = fakeBlePlugin({ devices, ...options });
  const storage = memoryStorage();
  const bluetooth = new NativeBluetooth({ plugin: fake.plugin, storage });
  return { fake, storage, bluetooth };
}

test("spells UUIDs the way the plugin expects them", () => {
  assert.equal(uuidString(0x1826), FTMS);
  assert.equal(uuidString("2AD2"), BIKE_DATA);
  assert.equal(uuidString("0000FC82"), "0000fc82-0000-1000-8000-00805f9b34fb");
  assert.equal(uuidString("00000001-19CA-4651-86E5-FA29DCDD09D1"), "00000001-19ca-4651-86e5-fa29dcdd09d1");
});

test("converts bytes to the plugin's hex strings and back, with or without spaces", () => {
  assert.equal(hexOf(Uint8Array.from([0x00, 0x0a, 0xff])), "000aff");
  assert.equal(hexOf(new DataView(Uint8Array.from([1, 2, 3, 4]).buffer, 1, 2)), "0203");
  assert.deepEqual([...new Uint8Array(dataViewOf("0a 1b ff").buffer)], [0x0a, 0x1b, 0xff]);
  assert.equal(dataViewOf(undefined).byteLength, 0);
});

test("turns the trainer chooser's alternatives into one service filter", () => {
  assert.deepEqual(scanOptions({ filters: [{ services: [0x1826] }, { services: [0x1818] }], optionalServices: [0x1826] }), {
    services: [FTMS, "00001818-0000-1000-8000-00805f9b34fb"],
  });
});

test("looks for a remembered device by its name", () => {
  assert.deepEqual(scanOptions({ filters: [{ name: "KICKR CORE" }] }), { name: "KICKR CORE" });
  assert.deepEqual(scanOptions({ filters: [{ name: "Zwift Play L" }, { name: "Zwift Play R" }] }), { namePrefix: "Zwift Play " });
});

test("finds Zwift controllers by their name prefix", () => {
  const filters = [{ manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }, { namePrefix: "Zwift" }];
  assert.deepEqual(scanOptions({ filters }), { namePrefix: "Zwift" });
});

test("a cancelled picker rejects like the browser's chooser", async () => {
  const { fake, bluetooth } = setup();
  fake.fail.requestDevice = "requestDevice cancelled.";
  await assert.rejects(bluetooth.requestDevice({ filters: [{ services: [0x1826] }] }), { name: "NotFoundError" });
});

test("asks for the Bluetooth permission only once", async () => {
  const { fake, bluetooth } = setup();
  await bluetooth.requestDevice({ filters: [{ services: [0x1826] }] });
  await bluetooth.requestDevice({ filters: [{ services: [0x1826] }] });
  assert.equal(fake.calls.filter((call) => call.method === "initialize").length, 1);
});

test("a smart trainer streams power and follows the road through the native plugin", async () => {
  const { fake, bluetooth } = setup();
  const trainer = await SmartTrainer.connect(bluetooth);
  const readings = [];
  trainer.on("data", (reading) => readings.push(reading));

  fake.notify("trainer-1", FTMS, BIKE_DATA, bikeData(250, 90));
  assert.equal(readings.at(-1).power, 250);
  assert.equal(readings.at(-1).cadence, 90);

  assert.equal(trainer.canControlResistance, true);
  await trainer.setGrade(4);
  const controlWrites = fake.writes.filter((write) => write.characteristic === CONTROL).map((write) => write.value);
  assert.deepEqual(controlWrites, [hexOf(encodeRequestControl()), hexOf(encodeStartOrResume()), hexOf(encodeSimulationParameters({ gradePercent: 4 }))]);
});

test("notifications spelled with short UUIDs (iOS) reach the trainer too", async () => {
  const { fake, bluetooth } = setup();
  const trainer = await SmartTrainer.connect(bluetooth);
  const readings = [];
  trainer.on("data", (reading) => readings.push(reading));
  fake.notify("trainer-1", "1826", "2ad2", bikeData(180, 80));
  assert.equal(readings.at(-1).power, 180);
});

test("a dropped trainer reconnects without the picker and keeps streaming", async () => {
  const { fake, bluetooth } = setup();
  const timers = manualTimers();
  const trainer = await SmartTrainer.connect(bluetooth, timers);
  const events = [];
  trainer.on("disconnected", () => events.push("disconnected"));
  trainer.on("reconnected", () => events.push("reconnected"));
  const readings = [];
  trainer.on("data", (reading) => readings.push(reading));

  fake.drop("trainer-1");
  assert.deepEqual(events, ["disconnected"]);
  await timers.runNext();
  assert.deepEqual(events, ["disconnected", "reconnected"]);
  assert.equal(fake.calls.filter((call) => call.method === "requestDevice").length, 1);

  fake.notify("trainer-1", FTMS, BIKE_DATA, bikeData(200, 85));
  assert.equal(readings.length, 1, "one native listener per characteristic, not one per connect");
});

test("disconnecting on purpose closes the native link and stops reconnecting", async () => {
  const { fake, bluetooth } = setup();
  const timers = manualTimers();
  const trainer = await SmartTrainer.connect(bluetooth, timers);
  const events = [];
  trainer.on("disconnected", () => events.push("disconnected"));
  trainer.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fake.isConnected("trainer-1"), false);
  assert.deepEqual(events, [], "a goodbye, not a drop to reconnect from");
});

test("a failed connect rejects with a NetworkError and releases the link", async () => {
  const { fake, bluetooth } = setup();
  fake.fail.getServices = "Connection timeout";
  await assert.rejects(SmartTrainer.connect(bluetooth), { name: "NetworkError", message: "Connection timeout" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(fake.calls.some((call) => call.method === "disconnect"));
});

test("a strap without the trainer's services is told apart by NotFoundError", async () => {
  const { bluetooth } = setup([strapDevice()]);
  const device = await bluetooth.requestDevice({ filters: [{ services: [0x180d] }] });
  const server = await device.gatt.connect();
  await assert.rejects(server.getPrimaryService(0x1826), { name: "NotFoundError" });
  const service = await server.getPrimaryService(0x180d);
  await assert.rejects(service.getCharacteristic(0x2a38), { name: "NotFoundError" });
});

test("a heart rate strap reports beats per minute", async () => {
  const { fake, bluetooth } = setup([strapDevice()]);
  const monitor = await HeartRateMonitor.connect(bluetooth);
  const readings = [];
  monitor.on("data", (reading) => readings.push(reading));
  fake.notify("strap-1", "0000180d-0000-1000-8000-00805f9b34fb", "00002a37-0000-1000-8000-00805f9b34fb", "008c");
  assert.deepEqual(readings, [{ heartRate: 140 }]);
});

test("picked devices come back from getDevices, so remembered ones connect on their own", async () => {
  const { fake, storage, bluetooth } = setup([trainerDevice(), strapDevice()], { chosen: "strap-1" });
  assert.deepEqual(await bluetooth.getDevices(), []);
  const picked = await bluetooth.requestDevice({ filters: [{ services: [0x180d] }] });

  const [again] = await bluetooth.getDevices();
  assert.equal(again, picked, "the same device object, as in a browser");

  // A new page (app restart) finds it through storage.
  const restarted = new NativeBluetooth({ plugin: fake.plugin, storage });
  const found = await grantedDevices([{ kind: "hr", id: "strap-1", name: "HRM-Pro" }], restarted);
  assert.deepEqual(found.map(({ device }) => device.id), ["strap-1"]);
});

test("in a browser nothing native is installed", () => {
  const nav = {};
  assert.equal(nativePlugins({}), null);
  assert.equal(nativePlugins({ Capacitor: { isNativePlatform: () => false, Plugins: {} } }), null);
  assert.equal(installNativeApp({ plugins: null, navigator: nav }), null);
  assert.equal(isBluetoothAvailable(nav), false);
});

test("inside the app, Bluetooth comes from the native plugin", () => {
  const nav = {};
  const { plugin } = fakeBlePlugin();
  installNativeApp({ plugins: nativePlugins({ Capacitor: { isNativePlatform: () => true, Plugins: { BluetoothLe: plugin } } }), navigator: nav, storage: null });
  assert.ok(nav.bluetooth instanceof NativeBluetooth);
  assert.equal(isBluetoothAvailable(nav), true);
});

test("the native wake lock keeps the screen on until it is released", async () => {
  const calls = [];
  const lock = nativeWakeLock({ keepAwake: async () => calls.push("keepAwake"), allowSleep: async () => calls.push("allowSleep") });
  const sentinel = await lock.request("screen");
  assert.equal(sentinel.released, false);
  await sentinel.release();
  await sentinel.release();
  assert.equal(sentinel.released, true);
  assert.deepEqual(calls, ["keepAwake", "allowSleep"]);
});

test("files are written to the cache and handed to the share sheet", async () => {
  const written = [];
  const shared = [];
  const plugins = {
    Filesystem: { writeFile: async (options) => (written.push(options), { uri: `file:///cache/${options.path}` }) },
    Share: { share: async (options) => shared.push(options) },
  };
  await shareFiles(plugins, [{ blob: new Blob(["hi"]), name: "ride.fit" }], "Morning ride");
  assert.deepEqual(written, [{ path: "ride.fit", data: "aGk=", directory: "CACHE" }]);
  assert.deepEqual(shared, [{ files: ["file:///cache/ride.fit"], title: "Morning ride" }]);
});

test("closing the share sheet is an AbortError, as with navigator.share", async () => {
  const plugins = {
    Filesystem: { writeFile: async ({ path }) => ({ uri: path }) },
    Share: {
      share: async () => {
        throw new Error("Share canceled");
      },
    },
  };
  await assert.rejects(shareFiles(plugins, [{ blob: new Blob(["x"]), name: "a.png" }]), { name: "AbortError" });
});

test("large files are encoded in chunks", async () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i & 0xff);
  assert.equal(await base64Of(new Blob([bytes])), Buffer.from(bytes).toString("base64"));
});
