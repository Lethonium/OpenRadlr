import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPin, verifyPin, isValidPin } from "../public/js/profile/pin.js";

// A fake PBKDF2: the same pin, salt and iterations always give the same bits.
const fakeSubtle = {
  importKey: async (_format, raw) => ({ raw }),
  deriveBits: async ({ salt, iterations }, key) => {
    const out = new Uint8Array(32);
    const seed = [...key.raw].reduce((acc, byte) => (acc * 31 + byte) % 65521, 7);
    for (let i = 0; i < 32; i++) out[i] = (seed + salt[i % salt.length] * (i + 1) + iterations + i) % 256;
    return out.buffer;
  },
};

// A random source that never repeats: each call continues the counter.
const counting = () => {
  let n = 1;
  return (length) => Uint8Array.from({ length }, () => n++ % 256);
};

const deps = () => ({ subtle: fakeSubtle, random: counting(), iterations: 10 });

test("hashPin_stores_a_salt_a_hash_and_the_iterations", async () => {
  const record = await hashPin("1234", deps());
  assert.equal(typeof record.salt, "string");
  assert.equal(typeof record.hash, "string");
  assert.equal(record.iterations, 10);
});

test("verifyPin_accepts_the_pin_that_was_hashed", async () => {
  const record = await hashPin("1234", deps());
  assert.equal(await verifyPin("1234", record, { subtle: fakeSubtle }), true);
});

test("verifyPin_rejects_another_pin", async () => {
  const record = await hashPin("1234", deps());
  assert.equal(await verifyPin("1235", record, { subtle: fakeSubtle }), false);
});

test("hashPin_uses_a_new_salt_every_time", async () => {
  const shared = deps();
  const first = await hashPin("1234", shared);
  const second = await hashPin("1234", shared);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test("hashPin_never_keeps_the_pin_in_the_record", async () => {
  const record = await hashPin("4821", deps());
  assert.equal(JSON.stringify(record).includes("4821"), false);
});

test("verifyPin_with_a_damaged_record_is_false_and_does_not_throw", async () => {
  assert.equal(await verifyPin("1234", null, { subtle: fakeSubtle }), false);
  assert.equal(await verifyPin("1234", { salt: "x" }, { subtle: fakeSubtle }), false);
  assert.equal(await verifyPin("1234", { salt: "!!", hash: "!!", iterations: 10 }, { subtle: fakeSubtle }), false);
});

test("isValidPin_wants_four_or_more_digits_and_nothing_else", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin("0000"), true);
  assert.equal(isValidPin("123"), false);
  assert.equal(isValidPin("12a4"), false);
  assert.equal(isValidPin("12 34"), false);
  assert.equal(isValidPin(""), false);
  assert.equal(isValidPin(1234), false);
});