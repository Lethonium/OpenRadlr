import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientMessages, PROTOCOL_VERSION, defaultServerUrl, parseServerMessage } from "../public/js/net/protocol.js";
import { GameConnection } from "../public/js/net/connection.js";
import { FakeSocket } from "./helpers.js";

test("builds protocol messages", () => {
  assert.equal(ClientMessages.hello().protocol_version, PROTOCOL_VERSION);
  assert.deepEqual(ClientMessages.join({ name: "Anna", weightKg: 70 }), { type: "join", name: "Anna", weight_kg: 70 });
  assert.equal(ClientMessages.join({ name: "Anna", weightKg: 70, routeId: "col" }).route_id, "col");
  assert.equal(ClientMessages.join({ name: "Anna", weightKg: 70, routeId: "spin-studio", ftp: 240 }).ftp_w, 240);
  assert.equal(ClientMessages.join({ name: "A", weightKg: 70, level: 245 }).level_w, 245);
  assert.equal("level_w" in ClientMessages.join({ name: "A", weightKg: 70, level: undefined }), false);
  assert.equal("ftp_w" in ClientMessages.join({ name: "Anna", weightKg: 70, ftp: Number.NaN }), false);
  assert.equal(ClientMessages.join({ name: "Anna", weightKg: 70, device: "paddle" }).device, "paddle");
  assert.equal("device" in ClientMessages.join({ name: "Anna", weightKg: 70, device: "trainer" }), false);
  assert.equal(ClientMessages.join({ name: "A", weightKg: 70, vehicleCode: "ABC234" }).vehicle_code, "ABC234");
  assert.equal("vehicle_code" in ClientMessages.join({ name: "A", weightKg: 70 }), false);
  assert.deepEqual(ClientMessages.createVehicle({ kind: "beer_bike", seats: 7, bots: true }), {
    type: "create_vehicle",
    kind: "beer_bike",
    seats: 7,
    bots: true,
  });
  assert.deepEqual(ClientMessages.boardVehicle("ABC234"), { type: "board_vehicle", code: "ABC234" });
  assert.deepEqual(ClientMessages.leaveVehicle(), { type: "leave_vehicle" });
  assert.deepEqual(ClientMessages.pause(), { type: "pause" });
  assert.deepEqual(ClientMessages.resume(), { type: "resume" });
  assert.deepEqual(ClientMessages.joinRace(), { type: "join_race" });
  assert.deepEqual(ClientMessages.joinEvent("e1"), { type: "join_event", event_id: "e1" });
  assert.deepEqual(ClientMessages.leaveEvent(), { type: "leave_event" });
  assert.deepEqual(ClientMessages.leaveRace(), { type: "leave_race" });
  assert.deepEqual(ClientMessages.telemetry({ power: 200, cadence: null }), { type: "telemetry", power: 200 });
  assert.deepEqual(ClientMessages.telemetry({ power: NaN, cadence: 90 }), { type: "telemetry", power: 0, cadence: 90 });
  assert.deepEqual(ClientMessages.laneLeft(), { type: "input", action: "lane_left" });
});

test("workout messages carry the exercise or null", () => {
  assert.deepEqual(ClientMessages.workout("plank"), { type: "workout", exercise: "plank" });
  assert.deepEqual(ClientMessages.workout(), { type: "workout", exercise: null });
});

test("a workout join sends the workout device", () => {
  assert.equal(ClientMessages.join({ name: "A", weightKg: 70, device: "workout" }).device, "workout");
});

test("parses only known server messages", () => {
  assert.equal(parseServerMessage('{"type":"state","riders":[]}').type, "state");
  assert.equal(parseServerMessage('{"type":"studio_state","riders":[]}').type, "studio_state");
  assert.equal(parseServerMessage('{"type":"bogus"}'), null);
  assert.equal(parseServerMessage("not json"), null);
  assert.equal(parseServerMessage("null"), null);
});

test("derives the websocket url from the page location", () => {
  assert.equal(defaultServerUrl({ protocol: "http:", host: "localhost:8080" }), "ws://localhost:8080/ws");
  assert.equal(defaultServerUrl({ protocol: "https:", host: "ride.example.org" }), "wss://ride.example.org/ws");
});

function connectionWithSocket() {
  let socket;
  const connection = new GameConnection({
    url: "ws://test/ws",
    createSocket: (url) => (socket = new FakeSocket(url)),
  });
  return { connection, socket: () => socket };
}

test("performs the hello and join handshake", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "Anna", weightKg: 70 });
  socket().open();
  assert.equal(socket().sent[0].type, "hello");
  socket().receive({ type: "welcome", server_name: "Test", route_id: "loop" });
  assert.equal(socket().sent[1].type, "join");
  socket().receive({ type: "joined", rider_id: 7 });
  assert.equal(await joined, 7);
  assert.equal(connection.serverInfo.server_name, "Test");
});

test("rejects when the server refuses the join", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "", weightKg: 70 });
  socket().open();
  socket().receive({ type: "welcome" });
  socket().receive({ type: "error", code: "invalid_name", message: "bad name" });
  await assert.rejects(joined, /invalid_name/);
});

test("rejects when the connection closes early", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "Anna", weightKg: 70 });
  socket().close();
  await assert.rejects(joined, /closed/);
});

test("forwards game messages and sends commands after joining", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "Anna", weightKg: 70 });
  socket().open();
  socket().receive({ type: "welcome" });
  socket().receive({ type: "joined", rider_id: 1 });
  await joined;

  const states = [];
  connection.on("state", (s) => states.push(s));
  socket().receive({ type: "state", tick: 1, riders: [] });
  assert.equal(states.length, 1);

  connection.sendTelemetry({ power: 210, cadence: 88 });
  connection.laneRight();
  connection.startRace(2);
  connection.chat("   ");
  connection.chat("hi");
  assert.deepEqual(
    socket().sent.slice(2).map((m) => m.type),
    ["telemetry", "input", "start_race", "chat"],
  );
});

test("join sends resume fields and keeps the token", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "Anna", weightKg: 70, resumeToken: "t", resume: { routeId: "r", distanceM: 12 } });
  socket().open();
  socket().receive({ type: "welcome", grace_s: 60 });
  assert.equal(connection.graceS, 60);
  const join = socket().sent[1];
  assert.equal(join.resume_token, "t");
  assert.deepEqual(join.resume, { route_id: "r", distance_m: 12 });
  socket().receive({ type: "joined", rider_id: 4, resume_token: "u" });
  assert.equal(await joined, 4);
  assert.equal(connection.resumeToken, "u");
});

test("join leaves the resume fields out when there are none", async () => {
  const { connection, socket } = connectionWithSocket();
  connection.join({ name: "Anna", weightKg: 70 });
  socket().open();
  socket().receive({ type: "welcome" });
  assert.equal(connection.graceS, 0);
  assert.equal("resume_token" in socket().sent[1], false);
  assert.equal("resume" in socket().sent[1], false);
});

test("leave sends leave then closes", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "Anna", weightKg: 70 });
  socket().open();
  socket().receive({ type: "welcome" });
  socket().receive({ type: "joined", rider_id: 1 });
  await joined;
  connection.leave();
  assert.equal(socket().sent.at(-1).type, "leave");
  assert.equal(socket().readyState, 3);
});

test("workout sends the current exercise after joining", async () => {
  const { connection, socket } = connectionWithSocket();
  const joined = connection.join({ name: "Anna", weightKg: 70, device: "workout" });
  socket().open();
  socket().receive({ type: "welcome" });
  socket().receive({ type: "joined", rider_id: 1 });
  await joined;

  connection.workout("squats");
  connection.workout(null);
  assert.deepEqual(socket().sent.slice(2), [
    { type: "workout", exercise: "squats" },
    { type: "workout", exercise: null },
  ]);
});
