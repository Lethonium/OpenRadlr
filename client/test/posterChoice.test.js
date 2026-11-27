import { test } from "node:test";
import assert from "node:assert/strict";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";
import { POSTERS } from "../public/js/view3d/posters/lines.js";
import { ATLAS_SLOTS, choosePosters } from "../public/js/view3d/posters/choose.js";

const general = (distance) => ({ kind: "general", distance });
const climb = (distance) => ({ kind: "climb", distance });
const uploads = (n) => Array.from({ length: n }, (_, i) => ({ id: `up${i}` }));
const CONTEXT = { routeId: "rolling-hills", uploads: [], dateKey: "2026-11-27" };

test("every poster has English and German text under its boards.line key", () => {
  for (const poster of POSTERS) {
    const key = `boards.line.${poster.id}`;
    assert.ok(en[key], `en is missing ${key}`);
    assert.ok(de[key], `de is missing ${key}`);
  }
});

test("each board kind has at least six default posters", () => {
  for (const kind of ["general", "climb", "lastKm"]) {
    assert.ok(POSTERS.filter((poster) => poster.kind === kind).length >= 6, kind);
  }
});

test("the same boards and context choose the same posters", () => {
  const boards = [general(1000), climb(2000), general(5000), lastKm(9000)];
  assert.deepEqual(choosePosters(boards, CONTEXT), choosePosters(boards, CONTEXT));
});

test("three uploads on four general boards fill the first three in stored order", () => {
  const boards = [general(1000), general(4000), general(7000), general(10000)];
  const { slots, slotOf } = choosePosters(boards, { ...CONTEXT, uploads: uploads(3) });
  assert.deepEqual(slotOf.slice(0, 3).map((slot) => slots[slot]), [
    { type: "upload", id: "up0" },
    { type: "upload", id: "up1" },
    { type: "upload", id: "up2" },
  ]);
  assert.equal(slots[slotOf[3]].type, "default");
  assert.equal(POSTERS.find((poster) => poster.id === slots[slotOf[3]].id).kind, "general");
});

test("five uploads on two general boards pick two different uploads, and the date can change the pair", () => {
  const boards = [general(1000), general(6000)];
  const pick = (dateKey) => {
    const { slots, slotOf } = choosePosters(boards, { ...CONTEXT, uploads: uploads(5), dateKey });
    return slotOf.map((slot) => slots[slot].id);
  };
  const today = pick(CONTEXT.dateKey);
  assert.notEqual(today[0], today[1]);
  const pairs = new Set();
  for (let day = 10; day < 20; day += 1) pairs.add(pick(`2026-11-${day}`).join(","));
  assert.ok(pairs.size > 1, "every date picked the same pair");
});

test("climb boards only get climb posters", () => {
  const { slots, slotOf } = choosePosters([climb(2000), climb(4000)], CONTEXT);
  for (const slot of slotOf) {
    assert.equal(slots[slot].type, "default");
    assert.equal(POSTERS.find((poster) => poster.id === slots[slot].id).kind, "climb");
  }
});

test("twenty boards use at most eight atlas slots, each of the board's kind", () => {
  const boards = [
    ...Array.from({ length: 10 }, (_, i) => general(i * 1000)),
    ...Array.from({ length: 6 }, (_, i) => climb(i * 1000)),
    ...Array.from({ length: 4 }, (_, i) => lastKm(i * 1000)),
  ];
  const { slots, slotOf } = choosePosters(boards, { ...CONTEXT, uploads: uploads(2) });
  assert.ok(slots.length <= ATLAS_SLOTS, `${slots.length} slots`);
  boards.forEach((board, i) => {
    const slot = slots[slotOf[i]];
    const kind = slot.type === "upload" ? "general" : POSTERS.find((poster) => poster.id === slot.id).kind;
    assert.equal(kind, board.kind, `board ${i}`);
  });
});

function lastKm(distance) {
  return { kind: "lastKm", distance };
}
