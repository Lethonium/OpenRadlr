import { test } from "node:test";
import assert from "node:assert/strict";

import { LOOK_GROUPS, heightLabel, lookPageModel } from "../public/js/view/lookPage.js";
import { LOOK_SLOTS, rolledChoice } from "../public/js/profile/riderLook.js";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";

const slotOf = (model, id) => model.flatMap((group) => group.slots).find((slot) => slot.id === id);

test("every slot shows on the page, in its group, in catalogue order", () => {
  const model = lookPageModel(rolledChoice(1), {});
  assert.deepEqual(model.map((group) => group.id), LOOK_GROUPS);
  assert.deepEqual(model.flatMap((group) => group.slots.map((slot) => slot.id)), Object.keys(LOOK_SLOTS));
});

test("the chosen piece is selected, locked pieces say what unlocks them", () => {
  const model = lookPageModel({ ...rolledChoice(1), sockHeight: "crew" }, {});
  const socks = slotOf(model, "sockHeight");
  assert.equal(socks.kind, "chips");
  assert.deepEqual(socks.options.filter((o) => o.selected).map((o) => o.id), ["crew"]);
  const tall = socks.options.find((o) => o.id === "tall");
  assert.equal(tall.locked, true);
  assert.match(tall.hint, new RegExp(en["achievement.weeks4.name"]));
  const knee = socks.options.find((o) => o.id === "knee");
  assert.equal(knee.hint, en["look.unlockSecret"], "a secret achievement keeps its name");
  assert.equal(slotOf(lookPageModel(rolledChoice(1), { weeks4: 1 }), "sockHeight").options.find((o) => o.id === "tall").locked, false);
});

test("colours and skins are swatches, height a range", () => {
  const model = lookPageModel({ ...rolledChoice(1), height: 180 }, {}, "imperial");
  assert.equal(slotOf(model, "primary").kind, "colour");
  assert.match(slotOf(model, "primary").options[0].colour, /^#[0-9a-f]{6}$/);
  assert.equal(slotOf(model, "skin").kind, "colour");
  assert.match(slotOf(model, "skin").options[0].colour, /^#[0-9a-f]{6}$/);
  const height = slotOf(model, "height");
  assert.deepEqual([height.kind, height.min, height.max, height.value, height.text], ["range", 150, 205, 180, "5′11″"]);
});

test("heights read in metres or feet and inches", () => {
  assert.equal(heightLabel(180), "1.80 m");
  assert.equal(heightLabel(152, "imperial"), "5′0″");
});

test("every group, slot and option has English and German text", () => {
  const keys = [...LOOK_GROUPS.map((g) => `look.group.${g}`)];
  for (const [slot, { options, colour }] of Object.entries(LOOK_SLOTS)) {
    keys.push(`look.slot.${slot}`);
    if (!colour) for (const option of options) keys.push(`look.option.${slot}.${option.id}`);
  }
  for (const key of keys) {
    assert.ok(en[key], `en ${key}`);
    assert.ok(de[key], `de ${key}`);
  }
});
