import { test } from "node:test";
import assert from "node:assert/strict";

import { BIKE_TYPES_FOR_LOOKS, HAIR_STYLES, HELMET_STYLES, RIDER_KITS, RIDER_PATTERNS, RIDER_SKINS, SOCK_HEIGHTS, lookOf } from "../public/js/view3d/assets/riders/look.js";

const SAMPLE_IDS = Array.from({ length: 200 }, (_, index) => index + 1);
const EXTREME_IDS = [0, -1, 1, 2 ** 31 - 1, -(2 ** 31), 123456789];
const HEX = /^#[0-9a-f]{6}$/;

const looks = (ids) => ids.map((id) => lookOf(id));
const countBy = (items, key) => items.reduce((counts, item) => ({ ...counts, [key(item)]: (counts[key(item)] ?? 0) + 1 }), {});

test("lookOf is the same for the same id", () => {
  assert.deepEqual(lookOf(42), lookOf(42));
});

test("lookOf gives a valid look for any integer id", () => {
  for (const id of EXTREME_IDS) {
    const look = lookOf(id);
    assert.ok(look.height >= 1.5 && look.height <= 2.05, `height for ${id}`);
    assert.ok(look.weight >= 45 && look.weight <= 120, `weight for ${id}`);
    assert.ok(Object.hasOwn(RIDER_SKINS, look.skin), `skin for ${id}`);
    assert.ok(RIDER_PATTERNS.includes(look.pattern), `pattern for ${id}`);
    assert.ok(RIDER_KITS.includes(look.kit), `kit for ${id}`);
    assert.ok(BIKE_TYPES_FOR_LOOKS.includes(look.bike), `bike for ${id}`);
    for (const key of ["primary", "secondary", "accent", "shorts", "socks", "shoes", "helmet", "gloveColor", "hair", "frame", "frameAccent"]) {
      assert.match(look[key], HEX, `${key} for ${id}`);
    }
  }
});

test("looks vary across riders", () => {
  const all = looks(SAMPLE_IDS);
  assert.ok(new Set(all.map((look) => look.skin)).size >= 5);
  assert.ok(new Set(all.map((look) => look.pattern)).size >= 6);
  assert.ok(new Set(all.map((look) => look.kit)).size >= 3);
  assert.ok(new Set(all.map((look) => look.bike)).size >= 3);
  const heights = all.map((look) => look.height);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.3);
});

test("weight follows height plausibly", () => {
  for (const look of looks(SAMPLE_IDS)) {
    const bmi = look.weight / (look.height * look.height);
    assert.ok(bmi >= 18 && bmi <= 33, `bmi ${bmi} for height ${look.height}`);
  }
});

test("most riders ride road bikes", () => {
  const bikes = countBy(looks(SAMPLE_IDS), (look) => look.bike);
  assert.ok((bikes.road ?? 0) > 0.6 * SAMPLE_IDS.length, JSON.stringify(bikes));
});

test("casual kits are rare", () => {
  const kits = countBy(looks(SAMPLE_IDS), (look) => look.kit);
  assert.ok((kits.casual ?? 0) < 0.15 * SAMPLE_IDS.length, JSON.stringify(kits));
});

test("the pieces added for rider looks leave every earlier field as it was", () => {
  const text = Array.from({ length: 50 }, (_, i) => {
    const l = lookOf(i + 1);
    return [l.kit, l.pattern, l.primary, l.helmet, l.glasses ? 1 : 0, l.bike, l.frame, l.frameAccent, l.height.toFixed(4)].join("|");
  }).join(";");
  let hash = 0;
  for (const char of text) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  assert.equal(hash, 88756916);
});

test("looks roll the new pieces too: sock heights, hair styles, a rare moustache and aero helmet", () => {
  const all = looks(SAMPLE_IDS);
  for (const look of all) {
    assert.ok(SOCK_HEIGHTS.includes(look.sockHeight), look.sockHeight);
    assert.ok(HAIR_STYLES.includes(look.hairStyle), look.hairStyle);
    assert.ok(HELMET_STYLES.includes(look.helmetStyle), look.helmetStyle);
    assert.equal(typeof look.moustache, "boolean");
  }
  assert.ok(new Set(all.map((look) => look.sockHeight)).size >= 3);
  assert.ok(new Set(all.map((look) => look.hairStyle)).size >= 2);
  const moustaches = all.filter((look) => look.moustache).length;
  assert.ok(moustaches > 0 && moustaches < 0.15 * all.length, `${moustaches} moustaches`);
  assert.ok(all.every((look) => look.sockHeight !== "knee" && !["cap", "lemon"].includes(look.helmetStyle)), "the silly pieces are earned, never rolled");
});
