import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOOK_KEY,
  LOOK_SLOTS,
  decodeLook,
  encodeLook,
  isUnlocked,
  loadLook,
  lookFromChoice,
  randomChoice,
  rolledChoice,
  sanitizeLook,
  saveLook,
} from "../public/js/profile/riderLook.js";
import { ACHIEVEMENTS } from "../public/js/profile/achievements.js";
import { RIDER_SKINS, lookOf } from "../public/js/view3d/assets/riders/look.js";
import { seededRandom } from "../public/js/world/noise.js";

const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data };
};
const everything = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 1]));

test("every unlock names a real achievement", () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const [slot, { options }] of Object.entries(LOOK_SLOTS)) {
    for (const option of options) if (option.unlock) assert.ok(ids.has(option.unlock), `${slot}.${option.id} needs ${option.unlock}`);
  }
});

test("skin tones and hair colours are never locked", () => {
  assert.deepEqual(LOOK_SLOTS.skin.options.map((o) => o.id), Object.keys(RIDER_SKINS));
  for (const slot of ["skin", "hair"]) assert.ok(LOOK_SLOTS[slot].options.every((o) => !o.unlock), slot);
});

test("every slot has a free option first, and the fun pieces are earned", () => {
  for (const [slot, { options, range }] of Object.entries(LOOK_SLOTS)) if (!range) assert.ok(!options[0].unlock, slot);
  const unlockOf = (slot, id) => LOOK_SLOTS[slot].options.find((o) => o.id === id).unlock;
  assert.equal(unlockOf("sockHeight", "knee"), "thumbWarrior");
  assert.equal(unlockOf("helmetStyle", "lemon"), "lemons10");
  assert.equal(unlockOf("style", "classic"), "classicRider");
  assert.equal(unlockOf("frame", "#d4af37"), "km1000");
  assert.equal(unlockOf("sockHeight", "crew"), undefined);
});

test("isUnlocked follows the earned achievements", () => {
  const knee = LOOK_SLOTS.sockHeight.options.find((o) => o.id === "knee");
  assert.equal(isUnlocked(knee, {}), false);
  assert.equal(isUnlocked(knee, { thumbWarrior: 5 }), true);
});

test("a look survives the code, and the code is short and plain", () => {
  const choice = randomChoice(everything, seededRandom(7));
  const code = encodeLook(choice);
  assert.match(code, /^[0-9a-z]{1,48}$/);
  assert.deepEqual(decodeLook(code), choice);
});

test("a code this client cannot read gives nothing, a partly unknown one the slots it knows", () => {
  assert.equal(decodeLook("9abc"), null);
  assert.equal(decodeLook("Hello!"), null);
  assert.equal(decodeLook(42), null);
  const code = encodeLook(rolledChoice(3));
  const broken = `${code.slice(0, 3)}z${code.slice(4)}`;
  const decoded = decodeLook(broken);
  const third = Object.keys(LOOK_SLOTS)[2];
  assert.equal(decoded[third], undefined, "the unknown index is left out");
  assert.equal(decoded.style, rolledChoice(3).style);
});

test("sanitizeLook swaps locked pieces for the slot's free default and fills gaps", () => {
  const choice = { ...rolledChoice(1), sockHeight: "knee", helmetStyle: "lemon" };
  delete choice.bike;
  const clean = sanitizeLook(choice, {});
  assert.equal(clean.sockHeight, "low");
  assert.equal(clean.helmetStyle, "road");
  assert.ok(LOOK_SLOTS.bike.options.some((o) => o.id === clean.bike));
  assert.equal(sanitizeLook(choice, { thumbWarrior: 1 }).sockHeight, "knee");
  assert.equal(sanitizeLook({ height: 999 }, {}).height, 205);
});

test("random and rolled choices use only unlocked pieces", () => {
  for (let seed = 1; seed < 40; seed += 1) {
    const choice = randomChoice({}, seededRandom(seed));
    for (const [slot, { options }] of Object.entries(LOOK_SLOTS)) {
      if (slot === "height") continue;
      const option = options.find((o) => o.id === choice[slot]);
      assert.ok(option && !option.unlock, `${slot} ${choice[slot]}`);
    }
  }
  assert.deepEqual(rolledChoice(5), rolledChoice(5));
  assert.notDeepEqual(rolledChoice(5), rolledChoice(6));
});

test("a choice turns into the look the rig draws", () => {
  const base = lookOf(1);
  const look = lookFromChoice({ ...rolledChoice(2), height: 180, build: "heavy", kit: "skinsuit", sockHeight: "knee", gloves: "off", style: "classic" }, base);
  assert.equal(look.height, 1.8);
  assert.ok(look.weight / (1.8 * 1.8) > 28);
  assert.equal(look.kit, "skinsuit");
  assert.equal(look.sockHeight, "knee");
  assert.equal(look.gloves, false);
  assert.equal(look.classic, true);
  const partial = lookFromChoice({ kit: "long" }, base);
  assert.deepEqual({ ...partial, kit: base.kit }, { ...base, classic: false });
});

test("the look is kept in the rider's storage", () => {
  const storage = memory();
  assert.equal(loadLook(storage), null);
  const choice = rolledChoice(9);
  assert.equal(saveLook(storage, choice), true);
  assert.ok(storage.data.has(LOOK_KEY));
  assert.deepEqual(loadLook(storage), choice);
  storage.setItem(LOOK_KEY, "{broken");
  assert.equal(loadLook(storage), null);
  assert.equal(saveLook({ setItem: () => { throw new Error("full"); } }, choice), false);
});
