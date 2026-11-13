import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILE_PAGES, overviewLines, routeName } from "../public/js/view/profilePage.js";

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
