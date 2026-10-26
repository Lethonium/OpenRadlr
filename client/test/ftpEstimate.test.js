import { test } from "node:test";
import assert from "node:assert/strict";
import { CP_TO_FTP, TWENTY_MIN_TO_FTP, ESTIMATE_WINDOW_DAYS, MIN_RISE_W, MIN_RISE_FRACTION, estimateFtp, suggestFtp } from "../public/js/ride/ftpEstimate.js";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DAY = 86400000;

/** A ride record from `daysAgo` days before NOW with the given curve. */
function record(daysAgo, curve) {
  return { version: 2, startedAt: NOW - daysAgo * DAY, measured: true, curve };
}
/** Mean power of a rider with the given critical power and W' over t seconds. */
const cpPower = (cp, wPrime, t) => cp + wPrime / t;

test("the constants are exported", () => {
  assert.equal(CP_TO_FTP, 0.97);
  assert.equal(TWENTY_MIN_TO_FTP, 0.95);
  assert.equal(ESTIMATE_WINDOW_DAYS, 90);
  assert.equal(MIN_RISE_W, 5);
  assert.equal(MIN_RISE_FRACTION, 0.03);
});

test("perfect critical power data gives CP, W' and an FTP of 97% of CP", () => {
  const curve = {};
  for (const t of [180, 300, 720, 1200]) curve[t] = cpPower(250, 20000, t);
  const result = estimateFtp([record(5, curve)], NOW);
  assert.equal(result.basis, "cp");
  assert.ok(Math.abs(result.cp - 250) <= 1);
  assert.ok(Math.abs(result.wPrime - 20000) <= 500);
  assert.equal(result.ftp, Math.round(250 * CP_TO_FTP));
});

test("only a 20 minute effort gives 95% of it", () => {
  const result = estimateFtp([record(5, { 1200: 260 })], NOW);
  assert.equal(result.ftp, 247);
  assert.equal(result.basis, "twenty");
});

test("two efforts less than twice apart without a 20 minute effort give nothing", () => {
  assert.equal(estimateFtp([record(5, { 300: 320, 480: 300 })], NOW), null);
});

test("rides without measured power are ignored", () => {
  assert.equal(estimateFtp([{ ...record(5, { 1200: 260 }), measured: false }], NOW), null);
});

test("records outside the 90 day window are ignored", () => {
  assert.equal(estimateFtp([record(100, { 1200: 260 })], NOW), null);
  assert.equal(estimateFtp([record(89, { 1200: 260 })], NOW).ftp, 247);
});

test("the best value per duration is taken across rides", () => {
  const result = estimateFtp([record(3, { 1200: 260, 300: null }), record(10, { 300: 330, 1200: 240 })], NOW);
  assert.equal(result.basis, "cp");
  const cp = (260 * 1200 - 330 * 300) / 900;
  assert.ok(Math.abs(result.cp - cp) < 1e-6);
});

test("a fit with a negative W' falls back to the 20 minute rule", () => {
  const result = estimateFtp([record(5, { 300: 200, 1200: 260 })], NOW);
  assert.equal(result.basis, "twenty");
  assert.equal(result.ftp, 247);
});

test("a negative W' without a 20 minute effort gives nothing", () => {
  assert.equal(estimateFtp([record(5, { 300: 200, 720: 260 })], NOW), null);
});

test("records without a curve are skipped", () => {
  const old = { version: 1, startedAt: NOW - DAY };
  assert.equal(estimateFtp([old], NOW), null);
  assert.equal(estimateFtp([old, record(1, { 1200: 260 })], NOW).ftp, 247);
});

test("a suggestion needs a rise of the margin over the current FTP", () => {
  const rides = [record(2, { 1200: 258.4 })]; // ftp 245
  assert.deepEqual(suggestFtp(rides, { ftp: 200 }, NOW), { ftp: 245, delta: 45, basis: "twenty" });
  assert.equal(suggestFtp(rides, { ftp: 240 }, NOW), null);
  assert.equal(suggestFtp(rides, { ftp: 300 }, NOW), null);
});

test("a dismissed estimate is not suggested again until it rises", () => {
  assert.equal(suggestFtp([record(2, { 1200: 258.4 })], { ftp: 200, dismissed: 245 }, NOW), null);
  assert.equal(suggestFtp([record(2, { 1200: 265.3 })], { ftp: 200, dismissed: 245 }, NOW).ftp, 252);
});

test("estimates outside 50-600 W are dropped", () => {
  assert.equal(suggestFtp([record(2, { 1200: 700 })], { ftp: 200 }, NOW), null);
  assert.equal(suggestFtp([record(2, { 1200: 40 })], { ftp: 30 }, NOW), null);
});

test("a ride older than `since` is ignored, so a lowered FTP is not offered back up", () => {
  const records = [record(10, { 1200: 300 })];
  assert.equal(estimateFtp(records, NOW, { since: NOW - 5 * DAY }), null);
  assert.equal(suggestFtp(records, { ftp: 200, since: NOW - 5 * DAY }, NOW), null);
  assert.equal(suggestFtp(records, { ftp: 200, since: NOW - 20 * DAY }, NOW).ftp, 285);
});
