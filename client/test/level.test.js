import { test } from "node:test";
import assert from "node:assert/strict";
import { best20MinPower, levelAfterRace, levelAfterRide, levelLabel, levelOf } from "../public/js/profile/level.js";

const ride = (...parts) => {
  const samples = [];
  for (const [seconds, power] of parts) for (let i = 0; i < seconds; i++) samples.push({ t: samples.length * 1000, power });
  return samples;
};

test("best 20 minute power", () => {
  assert.equal(best20MinPower(ride([1200, 200])), 200);
  assert.equal(best20MinPower(ride([1100, 200])), null);
  assert.equal(best20MinPower([]), null);
  assert.equal(best20MinPower(ride([1200, 250], [300, 100])), 250);
  assert.equal(best20MinPower(ride([300, 100], [1200, 250])), 250);
});

test("a ride raises the level by at most 5 % and never lowers it", () => {
  assert.equal(levelAfterRide(200, ride([1200, 300])), 210);
  assert.equal(levelAfterRide(200, ride([1200, 205])), 200);
  assert.equal(levelAfterRide(200, ride([1200, 215])), 204.25);
  assert.equal(levelAfterRide(200, ride([900, 400])), 200);
});

test("a race moves the level by at most 5 % either way", () => {
  assert.equal(levelAfterRace(200, 150), 190);
  assert.equal(levelAfterRace(200, 203), 203);
  assert.equal(levelAfterRace(200, 400), 210);
});

test("a race without a usable average leaves the level alone", () => {
  assert.equal(levelAfterRace(200, NaN), 200);
  assert.equal(levelAfterRace(200, 0), 200);
  assert.equal(levelAfterRace(200, -5), 200);
  assert.equal(levelAfterRace(200, Infinity), 200);
});

test("level falls back to FTP and is labelled in W/kg", () => {
  assert.equal(levelOf({ ftp: 250, levelW: null }), 250);
  assert.equal(levelOf({ ftp: 250, levelW: 230 }), 230);
  assert.equal(levelLabel(217, 70), "Riding level 3.1 W/kg (from your rides)");
});
