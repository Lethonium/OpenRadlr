import { test } from "node:test";
import assert from "node:assert/strict";
import { setPinFlow, changePinFlow, removePinFlow } from "../public/js/profile/pinFlows.js";
import { setPin, unlock } from "../public/js/profile/pinLock.js";
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

const texts = {
  newTitle: "new",
  newHint: "",
  next: "Next",
  confirmTitle: "confirm",
  confirmHint: "",
  save: "Save",
  invalid: "invalid",
  mismatch: "mismatch",
  currentTitle: "current",
  wrong: "wrong",
  failed: "failed",
  removeTitle: "remove",
  remove: "Remove",
};

// A scripted dialog: each ask takes the entries in turn. An entry the check refuses is
// remembered and the next one tried; running out of entries is the rider backing out.
const scripted = (entries) => {
  const problems = [];
  const asked = [];
  const ask = async ({ title, check = async () => null }) => {
    asked.push(title);
    while (entries.length) {
      const pin = entries.shift();
      const problem = await check(pin);
      if (problem) {
        problems.push(problem);
        continue;
      }
      return pin;
    }
    return null;
  };
  return { ask, problems, asked };
};

const roster = { active: "main", ids: ["main"] };
const locked = () => setPin(roster, "main", "1234", deps());

test("setPinFlow_asks_twice_and_locks_the_rider_with_the_pin", async () => {
  const dialog = scripted(["1234", "1234"]);
  const next = await setPinFlow({ roster, id: "main", ask: dialog.ask, deps: deps(), texts });
  assert.deepEqual(dialog.asked, ["new", "confirm"]);
  assert.equal(isLocked(next, "main"), true);
  assert.equal(await unlock(next, "main", "1234", deps()), true);
});

test("setPinFlow_refuses_a_short_pin_and_waits_for_a_valid_one", async () => {
  const dialog = scripted(["12", "1234", "1234"]);
  const next = await setPinFlow({ roster, id: "main", ask: dialog.ask, deps: deps(), texts });
  assert.deepEqual(dialog.problems, ["invalid"]);
  assert.equal(isLocked(next, "main"), true);
});

test("setPinFlow_refuses_a_confirmation_that_does_not_match", async () => {
  const dialog = scripted(["1234", "1235", "1234"]);
  const next = await setPinFlow({ roster, id: "main", ask: dialog.ask, deps: deps(), texts });
  assert.deepEqual(dialog.problems, ["mismatch"]);
  assert.equal(isLocked(next, "main"), true);
});

test("setPinFlow_backing_out_at_either_step_changes_nothing", async () => {
  assert.equal(await setPinFlow({ roster, id: "main", ask: scripted([]).ask, deps: deps(), texts }), null);
  assert.equal(await setPinFlow({ roster, id: "main", ask: scripted(["1234"]).ask, deps: deps(), texts }), null);
});

test("changePinFlow_needs_the_current_pin_then_takes_the_new_one_twice", async () => {
  const dialog = scripted(["0000", "1234", "5678", "5678"]);
  const next = await changePinFlow({ roster: await locked(), id: "main", ask: dialog.ask, deps: deps(), texts });
  assert.deepEqual(dialog.problems, ["wrong"]);
  assert.equal(await unlock(next, "main", "5678", deps()), true);
  assert.equal(await unlock(next, "main", "1234", deps()), false);
});

test("changePinFlow_backing_out_keeps_the_old_pin", async () => {
  assert.equal(await changePinFlow({ roster: await locked(), id: "main", ask: scripted(["1234"]).ask, deps: deps(), texts }), null);
});

test("removePinFlow_needs_the_current_pin", async () => {
  const dialog = scripted(["0000", "1234"]);
  const next = await removePinFlow({ roster: await locked(), id: "main", ask: dialog.ask, deps: deps(), texts });
  assert.deepEqual(dialog.problems, ["wrong"]);
  assert.equal(isLocked(next, "main"), false);
});

test("removePinFlow_backing_out_keeps_the_pin", async () => {
  assert.equal(await removePinFlow({ roster: await locked(), id: "main", ask: scripted([]).ask, deps: deps(), texts }), null);
});

test("removePinFlow_asks_with_the_remove_title_and_changePinFlow_with_the_current_one", async () => {
  const removing = scripted(["1234"]);
  await removePinFlow({ roster: await locked(), id: "main", ask: removing.ask, deps: deps(), texts });
  assert.deepEqual(removing.asked, ["remove"]);
  const changing = scripted(["1234"]);
  await changePinFlow({ roster: await locked(), id: "main", ask: changing.ask, deps: deps(), texts });
  assert.equal(changing.asked[0], "current");
});
