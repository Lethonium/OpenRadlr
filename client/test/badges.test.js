import { test } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS } from "../public/js/profile/achievements.js";
import { BADGE_SHAPES, badgeSvg } from "../public/js/view/badges.js";

const withoutIds = (svg) => svg.replace(/\bb\d+/g, "");

test("every achievement has a pin", () => {
  assert.deepEqual(Object.keys(BADGE_SHAPES).sort(), ACHIEVEMENTS.map((a) => a.id).sort());
});

test("every pin has its own drawing", () => {
  const drawings = new Set(ACHIEVEMENTS.map((a) => withoutIds(badgeSvg(a.id))));
  assert.equal(drawings.size, ACHIEVEMENTS.length);
});

test("secret achievements wear the starburst", () => {
  for (const a of ACHIEVEMENTS) assert.equal(BADGE_SHAPES[a.id] === "burst", a.secret, a.id);
});

test("a hidden pin shows a question mark, not its drawing", () => {
  assert.equal(withoutIds(badgeSvg("nightOwl", { hidden: true })), withoutIds(badgeSvg("bendy", { hidden: true })));
});

test("two pins on one page don't share gradient ids", () => {
  const ids = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const first = ids(badgeSvg("cookieBurner"));
  assert.ok(ids(badgeSvg("cookieBurner")).every((id) => !first.includes(id)));
});
