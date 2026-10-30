// de.js must mirror en.js: same keys, same {params}, complete plural groups.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";
import { setLocale, tn } from "../public/js/i18n/i18n.js";
import { serverStatus } from "../public/js/view/startMenu.js";

afterEach(() => setLocale("en"));

const params = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test("de has every en key", () => {
  assert.deepEqual(Object.keys(en).filter((key) => !(key in de)), []);
});

test("de has no key en lacks", () => {
  assert.deepEqual(Object.keys(de).filter((key) => !(key in en)), []);
});

test("every key uses the same {params} in both languages", () => {
  const mismatched = Object.keys(en).filter((key) => key in de && params(en[key]).join() !== params(de[key]).join());
  assert.deepEqual(mismatched, []);
});

test("plural groups define .one and .other in both languages", () => {
  for (const dictionary of [en, de]) {
    const groups = new Set(Object.keys(dictionary).filter((key) => /\.(one|other)$/.test(key)).map((key) => key.replace(/\.(one|other)$/, "")));
    const incomplete = [...groups].filter((group) => !(`${group}.one` in dictionary && `${group}.other` in dictionary));
    assert.deepEqual(incomplete, []);
  }
});

test("German plurals and the server status read in German", () => {
  setLocale("de");
  assert.equal(tn("menu.riders", 1), "1 Fahrer");
  assert.equal(tn("menu.riders", 2), "2 Fahrer");
  assert.equal(serverStatus({ players: 3, max_players: 50 }).text, "3 Fahrer online · Platz für 47 weitere");
  assert.equal(serverStatus(null).text, "Server nicht erreichbar");
});
