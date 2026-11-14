import { test } from "node:test";
import assert from "node:assert/strict";
import { CockpitConnection } from "../../public/js/cockpit/cockpitConnection.js";
import { FakeSocket } from "../helpers.js";

const KEY = "0123456789abcdef0123456789abcdef"; // pragma: allowlist secret (a test placeholder)

function setup() {
  const sockets = [];
  const timers = [];
  const connection = new CockpitConnection({
    url: "ws://host/ws",
    key: KEY,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  return { connection, sockets, timers };
}

test("watching starts with hello and watch", () => {
  const { connection, sockets } = setup();
  connection.start();
  sockets[0].open();
  assert.deepEqual(sockets[0].sent.map((m) => m.type), ["hello"]);
  sockets[0].receive({ type: "welcome" });
  assert.deepEqual(sockets[0].sent.at(-1), { type: "watch", key: KEY, view: "data" });
});

test("status, state and display are emitted", () => {
  const { connection, sockets } = setup();
  const seen = [];
  connection.on("status", (s) => seen.push(["status", s]));
  connection.on("state", (m) => seen.push(["state", m.type]));
  connection.on("display", (d) => seen.push(["display", d]));
  connection.start();
  sockets[0].open();
  sockets[0].receive({ type: "welcome" });
  sockets[0].receive({ type: "watch_status", live: true, name: "Anna" });
  sockets[0].receive({ type: "state", riders: [] });
  sockets[0].receive({ type: "studio_state", riders: [] });
  sockets[0].receive({ type: "display", data: { hr: 140 } });
  assert.deepEqual(seen, [
    ["status", { live: true, name: "Anna" }],
    ["state", "state"],
    ["state", "studio_state"],
    ["display", { hr: 140 }],
  ]);
});

test("a dropped connection retries with growing delays up to 10 s", () => {
  const { connection, sockets, timers } = setup();
  connection.start();
  for (let i = 0; i < 6; i++) {
    sockets.at(-1).dispatch("close");
    timers.at(-1).fn();
  }
  assert.deepEqual(timers.map((t) => t.ms), [1000, 2000, 4000, 8000, 10000, 10000]);
  assert.equal(sockets.length, 7);
});

test("a welcome resets the retry delay", () => {
  const { connection, sockets, timers } = setup();
  connection.start();
  sockets[0].dispatch("close");
  timers[0].fn();
  sockets[1].open();
  sockets[1].receive({ type: "welcome" });
  sockets[1].dispatch("close");
  assert.equal(timers.at(-1).ms, 1000);
});

test("a bad key stops retrying", () => {
  const { connection, sockets, timers } = setup();
  let invalid = 0;
  connection.on("invalid", () => invalid++);
  connection.start();
  sockets[0].open();
  sockets[0].receive({ type: "error", code: "bad_screen_key" });
  sockets[0].dispatch("close");
  assert.equal(invalid, 1);
  assert.equal(timers.length, 0);
});

test("stop ends the connection and its retries", () => {
  const { connection, sockets, timers } = setup();
  connection.start();
  connection.stop();
  sockets[0].dispatch("close");
  assert.equal(timers.length, 0);
});
