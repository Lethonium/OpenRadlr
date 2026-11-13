import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILE_PAGES, RIDES_PAGE_SIZE, curveRows, dataRows, overviewLines, rideRows, routeName } from "../public/js/view/profilePage.js";

const profile = { name: "Ralf", weightKg: 74, ftp: 245, ftpSource: "tested", ftpDate: null, levelW: 252, units: "metric" };
const zero = { rides: 0, distanceM: 0, durationS: 0, elevationGainM: 0 };
const noRides = { week: zero, month: zero, all: zero };

test("the profile has three pages", () => {
  assert.deepEqual(PROFILE_PAGES, ["overview", "rides", "data"]);
});

test("routeName: server name, Studio for null, id when unknown", () => {
  const routes = [{ id: "rolling-hills", name: "Rolling Hills" }];
  assert.equal(routeName("rolling-hills", routes), "Rolling Hills");
  assert.equal(routeName(null, routes), "Studio");
  assert.equal(routeName("gone", routes), "gone");
});

test("overviewLines: rider with level, FTP with where it came from", () => {
  const lines = overviewLines({ profile, totals: noRides, bests: [], routes: [] });
  assert.equal(lines.rider, "Ralf · Riding level 3.4 W/kg (from your rides)");
  assert.equal(lines.ftp, "FTP 245 W · Measured by the ramp test.");
});

test("overviewLines: totals per period in the rider's units", () => {
  const totals = { week: { rides: 2, distanceM: 62000, durationS: 7800, elevationGainM: 400 }, month: { ...zero, rides: 5, distanceM: 210000 }, all: { ...zero, rides: 40, distanceM: 1240000, elevationGainM: 14200 } };
  const lines = overviewLines({ profile, totals, bests: [], routes: [] });
  assert.deepEqual(lines.totals.map((row) => row.label), ["This week", "This month", "All rides"]);
  assert.equal(lines.totals[0].value, "2 rides · 62.0 km · 2:10:00 · 400 m");
  assert.equal(lines.totals[2].value, "40 rides · 1,240 km · 0:00 · 14200 m");
  assert.equal(lines.empty, null);
});

test("overviewLines: a new rider gets the empty text, no NaN", () => {
  const lines = overviewLines({ profile: { ...profile, name: "", levelW: null }, totals: noRides, bests: [], routes: [] });
  assert.equal(lines.empty, "No rides yet. Your totals, FTP and best laps show up here after your first ride.");
  assert.equal(lines.rider, "No name yet");
  assert.ok(!JSON.stringify(lines).includes("NaN"));
});

test("overviewLines: best laps by route name with lap time", () => {
  const lines = overviewLines({ profile, totals: noRides, bests: [{ routeId: "rolling-hills", durationS: 1318 }], routes: [{ id: "rolling-hills", name: "Rolling Hills" }] });
  assert.deepEqual(lines.bests, ["Rolling Hills · 21:58"]);
});

const rec = (extra = {}) => ({ id: "1", startedAt: Date.UTC(2026, 10, 10, 18), routeId: "rolling-hills", distanceM: 21400, durationS: 2700, avgPower: 198.4, elevationGainM: 210, device: "trainer", curve: { 5: 610, 15: 500, 60: 380, 300: 290, 1200: 241, 1800: 230, 3600: null }, ...extra });

test("rides come 20 at a time", () => {
  assert.equal(RIDES_PAGE_SIZE, 20);
});

test("rideRows: one row per ride with units and route name", () => {
  const [row] = rideRows([rec()], [{ id: "rolling-hills", name: "Rolling Hills" }], { locale: "en" });
  assert.equal(row.id, "1");
  assert.equal(row.route, "Rolling Hills");
  assert.equal(row.distance, "21.4 km");
  assert.equal(row.time, "45:00");
  assert.equal(row.power, "198 W");
  assert.equal(row.climbing, "210 m");
  assert.match(row.date, /10/);
  assert.equal(row.device, null);
});

test("rideRows: paddle and simulator rides are marked", () => {
  assert.equal(rideRows([rec({ device: "paddle" })], [], {})[0].device, "paddle");
  assert.equal(rideRows([rec({ device: "sim" })], [], {})[0].device, "sim");
});

test("rideRows: an old record without power, route or device still renders", () => {
  const [old] = rideRows([{ id: "2", startedAt: 1, distanceM: 1000, durationS: 60 }], [], {});
  assert.equal(old.power, "–");
  assert.equal(old.route, "Studio");
  assert.equal(old.climbing, "0 m");
  assert.equal(old.device, null);
});

test("rideRows: empty history gives no rows", () => {
  assert.deepEqual(rideRows([], [], {}), []);
});

test("curveRows: key durations and the longest one", () => {
  assert.deepEqual(curveRows(rec().curve), [
    { label: "5 s", watts: "610 W" },
    { label: "1 min", watts: "380 W" },
    { label: "5 min", watts: "290 W" },
    { label: "20 min", watts: "241 W" },
    { label: "30 min", watts: "230 W" },
  ]);
});

test("curveRows: a short ride lists only what it has", () => {
  assert.deepEqual(curveRows({ 5: 400, 15: 380, 60: null }).map((row) => row.label), ["5 s", "15 s"]);
});

test("curveRows: no curve gives no rows", () => {
  assert.deepEqual(curveRows(undefined), []);
});

const items = [
  { id: "profile", count: 1, readable: true },
  { id: "rides", count: 42, readable: true },
  { id: "bestLaps", count: 0, readable: true },
  { id: "progress", count: { summits: 7, lemons: 12 }, readable: true },
  { id: "unfinished", count: 0, readable: true },
  { id: "settings", count: null, readable: false },
];

test("dataRows: one row per item with its count in words", () => {
  const rows = dataRows(items);
  assert.deepEqual(rows.map((row) => row.id), ["profile", "rides", "bestLaps", "progress", "unfinished", "settings"]);
  const by = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(by.rides.name, "Rides");
  assert.equal(by.rides.count, "42 rides");
  assert.equal(by.progress.count, "7 summits · 12 golden lemons");
  assert.equal(by.unfinished.count, "None");
  assert.ok(by.rides.detail.length > 0);
});

test("dataRows: only what is there and readable can be deleted", () => {
  const by = Object.fromEntries(dataRows(items).map((row) => [row.id, row]));
  assert.equal(by.rides.canDelete, true);
  assert.equal(by.bestLaps.canDelete, false);
  assert.equal(by.settings.canDelete, false);
  assert.equal(by.settings.count, "Can't be read in this browser");
});

test("dataRows: the profile is reset, the others deleted", () => {
  const by = Object.fromEntries(dataRows(items).map((row) => [row.id, row]));
  assert.equal(by.profile.action, "Reset");
  assert.equal(by.rides.action, "Delete");
  assert.equal(by.rides.actionLabel, "Delete Rides");
});
