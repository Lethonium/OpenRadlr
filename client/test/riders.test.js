import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RIDERS_KEY,
  loadRiders,
  saveRiders,
  addRider,
  removeRider,
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
