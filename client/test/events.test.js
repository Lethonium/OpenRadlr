import { test } from "node:test";
import assert from "node:assert/strict";
import { eventBanner, eventResultRows, eventRideName, eventRows, formatCountdown, groupGapLine, sharingLine } from "../public/js/view/events.js";

test("formats countdowns", () => {
  assert.equal(formatCountdown(760), "12:40");
  assert.equal(formatCountdown(3725), "1:02:05");
  assert.equal(formatCountdown(-5), "0:00");
});

const info = {
  now_s: 1000,
  routes: [{ id: "a", name: "Riverside Flats" }, { id: "b", name: "Col" }],
  events: [
    { id: "late", name: "Race", kind: "race", route_id: "b", lobby_opens_at_s: 5000, starts_at_s: 5600, phase: "upcoming", entrants: 0 },
    { id: "soon", name: "Ride", kind: "group_ride", route_id: "a", lobby_opens_at_s: 1000, starts_at_s: 1760, phase: "lobby", entrants: 3 },
    { id: "now", name: "Ride", kind: "group_ride", route_id: "a", lobby_opens_at_s: 0, starts_at_s: 900, phase: "running", entrants: 1 },
    { id: "run", name: "Race", kind: "race", route_id: "b", lobby_opens_at_s: 0, starts_at_s: 900, phase: "running", entrants: 1 },
  ],
};
const fmt = { locale: "de-CH", timeZone: "UTC" };

test("lists events sorted by start with local labels", () => {
  const rows = eventRows(info, 1000 * 1000, fmt);
  assert.deepEqual(rows.map((r) => r.id), ["now", "run", "soon", "late"]);
  const soon = rows.find((r) => r.id === "soon");
  assert.equal(soon.icon, "👥");
  assert.equal(soon.routeName, "Riverside Flats");
  assert.equal(soon.countdown, "in 12:40");
  assert.equal(soon.startLabel, "00:29");
  assert.equal(soon.entrants, 3);
  assert.equal(soon.joinable, true);
  assert.equal(soon.note, "");
  const late = rows.find((r) => r.id === "late");
  assert.equal(late.icon, "🏁");
  assert.equal(late.joinable, false);
  assert.equal(late.note, "Lobby opens 01:23");
  assert.equal(rows[0].joinable, true);
  assert.equal(rows[1].joinable, false);
  assert.equal(rows[0].countdown, "running");
  assert.equal(rows[1].countdown, "running");
});

test("the event I'm in shows as entered, not joinable", () => {
  const rows = eventRows(info, 1000 * 1000, fmt, "soon");
  const soon = rows.find((r) => r.id === "soon");
  assert.equal(soon.entered, true);
  assert.equal(soon.joinable, false);
  const now = rows.find((r) => r.id === "now");
  assert.equal(now.entered, false);
  assert.equal(now.joinable, true);
  assert.ok(eventRows(info, 1000 * 1000, fmt).every((r) => !r.entered));
});

test("event times follow the server clock", () => {
  const rows = eventRows({ ...info, now_s: 0, events: [{ ...info.events[0], starts_at_s: 0, lobby_opens_at_s: -600 }] }, 500_000, fmt);
  assert.equal(rows[0].startLabel, "00:08");
  assert.equal(eventRows({ ...info, now_s: 0, events: [{ ...info.events[0], starts_at_s: 0 }] }, 0, fmt)[0].startLabel, "00:00");
  assert.equal(rows[0].countdown, "in 0:00");
});

test("banner shows the lobby", () => {
  const base = { kind: "group_ride", phase: "lobby", starts_in_s: 552, entered: false };
  assert.equal(eventBanner(base), "Group ride starts in 9:12 · J to join");
  assert.equal(eventBanner({ ...base, kind: "race" }), "Race starts in 9:12 · J to join");
  assert.equal(eventBanner({ ...base, entered: true }), "Group ride starts in 9:12 · you're in");
  assert.equal(eventBanner({ ...base, phase: "running" }), null);
  assert.equal(eventBanner(undefined), null);
});

test("sharing line", () => {
  assert.equal(sharingLine({ given_w: 50, to: ["Anna", "Ben"], received_w: 0, from: [] }), "−50 W → Anna, Ben");
  assert.equal(sharingLine({ given_w: 0, to: [], received_w: 30, from: ["Chris"] }), "+30 W from Chris");
  assert.equal(sharingLine({ given_w: 4, to: ["Anna"], received_w: 4, from: ["Chris"] }), "");
  assert.equal(sharingLine(undefined), "");
});

test("ride names", () => {
  assert.equal(eventRideName("group_ride", "Riverside Flats"), "OpenRadlr group ride · Riverside Flats");
  assert.equal(eventRideName("race", "Riverside Flats"), "OpenRadlr race · Riverside Flats");
});

test("result rows", () => {
  const race = [
    { rider_id: 1, name: "Anna", is_bot: false, place: 1, time_s: 1421, distance_m: 1, avg_wkg: 3.44 },
    { rider_id: 2, name: "Ben", is_bot: false, distance_m: 1, avg_wkg: 2 },
    { rider_id: 3, name: "Fox", is_bot: true, place: 2, time_s: 1500, distance_m: 1, avg_wkg: 3 },
  ];
  assert.deepEqual(eventResultRows(race, "race", 1), ["#1 You · 23:41 · 3.4 W/kg", "DNF Ben", "#2 Fox (bot) · 25:00 · 3.0 W/kg"]);
  const ride = [
    { rider_id: 1, name: "Anna", is_bot: false, distance_m: 18000, avg_wkg: 2.9, given_kj: 12.2 },
    { rider_id: 2, name: "Ben", is_bot: true, distance_m: 17500, avg_wkg: 2.5, given_kj: 0 },
  ];
  assert.deepEqual(eventResultRows(ride, "group_ride", 9), ["Anna · 18.0 km · 2.9 W/kg · gave 12 kJ", "Ben (bot) · 17.5 km · 2.5 W/kg"]);
  assert.equal(eventResultRows(ride, "group_ride", 1)[0], "You · 18.0 km · 2.9 W/kg · gave 12 kJ");
});

test("group gap line", () => {
  assert.equal(groupGapLine(12), "+0:12 ahead of the group");
  assert.equal(groupGapLine(-20), "0:20 behind the group");
  assert.equal(groupGapLine(-4.9), "with the group");
  assert.equal(groupGapLine(5), "+0:05 ahead of the group");
  assert.equal(groupGapLine(NaN), "");
});
