import { test } from "node:test";
import assert from "node:assert/strict";
import { actionForKey, bindKeyboard } from "../public/js/input/keyboard.js";
import { DEFAULT_PROFILE, ProfileStore, validateProfile } from "../public/js/profile/profileStore.js";
import { formatDuration, formatGap, formatGrade, formatSpeed, formatWkg } from "../public/js/util/format.js";
import { describeEvent, inRace, nearbyRiders, onlineSummary, raceStatus, riderSections } from "../public/js/view/panels.js";
import { ridersInWindow } from "../public/js/view/pelotonView.js";
import { profileScale } from "../public/js/view/profileView.js";
import { minimapTransform } from "../public/js/view/minimapView.js";
import { squareRoute } from "./helpers.js";

test("formats numbers for the HUD", () => {
  assert.equal(formatSpeed(10), "36.0");
  assert.equal(formatGrade(-4.25), "−4.3");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatGap(12.4), "+12 m");
  assert.equal(formatGap(-3), "−3 m");
  assert.equal(formatGap(0.2), "0 m");
  assert.equal(formatWkg(210, 70), "3.0");
});

test("maps keys to actions but not while typing", () => {
  assert.equal(actionForKey({ code: "ArrowLeft", target: { tagName: "BODY" } }), "laneLeft");
  assert.equal(actionForKey({ code: "KeyD", target: {} }), "laneRight");
  assert.equal(actionForKey({ code: "KeyD", target: { tagName: "INPUT" } }), null);
  assert.equal(actionForKey({ code: "KeyD", ctrlKey: true, target: {} }), null);
  assert.equal(actionForKey({ code: "KeyX", target: {} }), null);
  assert.equal(actionForKey({ code: "KeyP", target: {} }), "takePhoto");
  assert.equal(actionForKey({ code: "Space", target: { tagName: "DIV" } }), "togglePause");
  // Space presses a focused button instead.
  assert.equal(actionForKey({ code: "Space", target: { tagName: "BUTTON" } }), null);
});

test("holding Space pauses once, not on every key repeat", () => {
  let listener;
  let pauses = 0;
  const target = { addEventListener: (_, fn) => (listener = fn), removeEventListener() {} };
  bindKeyboard(target, { togglePause: () => (pauses += 1) });
  const press = (repeat) => listener({ code: "Space", repeat, target: { tagName: "DIV" }, preventDefault() {} });
  press(false);
  press(true);
  press(true);
  assert.equal(pauses, 1);
});

test("counts riders online on the server and on this route", () => {
  const riders = [{ is_bot: false }, { is_bot: true }, { is_bot: true }, { is_bot: false }];
  assert.deepEqual(onlineSummary(5, riders), { count: 5, text: "5 riders online · 2 on this route · 2 bots" });
  assert.deepEqual(onlineSummary(2, riders), { count: 2, text: "2 riders online · 2 bots" });
  // Unknown or stale server count: never fewer than the humans we can see.
  assert.deepEqual(onlineSummary(null, riders.slice(0, 2)), { count: 1, text: "1 rider online · 1 bot" });
  assert.deepEqual(onlineSummary(0, riders.slice(0, 1)), { count: 1, text: "1 rider online" });
  // The server's count of the whole route beats the riders in view (#14).
  assert.deepEqual(onlineSummary(9, riders, { humans: 6, bots: 11 }), { count: 9, text: "9 riders online · 6 on this route · 11 bots" });
});

test("validates profiles", () => {
  assert.deepEqual(validateProfile({ name: "Anna", weightKg: 70, difficulty: 0.5 }), []);
  assert.equal(validateProfile({ name: " ", weightKg: 10, difficulty: 2 }).length, 3);
});

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}

test("stores and loads profiles, tolerating broken storage", () => {
  const store = new ProfileStore({ storage: memoryStorage(), subtle: null, locale: "de-CH" });
  assert.deepEqual(store.load(), DEFAULT_PROFILE);
  store.save({ ...DEFAULT_PROFILE, name: "Anna" });
  assert.equal(store.load().name, "Anna");

  const broken = new ProfileStore({ locale: "de-CH", storage: { getItem: () => "{oops", setItem: () => { throw new Error("full"); } } });
  assert.deepEqual(broken.load(), DEFAULT_PROFILE);
  broken.save({ name: "x" });
});

test("changing FTP resets the level estimate", () => {
  const store = new ProfileStore({ storage: memoryStorage(), subtle: null });
  store.save({ ...DEFAULT_PROFILE, ftp: 200, levelW: 230 });
  assert.equal(store.load().levelW, 230);
  store.save({ ...store.load(), name: "Anna" });
  assert.equal(store.load().levelW, 230);
  assert.equal(store.save({ ...store.load(), ftp: 250 }).levelW, null);
  assert.equal(store.load().levelW, null);
});

test("generates a key pair once", async () => {
  const store = new ProfileStore({ storage: memoryStorage(), subtle: globalThis.crypto.subtle });
  const withKeys = await store.ensureKeys({ ...DEFAULT_PROFILE, name: "Anna" });
  assert.match(withKeys.publicKey, /^[A-Za-z0-9+/=]{80,}$/);
  assert.equal((await store.ensureKeys(withKeys)).publicKey, withKeys.publicKey);
  assert.equal(store.load().publicKey, withKeys.publicKey);
});

test("lists nearby riders from ahead to behind", () => {
  const route = squareRoute();
  const me = { id: 1, distance: 500 };
  const riders = [me, { id: 2, distance: 520 }, { id: 3, distance: 490 }, { id: 4, distance: 100 }];
  const ids = nearbyRiders(me, riders, route, 3).map((e) => e.rider.id);
  assert.deepEqual(ids, [2, 1, 3]);
});

test("short lists show humans first and let the nearest bots fill the rest", () => {
  const route = squareRoute();
  const me = { id: 1, distance: 500 };
  const riders = [
    me,
    { id: 2, distance: 501, is_bot: true },
    { id: 3, distance: 499, is_bot: true },
    { id: 4, distance: 560, is_bot: false },
    { id: 5, distance: 430, is_bot: false },
  ];
  assert.deepEqual(nearbyRiders(me, riders, route, 4).map((e) => e.rider.id), [4, 1, 5, 2]);
  assert.deepEqual(nearbyRiders(me, riders, route, 2).map((e) => e.rider.id), [4, 1], "no bot while humans fill the rows");
});

test("the riders drawer lists every human, then others by route, with bots apart", () => {
  const route = squareRoute();
  const me = { id: 1, distance: 500, is_bot: false };
  const bots = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, distance: 500 + i, is_bot: true }));
  const far = { id: 2, distance: 100, is_bot: false };
  const away = { id: 3, route: "east", is_bot: false };
  const { humans, bots: shown } = riderSections(me, [me, far, ...bots], route, [{ rider: away, routeName: "East loop" }]);
  assert.deepEqual(humans.map((e) => e.rider.id), [1, 2, 3], "far humans are never cut by bots");
  assert.equal(humans[2].gap, null);
  assert.equal(humans[2].routeName, "East loop");
  assert.equal(shown.length, 9);
  assert.ok(shown.every((e) => e.rider.is_bot));
});

test("describes race status and events", () => {
  assert.equal(raceStatus({ phase: "idle" }), "Free ride");
  assert.equal(raceStatus({ phase: "countdown", laps: 1, remaining_s: 4.2 }), "Race starts in 5 s · 1 lap");
  assert.equal(raceStatus({ phase: "running", laps: 3, elapsed_s: 61 }, 2), "Lap 2/3 · 1:01");
  assert.match(raceStatus({ phase: "running", laps: 3, elapsed_s: 61 }, null), /free riding/);
  assert.equal(describeEvent({ kind: "rider_joined", rider_id: 9, name: "Bot", is_bot: true }, 1), null);
  assert.equal(describeEvent({ kind: "rider_joined", rider_id: 1, name: "Anna", is_bot: false }, 1), "You joined");
  assert.equal(
    describeEvent({ kind: "rider_finished", rider_id: 4, name: "Swift Fox", is_bot: true, position: 2, time_s: 300 }, 1),
    "#2 Swift Fox (bot) · 5:00",
  );
  assert.equal(describeEvent({ kind: "event_lobby", event_id: "e", name: "Group ride", event_kind: "group_ride", starts_in_s: 600 }, 1), "Group ride starts in 10:00 · J to join");
  assert.equal(describeEvent({ kind: "event_started", event_id: "e", event_kind: "group_ride" }, 1), "Event started — go!");
  assert.equal(describeEvent({ kind: "event_started", event_id: "e", event_kind: "race" }, 1), null);
  const result = (name, given_kj) => ({ rider_id: 1, name, is_bot: false, distance_m: 1, avg_wkg: 2, given_kj, received_kj: 0 });
  assert.equal(describeEvent({ kind: "event_finished", event_id: "e", event_kind: "race", results: [result("Anna", 30)] }, 1), null);
  assert.equal(describeEvent({ kind: "event_finished", event_id: "e", event_kind: "group_ride", results: [result("Ben", 3), result("Anna", 12.4)] }, 1), "Event finished · thanks Anna for sharing 12 kJ");
  assert.equal(describeEvent({ kind: "event_finished", event_id: "e", event_kind: "group_ride", results: [result("Ben", 0.5)] }, 1), "Event finished");
});

test("peloton window keeps riders around me only", () => {
  const route = squareRoute();
  const me = { id: 1, distance: 5 };
  const visible = ridersInWindow(me, [me, { id: 2, distance: 990 }, { id: 3, distance: 60 }, { id: 4, distance: 500 }], route);
  assert.deepEqual(visible.map((v) => v.rider.id), [1, 2]);
  assert.equal(visible[1].gap, -15);
});

test("profile and minimap scales map into the canvas", () => {
  const route = squareRoute();
  const scale = profileScale(route, 1016, 200);
  assert.equal(scale.x(0), 8);
  assert.equal(scale.x(500), 508);
  assert.equal(scale.y(route.maxElevation), 16);
  assert.equal(scale.y(route.minElevation), 178);

  const project = minimapTransform(route.bounds, 300, 300, 25);
  assert.deepEqual(project({ x: 0, y: 0 }), { x: 25, y: 275 });
  assert.deepEqual(project({ x: 250, y: 250 }), { x: 275, y: 25 });
});

test("peloton labels only collide within the same lane", async () => {
  const { overlaps } = await import("../public/js/view/pelotonView.js");
  assert.equal(overlaps({ left: 0, right: 50, row: 1 }, { left: 40, right: 90, row: 1 }), true);
  assert.equal(overlaps({ left: 0, right: 50, row: 1 }, { left: 40, right: 90, row: 2 }), false);
  assert.equal(overlaps({ left: 0, right: 50, row: 1 }, { left: 70, right: 90, row: 1 }), false);
});

test("shifting and view keys map to actions", () => {
  assert.equal(actionForKey({ code: "KeyE", target: {} }), "shiftUp");
  assert.equal(actionForKey({ code: "Minus", target: {} }), "shiftDown");
  assert.equal(actionForKey({ code: "KeyV", target: {} }), "toggleView");
});

test("validates gear settings only when virtual shifting is on", () => {
  const ok = { name: "Anna", weightKg: 70, difficulty: 0.5 };
  assert.deepEqual(validateProfile({ ...ok, virtualShifting: false, chainring: 5 }), []);
  assert.equal(validateProfile({ ...ok, virtualShifting: true, chainring: 5, cog: 50 }).length, 2);
  assert.deepEqual(validateProfile({ ...ok, virtualShifting: true, chainring: 34, cog: 14 }), []);
});

test("in the race: entered during the countdown, or riding with a lap", () => {
  assert.equal(inRace({ phase: "countdown", entrants: [3, 7] }, { lap: null }, 7), true);
  assert.equal(inRace({ phase: "countdown", entrants: [3] }, { lap: null }, 7), false);
  assert.equal(inRace({ phase: "running" }, { lap: 1 }, 7), true);
  assert.equal(inRace({ phase: "running" }, { lap: null }, 7), false);
  assert.equal(inRace({ phase: "idle" }, { lap: null }, 7), false);
});

test("announces boarding, leaving and captains of my vehicle only", () => {
  const ev = (kind, vehicle_id, rider_id, name) => ({ kind, vehicle_id, rider_id, name });
  assert.equal(describeEvent(ev("vehicle_boarded", 7, 2, "Ben"), 1, 7), "Ben boarded");
  assert.equal(describeEvent(ev("vehicle_left", 7, 2, "Ben"), 1, 7), "Ben left");
  assert.equal(describeEvent(ev("captain_changed", 7, 2, "Ben"), 1, 7), "Ben is now the captain");
  assert.equal(describeEvent(ev("captain_changed", 7, 1, "Anna"), 1, 7), "You are now the captain");
  assert.equal(describeEvent(ev("vehicle_boarded", 8, 2, "Ben"), 1, 7), null);
  assert.equal(describeEvent(ev("vehicle_left", 8, 2, "Ben"), 1, 7), null);
  assert.equal(describeEvent(ev("captain_changed", 8, 2, "Ben"), 1, 7), null);
  assert.equal(describeEvent(ev("vehicle_boarded", 7, 2, "Ben"), 1, null), null);
  assert.equal(describeEvent(ev("vehicle_boarded", 7, 2, "Ben"), 1), null);
});

test("profile distance labels thin out on long routes", async () => {
  const { tickEvery } = await import("../public/js/view/profileView.js");
  assert.equal(tickEvery(8, 80), 1);
  assert.equal(tickEvery(180, 4), 20);
  assert.ok(tickEvery(180, 0) >= 1);
});

test("splitMode is validated and defaults to auto", () => {
  assert.equal(DEFAULT_PROFILE.splitMode, "auto");
  const base = { name: "Anna", weightKg: 70, difficulty: 0.5 };
  assert.deepEqual(validateProfile(base), []);
  for (const splitMode of ["auto", "lap", "1", "5", "10", "off"]) assert.deepEqual(validateProfile({ ...base, splitMode }), []);
  assert.deepEqual(validateProfile({ ...base, splitMode: "7" }), ["Splits must be auto, lap, 1, 5, 10 or off."]);
});
