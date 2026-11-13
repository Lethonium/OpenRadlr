import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientMessages } from "../public/js/net/protocol.js";
import { COCKPIT_KEY, PairingSession, claimCode, isPaired, pairDevice, renewScreenKey, screenKey } from "../public/js/net/screenPairing.js";
import { FakeSocket } from "./helpers.js";

const KEY = "0123456789abcdef0123456789abcdef";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** A counter as "random" bytes: each call continues where the last stopped. */
function countingBytes() {
  let next = 0;
  return (n) => Uint8Array.from({ length: n }, () => next++ % 256);
}

test("the screen key is created once and kept", () => {
  const storage = fakeStorage();
  const first = screenKey(storage, countingBytes());
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal(screenKey(storage, countingBytes()), first);
  assert.equal(storage.getItem("openradlr.screenKey"), first);
});

test("a stored key that is not 32 hex characters is replaced", () => {
  const storage = fakeStorage({ "openradlr.screenKey": "nonsense" });
  assert.match(screenKey(storage, countingBytes()), /^[0-9a-f]{32}$/);
});

test("renewing makes a new key and forgets the pairing", () => {
  const storage = fakeStorage();
  const bytes = countingBytes();
  const first = screenKey(storage, bytes);
  storage.setItem("openradlr.screenPaired", "1");
  const renewed = renewScreenKey(storage, bytes);
  assert.notEqual(renewed, first);
  assert.equal(screenKey(storage, bytes), renewed);
  assert.equal(isPaired(storage), false);
});

test("join carries screen_key only when given", () => {
  assert.equal(ClientMessages.join({ name: "A", weightKg: 70, screenKey: KEY }).screen_key, KEY);
  assert.equal("screen_key" in ClientMessages.join({ name: "A", weightKg: 70 }), false);
});

test("the pairing messages are built as the protocol says", () => {
  assert.deepEqual(ClientMessages.pairOffer({ key: KEY, name: "Anna" }), { type: "pair_offer", key: KEY, name: "Anna" });
  assert.deepEqual(ClientMessages.pairClaim("ABC234"), { type: "pair_claim", code: "ABC234" });
  assert.deepEqual(ClientMessages.pairClaim("ABC234", "Pixel 8"), { type: "pair_claim", code: "ABC234", device: "Pixel 8" });
  assert.deepEqual(ClientMessages.watch(KEY), { type: "watch", key: KEY, view: "data" });
  assert.deepEqual(ClientMessages.watch(KEY, "world", "Quest 3"), { type: "watch", key: KEY, view: "world", device: "Quest 3" });
  assert.deepEqual(ClientMessages.screensQuery(KEY), { type: "screens_query", key: KEY });
  assert.deepEqual(ClientMessages.watch(KEY, "world"), { type: "watch", key: KEY, view: "world" });
  assert.deepEqual(ClientMessages.display({ hr: 120 }), { type: "display", data: { hr: 120 } });
});

function startSession(storage = fakeStorage(), start = undefined) {
  let socket;
  const session = new PairingSession({ url: "ws://x/ws", createSocket: (url) => (socket = new FakeSocket(url)), key: KEY, name: "Anna", storage });
  const events = [];
  for (const type of ["code", "claimed", "watching", "error"]) session.on(type, (payload) => events.push({ type, payload }));
  session.start(start);
  socket.open();
  socket.receive({ type: "welcome" });
  return { session, socket, events, storage };
}

test("a pairing session offers the key once the server has welcomed it", () => {
  const { socket } = startSession();
  assert.deepEqual(
    socket.sent.map((m) => m.type),
    ["hello", "pair_offer"],
  );
  assert.deepEqual(socket.sent[1], { type: "pair_offer", key: KEY, name: "Anna" });
});

test("a pairing session shows the code and marks the tablet paired when claimed", () => {
  const { socket, events, storage } = startSession();
  socket.receive({ type: "pair_code", code: "ABC234", expires_in_s: 300 });
  assert.deepEqual(events, [{ type: "code", payload: { code: "ABC234", expiresInS: 300 } }]);
  assert.equal(isPaired(storage), false);
  socket.receive({ type: "pair_claimed" });
  assert.equal(events.at(-1).type, "claimed");
  assert.equal(isPaired(storage), true);
});

test("claimed carries the device", () => {
  const { socket, events } = startSession();
  socket.receive({ type: "pair_claimed", device: "Pixel 8" });
  assert.deepEqual(events.at(-1), { type: "claimed", payload: { device: "Pixel 8" } });
  socket.receive({ type: "pair_claimed" });
  assert.deepEqual(events.at(-1), { type: "claimed", payload: { device: null } });
});

test("query asks with the key and emits watching", () => {
  const { session, socket, events } = startSession();
  session.query();
  assert.deepEqual(socket.sent.at(-1), { type: "screens_query", key: KEY });
  socket.receive({ type: "screens_watching", devices: ["Quest 3"] });
  assert.deepEqual(events.at(-1), { type: "watching", payload: ["Quest 3"] });
});

test("a query before the welcome waits for it, and a query-only session offers no code", () => {
  let socket;
  const session = new PairingSession({ url: "ws://x/ws", createSocket: (url) => (socket = new FakeSocket(url)), key: KEY, name: "Anna", storage: fakeStorage() });
  session.start({ offer: false });
  session.query();
  socket.open();
  assert.deepEqual(socket.sent.map((m) => m.type), ["hello"]);
  socket.receive({ type: "welcome" });
  assert.deepEqual(socket.sent.map((m) => m.type), ["hello", "screens_query"]);
});

test("a pairing error is passed on with its code", () => {
  const { socket, events } = startSession();
  socket.receive({ type: "error", code: "pair_code_expired", message: "gone" });
  assert.deepEqual(events, [{ type: "error", payload: { code: "pair_code_expired", message: "gone" } }]);
});

test("renewing offers again on the open connection", () => {
  const { session, socket } = startSession();
  session.renew();
  assert.equal(socket.sent.filter((m) => m.type === "pair_offer").length, 2);
});

test("renewing after the server closed the connection connects anew", () => {
  const sockets = [];
  const session = new PairingSession({ url: "ws://x/ws", createSocket: (url) => sockets.push(new FakeSocket(url)) && sockets.at(-1), key: KEY, name: "Anna", storage: fakeStorage() });
  session.start();
  sockets[0].open();
  sockets[0].receive({ type: "welcome" });
  sockets[0].close();
  session.renew();
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].receive({ type: "welcome" });
  assert.equal(sockets[1].sent.at(-1).type, "pair_offer");
});

test("closing the session closes the socket", () => {
  const { session, socket } = startSession();
  session.close();
  assert.equal(socket.readyState, 3);
});

function startClaim(code = "ABC234") {
  let socket;
  const promise = claimCode({ url: "ws://x/ws", createSocket: (url) => (socket = new FakeSocket(url)), code });
  socket.open();
  socket.receive({ type: "welcome" });
  return { promise, socket };
}

test("claiming a code resolves with the paired screen", async () => {
  const { promise, socket } = startClaim();
  assert.deepEqual(socket.sent.at(-1), { type: "pair_claim", code: "ABC234" });
  socket.receive({ type: "paired", key: KEY, name: "Anna" });
  assert.deepEqual(await promise, { key: KEY, name: "Anna" });
});

test("claiming sends the device name along", () => {
  let socket;
  claimCode({ url: "ws://x/ws", createSocket: (url) => (socket = new FakeSocket(url)), code: "ABC234", device: "Pixel 8" }).catch(() => {});
  socket.open();
  socket.receive({ type: "welcome" });
  assert.deepEqual(socket.sent.at(-1), { type: "pair_claim", code: "ABC234", device: "Pixel 8" });
});

test("claiming an unknown code rejects with pair_code_invalid", async () => {
  const { promise, socket } = startClaim("ZZZZZZ");
  socket.receive({ type: "error", code: "pair_code_invalid", message: "no" });
  await assert.rejects(promise, (error) => error.code === "pair_code_invalid");
});

test("claiming rejects when the connection closes first", async () => {
  const { promise, socket } = startClaim();
  socket.close();
  await assert.rejects(promise, (error) => error.code === undefined);
});

test("pairing a device remembers the tablet it was paired with", async () => {
  const stored = {};
  const storage = { setItem: (k, v) => (stored[k] = v) };
  const paired = await pairDevice({ code: "ABC234", storage, claim: async (code, device) => ({ key: KEY, name: `for ${code} ${device}` }), device: "Pixel 8" });
  assert.deepEqual(paired, { key: KEY, name: "for ABC234 Pixel 8" });
  assert.deepEqual(JSON.parse(stored[COCKPIT_KEY]), { key: KEY, name: "for ABC234 Pixel 8" });
});

test("a refused code stores nothing", async () => {
  const stored = {};
  const storage = { setItem: (k, v) => (stored[k] = v) };
  await assert.rejects(pairDevice({ code: "ABC234", storage, claim: async () => { throw new Error("no"); } }));
  assert.deepEqual(stored, {});
});
