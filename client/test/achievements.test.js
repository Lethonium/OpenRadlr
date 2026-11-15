import { test } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, achievementFacts, earnedNow } from "../public/js/profile/achievements.js";

// Tuesday 10 Nov 2026, 18:00 local: hits none of the time-based ones.
const at = (y, m, d, h = 18, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const BASE = at(2026, 11, 10);
const DAY = 86_400_000;

const ride = (overrides = {}) => ({
  startedAt: BASE,
  durationS: 3600,
  distanceM: 30_000,
  elevationGainM: 200,
  kilojoules: 700,
  maxPower: 400,
  measured: true,
  device: "trainer",
  ftp: 200,
  routeId: "rolling-hills",
  test: null,
  ...overrides,
});
const workout = (planId, startedAt = BASE) => ({ kind: "workout", planId, startedAt, durationS: 1200 });

const earns = (id, records, extra = {}) => earnedNow({ records, summits: [], lemons: 0, routes: null, ...extra }).includes(id);
const yes = (id, records, extra) => assert.equal(earns(id, records, extra), true);
const no = (id, records, extra) => assert.equal(earns(id, records, extra), false);
const many = (n, overrides) => Array.from({ length: n }, (_, i) => ride({ startedAt: BASE + i * DAY, ...overrides }));
const weekly = (offsets) => offsets.map((w) => ride({ startedAt: BASE + w * 7 * DAY }));

test("the list has the spec's ids in order", () => {
  assert.deepEqual(
    ACHIEVEMENTS.map((a) => a.id),
    ["firstRide", "marathon", "century", "climb1000", "climb4000", "everest", "km1000", "croissants", "weeks4", "weeks12", "tourist", "local", "bothWays", "lavaFeet", "lemons10", "summits10", "knowThyself", "stronger", "watts1000", "nightOwl", "earlyBird", "lunchBreak", "cookieBurner", "newYear", "thumbWarrior", "bendy", "crossTrainer"],
  );
});

test("the funny time and device ones are secret", () => {
  assert.deepEqual(
    ACHIEVEMENTS.filter((a) => a.secret).map((a) => a.id),
    ["nightOwl", "earlyBird", "lunchBreak", "cookieBurner", "newYear", "thumbWarrior", "bendy", "crossTrainer"],
  );
});

test("firstRide: one ride earns it", () => yes("firstRide", [ride()]));
test("firstRide: no records don't", () => no("firstRide", []));
test("firstRide: workouts alone don't", () => no("firstRide", [workout("tabata")]));

test("marathon: 42,195 m earns it", () => yes("marathon", [ride({ distanceM: 42_195 })]));
test("marathon: 42,194 m doesn't", () => no("marathon", [ride({ distanceM: 42_194 })]));
test("century: 100 km earns it", () => yes("century", [ride({ distanceM: 100_000 })]));
test("century: 99,999 m doesn't", () => no("century", [ride({ distanceM: 99_999 })]));

test("climb1000: 1,000 m summed earns it", () => yes("climb1000", many(5, { elevationGainM: 200 })));
test("climb1000: 999 m doesn't", () => no("climb1000", [ride({ elevationGainM: 999 })]));
test("climb4000: 4,000 m summed earns it", () => yes("climb4000", many(2, { elevationGainM: 2000 })));
test("climb4000: 3,999 m doesn't", () => no("climb4000", [ride({ elevationGainM: 3999 })]));
test("everest: 8,849 m summed earns it", () => yes("everest", [ride({ elevationGainM: 8000 }), ride({ elevationGainM: 849 })]));
test("everest: 8,848 m doesn't", () => no("everest", [ride({ elevationGainM: 8848 })]));

test("km1000: 1,000 km summed earns it", () => yes("km1000", many(10, { distanceM: 100_000 })));
test("km1000: 999,999 m doesn't", () => no("km1000", [ride({ distanceM: 999_999 })]));
test("croissants: 25,000 kJ summed earns it", () => yes("croissants", many(25, { kilojoules: 1000 })));
test("croissants: 24,999 kJ doesn't", () => no("croissants", [ride({ kilojoules: 24_999 })]));

test("weeks4: rides in 4 consecutive weeks earn it", () => yes("weeks4", weekly([0, 1, 2, 3])));
test("weeks4: 3 weeks, a gap, then 1 don't", () => no("weeks4", weekly([0, 1, 2, 4])));
test("weeks12: rides in 12 consecutive weeks earn it", () => yes("weeks12", weekly([...Array(12).keys()])));
test("weeks12: 11 weeks, a gap, then 1 don't", () => no("weeks12", weekly([...Array(11).keys(), 12])));

test("tourist: 3 different routes earn it", () => yes("tourist", ["a", "b", "c"].map((routeId) => ride({ routeId }))));
test("tourist: 2 routes and the studio don't", () => no("tourist", ["a", "b", null].map((routeId) => ride({ routeId }))));

const routes = [{ id: "a" }, { id: "b" }];
test("local: every server route ridden earns it", () => yes("local", [ride({ routeId: "a" }), ride({ routeId: "b" })], { routes }));
test("local: one missing doesn't", () => no("local", [ride({ routeId: "a" }), ride({ routeId: null })], { routes }));
test("local: without the route list it can't be earned", () => no("local", [ride({ routeId: "a" })], { routes: null }));

test("bothWays: both Herne Hills earn it", () => yes("bothWays", [ride({ routeId: "herne-hill" }), ride({ routeId: "herne-hill-clockwise" })]));
test("bothWays: one direction doesn't", () => no("bothWays", [ride({ routeId: "herne-hill" })]));

test("lavaFeet: one 180 km Lanzarote ride earns it", () => yes("lavaFeet", [ride({ routeId: "lanzarote-lava-180", distanceM: 180_000 })]));
test("lavaFeet: two 90 km rides don't", () => no("lavaFeet", many(2, { routeId: "lanzarote-lava-180", distanceM: 90_000 })));

test("lemons10: 10 lemons earn it", () => yes("lemons10", [], { lemons: 10 }));
test("lemons10: 9 don't", () => no("lemons10", [], { lemons: 9 }));
test("summits10: 10 different summits earn it", () => yes("summits10", [], { summits: [...Array(10).keys()].map((i) => `r:${i}`) }));
test("summits10: 9 different ones twice don't", () => no("summits10", [], { summits: [...Array(9).keys(), 0].map((i) => `r:${i}`) }));

test("knowThyself: an FTP test earns it", () => yes("knowThyself", [ride({ test: { kind: "ramp" } })]));
test("knowThyself: no test doesn't", () => no("knowThyself", [ride()]));

test("stronger: a later FTP 10% over the first earns it", () => yes("stronger", [ride({ ftp: 200 }), ride({ startedAt: BASE + DAY, ftp: 220 })]));
test("stronger: 9.5% over doesn't", () => no("stronger", [ride({ ftp: 200 }), ride({ startedAt: BASE + DAY, ftp: 219 })]));
test("stronger: measured from the oldest ride with a known FTP", () => no("stronger", [ride({ ftp: undefined, startedAt: BASE - DAY }), ride({ ftp: 220 }), ride({ startedAt: BASE + DAY, ftp: 230 })]));

test("watts1000: a measured 1,000 W earns it", () => yes("watts1000", [ride({ maxPower: 1000 })]));
test("watts1000: an unmeasured 1,200 W doesn't", () => no("watts1000", [ride({ maxPower: 1200, measured: false })]));

test("nightOwl: a 22:00 start earns it", () => yes("nightOwl", [ride({ startedAt: at(2026, 11, 10, 22) })]));
test("nightOwl: a 03:59 start earns it", () => yes("nightOwl", [ride({ startedAt: at(2026, 11, 10, 3, 59) })]));
test("nightOwl: a 21:59 start doesn't", () => no("nightOwl", [ride({ startedAt: at(2026, 11, 10, 21, 59) })]));
test("earlyBird: a 04:00 start earns it", () => yes("earlyBird", [ride({ startedAt: at(2026, 11, 10, 4) })]));
test("earlyBird: a 06:00 start doesn't", () => no("earlyBird", [ride({ startedAt: at(2026, 11, 10, 6) })]));

const lunch = (startedAt, durationS = 1800) => [ride({ startedAt, durationS })];
test("lunchBreak: a weekday 12:30 half hour earns it", () => yes("lunchBreak", lunch(at(2026, 11, 10, 12, 30))));
test("lunchBreak: on a Saturday it doesn't", () => no("lunchBreak", lunch(at(2026, 11, 14, 12, 30))));
test("lunchBreak: a full hour doesn't", () => no("lunchBreak", lunch(at(2026, 11, 10, 12, 30), 3600)));
test("lunchBreak: under 15 minutes doesn't", () => no("lunchBreak", lunch(at(2026, 11, 10, 12, 30), 899)));
test("lunchBreak: a 13:00 start doesn't", () => no("lunchBreak", lunch(at(2026, 11, 10, 13))));

test("cookieBurner: 26 December earns it", () => yes("cookieBurner", [ride({ startedAt: at(2026, 12, 26) })]));
test("cookieBurner: 23 December doesn't", () => no("cookieBurner", [ride({ startedAt: at(2026, 12, 23) })]));
test("newYear: 1 January earns it", () => yes("newYear", [ride({ startedAt: at(2027, 1, 1) })]));
test("newYear: 2 January doesn't", () => no("newYear", [ride({ startedAt: at(2027, 1, 2) })]));

test("thumbWarrior: a paddle ride earns it", () => yes("thumbWarrior", [ride({ device: "paddle", measured: false })]));
test("thumbWarrior: a trainer ride doesn't", () => no("thumbWarrior", [ride()]));

test("bendy: a yoga preset earns it", () => yes("bendy", [workout("sun-salutation")]));
test("bendy: a HIIT preset doesn't", () => no("bendy", [workout("tabata")]));

test("crossTrainer: a ride and a workout in the same week earn it", () => yes("crossTrainer", [ride(), workout("tabata", BASE + 2 * DAY)]));
test("crossTrainer: in different weeks they don't", () => no("crossTrainer", [ride(), workout("tabata", BASE + 7 * DAY)]));

test("records without the newer fields earn nothing they can't prove", () => {
  assert.deepEqual(earnedNow({ records: [{ startedAt: BASE, distanceM: 10_000 }], summits: [], lemons: 0, routes: null }), ["firstRide"]);
});

test("facts sort the records oldest first", () => {
  const facts = achievementFacts({ records: [ride({ startedAt: BASE + DAY }), ride()], summits: [], lemons: 0, routes: null });
  assert.equal(facts.rides[0].startedAt, BASE);
});
