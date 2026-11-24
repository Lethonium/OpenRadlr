import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RIDERS_KEY,
  loadRiders,
  saveRiders,
  addRider,
  removeRider,
  setActive,
  setLock,
  clearLock,
  isLocked,
} from "../public/js/profile/riders.js";

const fakeStorage = (value) => {
  const items = new Map(value === undefined ? [] : [[RIDERS_KEY, value]]);
  return { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, v) => items.set(key, String(v)) };
};

const throwingStorage = {
  getItem() {
    throw new Error("storage denied");
  },
  setItem() {
    throw new Error("storage denied");
  },
};

// Returns the random draws that spell out one rider id (each draw picks one of 36 characters).
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const drawsFor = (id) => [...id].map((c) => (ALPHABET.indexOf(c) + 0.5) / ALPHABET.length);

const sequence = (...values) => {
  let i = 0;
  return () => values[i++];
};

test("loadRiders_with_empty_storage_defaults_to_main", () => {
  assert.deepEqual(loadRiders(fakeStorage()), { active: "main", ids: ["main"] });
});

test("loadRiders_with_garbage_defaults_to_main", () => {
  assert.deepEqual(loadRiders(fakeStorage("{nope")), { active: "main", ids: ["main"] });
});

test("loadRiders_with_throwing_storage_defaults_to_main", () => {
  assert.deepEqual(loadRiders(throwingStorage), { active: "main", ids: ["main"] });
});

test("loadRiders_without_roster_keeps_orphaned_rider_ids", () => {
  assert.deepEqual(loadRiders(fakeStorage(), { orphanIds: ["ab12cd34"] }).ids, ["main", "ab12cd34"]);
});

test("loadRiders_with_unknown_active_rider_falls_back_to_first", () => {
  assert.equal(loadRiders(fakeStorage(JSON.stringify({ active: "zz", ids: ["main", "x"] }))).active, "main");
});

test("addRider_appends_a_new_eight_character_id_and_makes_it_active", () => {
  const roster = { active: "main", ids: ["main"] };
  const { roster: next, id } = addRider(roster, sequence(...drawsFor("k3x9q2ab")));
  assert.deepEqual(next, { active: "k3x9q2ab", ids: ["main", "k3x9q2ab"] });
  assert.equal(id, "k3x9q2ab");
});

test("addRider_redraws_when_the_first_id_collides", () => {
  const roster = { active: "main", ids: ["main", "ab12cd34"] };
  const { id } = addRider(roster, sequence(...drawsFor("ab12cd34"), ...drawsFor("zz99yy88")));
  assert.equal(id, "zz99yy88");
});

test("removeRider_of_the_only_rider_returns_null", () => {
  assert.equal(removeRider({ active: "main", ids: ["main"] }, "main"), null);
});

test("removeRider_of_the_active_middle_rider_activates_the_next_one", () => {
  const roster = { active: "bbbbbbbb", ids: ["main", "bbbbbbbb", "cccccccc"] };
  assert.equal(removeRider(roster, "bbbbbbbb").active, "cccccccc");
});

test("saveRiders_then_loadRiders_round_trips", () => {
  const storage = fakeStorage();
  const roster = { active: "k3x9q2ab", ids: ["main", "k3x9q2ab"] };
  assert.equal(saveRiders(storage, roster), true);
  assert.deepEqual(loadRiders(storage), roster);
});

const record = { salt: "c2FsdA==", hash: "aGFzaA==", iterations: 10 };

test("setLock_keeps_the_record_for_that_rider_only", () => {
  const roster = { active: "main", ids: ["main", "bbbbbbbb"] };
  const locked = setLock(roster, "bbbbbbbb", record);
  assert.equal(isLocked(locked, "bbbbbbbb"), true);
  assert.equal(isLocked(locked, "main"), false);
});

test("setLock_for_an_unknown_rider_changes_nothing", () => {
  const roster = { active: "main", ids: ["main"] };
  assert.deepEqual(setLock(roster, "zzzzzzzz", record), roster);
});

test("clearLock_removes_the_record_and_leaves_no_empty_locks_behind", () => {
  const locked = setLock({ active: "main", ids: ["main"] }, "main", record);
  assert.deepEqual(clearLock(locked, "main"), { active: "main", ids: ["main"] });
});

test("saveRiders_then_loadRiders_keeps_the_locks", () => {
  const storage = fakeStorage();
  const roster = setLock({ active: "main", ids: ["main", "bbbbbbbb"] }, "bbbbbbbb", record);
  saveRiders(storage, roster);
  assert.deepEqual(loadRiders(storage), roster);
});

test("loadRiders_drops_damaged_locks_and_locks_of_unknown_riders", () => {
  const stored = { active: "main", ids: ["main"], locks: { main: { salt: 1 }, ghost: record } };
  assert.deepEqual(loadRiders(fakeStorage(JSON.stringify(stored))), { active: "main", ids: ["main"] });
});

test("removeRider_takes_that_riders_lock_with_it", () => {
  const roster = setLock({ active: "main", ids: ["main", "bbbbbbbb"] }, "bbbbbbbb", record);
  assert.equal(isLocked(removeRider(roster, "bbbbbbbb"), "bbbbbbbb"), false);
});

test("addRider_and_setActive_keep_existing_locks", () => {
  const roster = setLock({ active: "main", ids: ["main"] }, "main", record);
  assert.equal(isLocked(addRider(roster, sequence(...drawsFor("k3x9q2ab"))).roster, "main"), true);
  assert.equal(isLocked(setActive({ ...roster, ids: ["main", "bbbbbbbb"] }, "bbbbbbbb"), "main"), true);
});