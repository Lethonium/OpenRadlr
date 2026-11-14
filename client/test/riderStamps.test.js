import { test } from "node:test";
import assert from "node:assert/strict";
import { RiderStamps } from "../public/js/ride/riderStamps.js";

/** A clock the test sets: `clock.at = 12` moves time on. */
const clock = (at) => ({ at, now() { return this.at; } });
const parked = (id) => ({ id, parked: true });
const rolling = (id) => ({ id, parked: false });

test("stamp marks parkedSince at the first parked sighting and keeps it", () => {
  const time = clock(10);
  const stamps = new RiderStamps({ now: () => time.now() });
  assert.equal(stamps.stamp(parked("ann")).parkedSince, 10);
  time.at = 12;
  assert.equal(stamps.stamp(parked("ann")).parkedSince, 10);
});

test("stamp gives parkedSince null to a rolling rider", () => {
  const stamps = new RiderStamps({ now: () => 10 });
  assert.equal(stamps.stamp(rolling("ann")).parkedSince, null);
});

test("exerciseSince restarts when the exercise changes", () => {
  const time = clock(10);
  const stamps = new RiderStamps({ now: () => time.now() });
  assert.equal(stamps.stamp({ id: "ann", exercise: "plank" }).exerciseSince, 10);
  time.at = 11;
  assert.equal(stamps.stamp({ id: "ann", exercise: "plank" }).exerciseSince, 10);
  time.at = 12;
  assert.equal(stamps.stamp({ id: "ann", exercise: "squat" }).exerciseSince, 12);
});

test("keep forgets riders that left", () => {
  const time = clock(20);
  const stamps = new RiderStamps({ now: () => time.now() });
  stamps.stamp(parked("ann"));
  stamps.keep([]);
  time.at = 30;
  assert.equal(stamps.stamp(parked("ann")).parkedSince, 30);
});

test("keep forgets the parked stamp of a rider who is no longer parked", () => {
  const time = clock(20);
  const stamps = new RiderStamps({ now: () => time.now() });
  stamps.stamp(parked("ann"));
  stamps.keep([rolling("ann")]);
  time.at = 30;
  assert.equal(stamps.stamp(parked("ann")).parkedSince, 30);
});
