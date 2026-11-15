import { test } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS } from "../public/js/profile/achievements.js";
import { achievementCards } from "../public/js/view/achievementsView.js";

const ctx = { locale: "en-GB" };
const at = (d) => new Date(2026, 10, d, 12).getTime();
const ids = (cards) => cards.map((c) => c.id);

test("earned come first, newest first", () => {
  const { cards } = achievementCards({ earned: { firstRide: at(1), century: at(5) } }, ctx);
  assert.deepEqual(ids(cards).slice(0, 2), ["century", "firstRide"]);
});

test("locked come next in list order, secret locked last", () => {
  const { cards } = achievementCards({ earned: {} }, ctx);
  const secret = ACHIEVEMENTS.filter((a) => a.secret).map((a) => a.id);
  const open = ACHIEVEMENTS.filter((a) => !a.secret).map((a) => a.id);
  assert.deepEqual(ids(cards), [...open, ...secret]);
});

test("a locked one shows its name and hint, no date", () => {
  const card = achievementCards({ earned: {} }, ctx).cards.find((c) => c.id === "century");
  assert.deepEqual(card, { id: "century", state: "locked", name: "Century", hint: "Ride 100 km in one go.", date: null });
});

test("a secret locked one shows ??? and no hint", () => {
  const card = achievementCards({ earned: {} }, ctx).cards.find((c) => c.id === "nightOwl");
  assert.deepEqual({ name: card.name, hint: card.hint, state: card.state }, { name: "???", hint: "", state: "secret" });
});

test("a secret earned one shows its name, hint and date", () => {
  const card = achievementCards({ earned: { nightOwl: at(3) } }, ctx).cards[0];
  assert.deepEqual(card, { id: "nightOwl", state: "earned", name: "Night Owl", hint: "Start a ride between 22:00 and 04:00.", date: "3 Nov 2026" });
});

test("ids this version doesn't know are not shown or counted", () => {
  const { cards, count } = achievementCards({ earned: { future: at(1) } }, ctx);
  assert.equal(cards.length, ACHIEVEMENTS.length);
  assert.equal(count, `0 of ${ACHIEVEMENTS.length}`);
});

test("the count says how many of all are earned", () => {
  assert.equal(achievementCards({ earned: { firstRide: at(1), century: at(2) } }, ctx).count, `2 of ${ACHIEVEMENTS.length}`);
});

test("a malformed locale still formats the date", () => {
  const card = achievementCards({ earned: { firstRide: at(1) } }, { locale: "en-US@posix" }).cards[0];
  assert.equal(typeof card.date, "string");
});
