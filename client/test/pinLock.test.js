import { test } from "node:test";
import assert from "node:assert/strict";
import { canOpen, unlock, setPin, changePin, removePin } from "../public/js/profile/pinLock.js";
import { isLocked } from "../public/js/profile/riders.js";

// The same fake PBKDF2 as in pin.test.js.
const fakeSubtle = {
  importKey: async (_format, raw) => ({ raw }),
  deriveBits: async ({ salt, iterations }, key) => {
    const out = new Uint8Array(32);
    const seed = [...key.raw].reduce((acc, byte) => (acc * 31 + byte) % 65521, 7);
    for (let i = 0; i < 32; i++) out[i] = (seed + salt[i % salt.length] * (i + 1) + iterations + i) % 256;
    return out.buffer;
  },
};

const counting = () => {
  let n = 1;
  return (length) => Uint8Array.from({ length }, () => n++ % 256);
};

const deps = () => ({ subtle: fakeSubtle, random: counting(), iterations: 10 });
const roster = { active: "main", ids: ["main", "bbbbbbbb"] };
const lockedRoster = () => setPin(roster, "bbbbbbbb", "1234", deps());

test("canOpen_lets_an_unlocked_rider_in_and_keeps_a_locked_one_out_until_unlocked", async () => {
  const locked = await lockedRoster();
  assert.equal(canOpen(locked, "main", null), true);
  assert.equal(canOpen(locked, "bbbbbbbb", null), false);
  assert.equal(canOpen(locked, "bbbbbbbb", "main"), false);
  assert.equal(canOpen(locked, "bbbbbbbb", "bbbbbbbb"), true);
});

test("unlock_accepts_the_right_pin_and_rejects_a_wrong_one", async () => {
  const locked = await lockedRoster();
  assert.equal(await unlock(locked, "bbbbbbbb", "1234", deps()), true);
  assert.equal(await unlock(locked, "bbbbbbbb", "4321", deps()), false);
});

test("unlock_for_a_rider_without_a_pin_is_true", async () => {
  assert.equal(await unlock(roster, "main", "", deps()), true);
});

test("setPin_stores_a_hash_and_never_the_pin", async () => {
  const locked = await lockedRoster();
  assert.equal(isLocked(locked, "bbbbbbbb"), true);
  assert.equal(JSON.stringify(locked).includes("1234"), false);
});

test("setPin_refuses_a_short_pin_an_unknown_rider_and_a_rider_that_already_has_one", async () => {
  assert.equal(await setPin(roster, "bbbbbbbb", "12", deps()), null);
  assert.equal(await setPin(roster, "zzzzzzzz", "1234", deps()), null);
  assert.equal(await setPin(await lockedRoster(), "bbbbbbbb", "5678", deps()), null);
});

test("changePin_needs_the_old_pin_and_a_valid_new_one", async () => {
  const locked = await lockedRoster();
  assert.equal(await changePin(locked, "bbbbbbbb", "0000", "5678", deps()), null);
  assert.equal(await changePin(locked, "bbbbbbbb", "1234", "56", deps()), null);
  const changed = await changePin(locked, "bbbbbbbb", "1234", "5678", deps());
  assert.equal(await unlock(changed, "bbbbbbbb", "5678", deps()), true);
  assert.equal(await unlock(changed, "bbbbbbbb", "1234", deps()), false);
});

test("removePin_needs_the_pin_and_then_leaves_the_roster_as_it_was_without_locks", async () => {
  const locked = await lockedRoster();
  assert.equal(await removePin(locked, "bbbbbbbb", "0000", deps()), null);
  assert.deepEqual(await removePin(locked, "bbbbbbbb", "1234", deps()), roster);
});
