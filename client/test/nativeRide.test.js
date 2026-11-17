import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeRide, mergeNativeRecovery, nativeControl } from "../public/js/native/backgroundRide.js";

function fakePlugin() {
  let emit;
  const calls = [];
  const snapshots = [];
  return {
    calls, snapshots, emit: (event) => emit(event),
    addListener: async (name, listener) => { assert.equal(name, "event"); emit = listener; return { remove() {} }; },
    openSocket: async (value) => calls.push(["open", value]),
    sendSocket: async (value) => calls.push(["send", value]),
    closeSocket: async (value) => calls.push(["close", value]),
    observeEvent: async (value) => calls.push(["observe", value]),
    bleOperation: async (value) => { calls.push(["ble", value]); return {}; },
    startRide: async (value) => { calls.push(["start", value]); return { active: true }; },
    snapshot: async () => snapshots.shift() ?? { samples: [], active: true, ended: false },
    stopRide: async () => ({ samples: [], active: false }),
    updateRide: async (value) => calls.push(["update", value]),
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("the native socket registers its listener before opening", async () => {
  const plugin = fakePlugin();
  const ride = new NativeRide({ plugin, makeId: () => "s1" });
  const socket = ride.createSocket("wss://example.com/ws");
  let opened = false;
  socket.addEventListener("open", () => { opened = true; });
  await flush();
  plugin.emit({ type: "open", id: "s1" });
  assert.equal(opened, true);
  assert.equal(socket.readyState, 1);
  socket.send("hello");
  await flush();
  assert.deepEqual(plugin.calls.at(-1), ["send", { id: "s1", data: "hello" }]);
});

test("a socket that closes before native setup never opens afterward", async () => {
  const plugin = fakePlugin();
  const ride = new NativeRide({ plugin, makeId: () => "s1" });
  const socket = ride.createSocket("wss://example.com/ws");
  socket.close();
  await flush();
  assert.equal(plugin.calls.some(([kind]) => kind === "open"), false);
  assert.equal(socket.readyState, 3);
});

test("native recording imports each sample once without waiting for animation frames", async () => {
  const plugin = fakePlugin();
  const kept = [];
  const ride = new NativeRide({ plugin, schedule: () => 1, cancel() {} });
  await ride.start({ snapshot: { recorder: { samples: [] } }, trainerId: "trainer" }, { onSamples: (samples) => kept.push(...samples) });
  plugin.snapshots.push({ samples: [{ t: 1000, power: 200 }], active: true });
  await ride.flush();
  plugin.snapshots.push({ samples: [{ t: 1000, power: 200 }, { t: 2000, power: 210 }], active: true });
  await ride.flush();
  assert.deepEqual(kept.map((s) => s.t), [1000, 2000]);
});

test("finishing imports pending samples before releasing native recording", async () => {
  const plugin = fakePlugin();
  const kept = [];
  plugin.snapshots.push({ samples: [{ t: 1000 }], active: true });
  const ride = new NativeRide({ plugin, schedule: () => 1, cancel() {} });
  await ride.start({ snapshot: { recorder: { samples: [] } }, trainerId: "trainer" }, { onSamples: (samples) => kept.push(...samples) });
  await ride.stop(true);
  assert.deepEqual(kept.map((s) => s.t), [1000]);
  assert.equal(ride.active, false);
});

test("Bluetooth notifications use the native tap instead of queued WebView callbacks", async () => {
  const plugin = fakePlugin();
  const ride = new NativeRide({ plugin });
  const bluetooth = ride.bluetooth({ initialize: () => "initialized" });
  const values = [];
  await bluetooth.addListener("notification|trainer|s|c", (data) => values.push(data.value));
  plugin.emit({ type: "ble", event: "notification|trainer|s|c", value: { value: "aabb" } });
  assert.deepEqual(values, ["aabb"]);
  assert.equal(bluetooth.initialize(), "initialized");
});

test("recovery merges journal samples without discarding enriched browser positions", () => {
  const stored = { nativeRideId: "ride-1", recorder: { samples: [{ t: 1000, power: 200, lat: 1, lon: 2 }], pauses: [] } };
  const native = { nativeRideId: "ride-1", savedAt: 2000, distance: 20, recorder: { samples: [{ t: 1000, power: 200 }, { t: 2000, power: 210 }] } };
  const merged = mergeNativeRecovery(stored, native);
  assert.equal(merged.recorder.samples.length, 2);
  assert.equal(merged.recorder.samples[0].lat, 1);
  assert.equal(merged.savedAt, 2000);
});

test("a journal from another ride never replaces an existing unfinished ride", () => {
  const saved = { nativeRideId: "a", recorder: { samples: [] } };
  assert.equal(mergeNativeRecovery(saved, { nativeRideId: "b", recorder: { samples: [] } }), saved);
});

test("background control includes the active workout and selected virtual gear", () => {
  const data = nativeControl({ profile: { ftp: 200, difficulty: .5, weightKg: 75, chainring: 40, cog: 20 },
    training: { mode: "erg", intensity: 1.1, targetWatts: () => 220, player: { elapsedS: 42, workout: { segments: [{ durationS: 60, from: .5, to: 1 }] } } },
    gearbox: { ratio: 2 }, routes: new Map([["r", { length: 1000, loop: true }]]) });
  assert.equal(data.elapsed, 42);
  assert.equal(data.referenceRatio, 2);
  assert.equal(data.segments[0].durationS, 60);
  assert.deepEqual(data.routeLengths, { r: 1000 });
  assert.deepEqual(data.routeLoops, { r: true });
});

test("concurrent end requests stop the native recorder only once", async () => {
  const plugin = fakePlugin();
  let stops = 0;
  plugin.stopRide = async () => { stops++; return { samples: [], active: false }; };
  const ride = new NativeRide({ plugin, schedule: () => 1, cancel() {} });
  await ride.start({ snapshot: {}, trainerId: "trainer" });
  await Promise.all([ride.stop(true), ride.stop(true)]);
  assert.equal(stops, 1);
});

test("native resume gates frames before reconciling the background workout clock", async () => {
  const plugin = fakePlugin();
  const order = [];
  plugin.snapshots.push({ samples: [], active: true, elapsed: 42 });
  const ride = new NativeRide({ plugin, schedule: () => 1, cancel() {} });
  await ride.start({ snapshot: {}, trainerId: "trainer" }, { onResume: () => order.push("gate"), onState: (state) => order.push(state.elapsed) });
  plugin.emit({ type: "rideState", resumed: true, ended: false });
  await flush();
  assert.deepEqual(order, ["gate", 42]);
});

test("the native class catalog can follow the next scheduled studio class while hidden", () => {
  const segments = [{ duration_s: 60, from: .5, to: 1 }];
  const data = nativeControl({ profile: { ftp: 200, difficulty: 1, weightKg: 75, chainring: 40, cog: 20 },
    studio: { classes: new Map([["next-class", { segments }]]), plan: { segments }, intensity: 1, erg: true, targetWatts: () => 150, elapsed: () => 30 } });
  assert.deepEqual(data.classes["next-class"], [{ durationS: 60, from: .5, to: 1 }]);
});

test("starting a native ride calls browser timers with their Window receiver", async (t) => {
  t.mock.method(globalThis, "setInterval", function () {
    assert.equal(this, globalThis, "WebView timers require the global receiver");
    return 7;
  });
  const ride = new NativeRide({ plugin: fakePlugin(), cancel() {} });
  await ride.start({ snapshot: {} });
  await ride.stop();
});

test("finishing a native ride calls browser timer cancellation with its Window receiver", async (t) => {
  t.mock.method(globalThis, "clearInterval", function (timer) {
    assert.equal(this, globalThis, "WebView timers require the global receiver");
    assert.equal(timer, 7);
  });
  const ride = new NativeRide({ plugin: fakePlugin(), schedule: () => 7 });
  await ride.start({ snapshot: {} });
  await ride.stop(true);
  assert.equal(ride.active, false);
});

test("a different rider cannot recover the shared journal into an empty autosave", () => {
  const journal = { profileId: "alice", nativeRideId: "ride-a", recorder: { samples: [{ t: 1, power: 200 }] } };
  assert.equal(mergeNativeRecovery(null, journal, "bob"), null);
});

test("the journal owner can recover a ride without a browser autosave", () => {
  const journal = { profileId: "alice", nativeRideId: "ride-a", recorder: { samples: [] } };
  assert.equal(mergeNativeRecovery(null, journal, "alice"), journal);
});

test("legacy unowned journals belong only to the original main rider", () => {
  const journal = { nativeRideId: "legacy", recorder: { samples: [] } };
  assert.equal(mergeNativeRecovery(null, journal, "bob"), null);
  assert.equal(mergeNativeRecovery(null, journal, "main"), journal);
});

test("matching ride ids cannot merge samples across profile owners", () => {
  const saved = { profileId: "bob", nativeRideId: "ride", recorder: { samples: [{ t: 1 }] } };
  const journal = { profileId: "alice", nativeRideId: "ride", recorder: { samples: [{ t: 2 }] } };
  assert.equal(mergeNativeRecovery(saved, journal, "bob"), saved);
});

test("the native adapter checks the active rider before returning a journal", async () => {
  const plugin = fakePlugin();
  const journal = { profileId: "alice", nativeRideId: "a", recorder: { samples: [] } };
  plugin.recover = async () => ({ snapshot: journal });
  const ride = new NativeRide({ plugin });
  assert.equal(await ride.recover(null, "bob"), null);
  assert.equal(await ride.recover(null, "alice"), journal);
});
