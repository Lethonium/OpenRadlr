import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ftpSeries, hasFtpChart, periodTotals, weekStart } from "../public/js/profile/stats.js";

// Local dates; run with TZ=Europe/Zurich so the DST case is meaningful.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const ride = (t, extra = {}) => ({ startedAt: t, distanceM: 20000, durationS: 3600, elevationGainM: 150, ftp: 250, measured: true, ...extra });

test("weekStart: Monday 00:00 local, Sunday night still belongs to the week", () => {
  assert.equal(weekStart(at(2026, 11, 15, 23, 30)), at(2026, 11, 9, 0));
  assert.equal(weekStart(at(2026, 11, 16, 0, 10)), at(2026, 11, 16, 0));
});

test("weekStart: the week of the DST change still starts on Monday 00:00", () => {
  // Clocks go forward on Sunday 28 March 2027 in Europe; a child process gets that time zone whatever this one runs in.
  const code = `
    import { weekStart } from ${JSON.stringify(new URL("../public/js/profile/stats.js", import.meta.url).href)};
    const at = (y, m, d, h) => new Date(y, m - 1, d, h).getTime();
    console.log(JSON.stringify([weekStart(at(2027, 3, 28, 12)) === at(2027, 3, 22, 0), weekStart(at(2027, 3, 31, 12)) === at(2027, 3, 29, 0)]));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TZ: "Europe/Zurich" } });
  assert.deepEqual(JSON.parse(String(out)), [true, true]);
});

test("periodTotals: week, month and all", () => {
  const now = at(2026, 11, 13);
  const r = periodTotals([ride(at(2026, 11, 10)), ride(at(2026, 11, 2)), ride(at(2026, 10, 30))], now);
  assert.deepEqual(r.week, { rides: 1, distanceM: 20000, durationS: 3600, elevationGainM: 150 });
  assert.equal(r.month.rides, 2);
  assert.equal(r.all.distanceM, 60000);
});

test("periodTotals: no rides gives zeros", () => {
  assert.deepEqual(periodTotals([], at(2026, 11, 13)).all, { rides: 0, distanceM: 0, durationS: 0, elevationGainM: 0 });
});

test("periodTotals: missing fields count as 0", () => {
  assert.equal(periodTotals([{ startedAt: at(2026, 11, 12) }], at(2026, 11, 13)).week.distanceM, 0);
});

test("ftpSeries: set FTP per ride oldest first, tests marked, null FTP skipped", () => {
  const s = ftpSeries([ride(at(2026, 11, 10), { ftp: 260, test: "ramp" }), ride(at(2026, 11, 2), { ftp: null }), ride(at(2026, 10, 20))], at(2026, 11, 13));
  assert.deepEqual(s.set.map((p) => [p.ftp, p.test]), [[250, false], [260, true]]);
});

test("ftpSeries: one estimate per week with rides, null without a measured effort", () => {
  const s = ftpSeries([ride(at(2026, 11, 10), { measured: false }), ride(at(2026, 11, 3), { measured: false })], at(2026, 11, 13));
  assert.equal(s.estimated.length, 2);
  assert.deepEqual(s.estimated.map((p) => p.ftp), [null, null]);
  assert.ok(s.estimated[0].t < s.estimated[1].t);
  assert.ok(s.estimated[1].t <= at(2026, 11, 13));
});

test("ftpSeries: an estimate from measured efforts", () => {
  const curve = { 180: 330, 300: 300, 480: 285, 720: 275, 1200: 263 };
  const s = ftpSeries([ride(at(2026, 11, 10), { curve })], at(2026, 11, 13));
  assert.ok(Number.isFinite(s.estimated[0].ftp));
});

test("hasFtpChart: needs two different weeks", () => {
  assert.equal(hasFtpChart({ set: [{ t: at(2026, 11, 10), ftp: 250 }, { t: at(2026, 11, 11), ftp: 250 }], estimated: [] }), false);
  assert.equal(hasFtpChart({ set: [{ t: at(2026, 11, 3), ftp: 250 }, { t: at(2026, 11, 11), ftp: 255 }], estimated: [] }), true);
});

test("hasFtpChart: weeks without an estimate don't count", () => {
  assert.equal(hasFtpChart({ set: [], estimated: [{ t: at(2026, 11, 8), ftp: null }, { t: at(2026, 11, 15), ftp: 250 }] }), false);
});

test("ftpSeries: a week's estimate ignores later rides", () => {
  const weak = { 180: 300, 300: 270, 480: 255, 720: 245, 1200: 235 };
  const strong = { 180: 360, 300: 330, 480: 315, 720: 305, 1200: 295 };
  const s = ftpSeries([ride(at(2026, 11, 10), { curve: strong }), ride(at(2026, 11, 3), { curve: weak })], at(2026, 11, 13));
  assert.ok(s.estimated[0].ftp < s.estimated[1].ftp);
});

test("periodTotals: workouts don't count as rides", () => {
  const workout = { kind: "workout", startedAt: at(2026, 11, 12), durationS: 1500, planName: "Yoga" };
  const r = periodTotals([ride(at(2026, 11, 10)), workout], at(2026, 11, 13));
  assert.equal(r.week.rides, 1);
  assert.equal(r.week.durationS, 3600);
});
