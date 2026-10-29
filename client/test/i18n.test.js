import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  detectLocale, getLocale, setLocale, t, tn, initLocale, saveLocale, LOCALE_KEY,
} from "../public/js/i18n/i18n.js";

afterEach(() => setLocale("en"));

test("detectLocale: saved choice wins over browser languages", () => {
  assert.equal(detectLocale({ saved: "de", languages: ["en"] }), "de");
});
test("detectLocale: first supported base language is used", () => {
  assert.equal(detectLocale({ languages: ["fr", "de-AT"] }), "de");
  assert.equal(detectLocale({ languages: ["DE"] }), "de");
  assert.equal(detectLocale({ languages: ["de-DE-u-co-phonebk"] }), "de");
});
test("detectLocale: falls back to en", () => {
  assert.equal(detectLocale({ languages: ["zh-Hans"] }), "en");
  assert.equal(detectLocale({ languages: [] }), "en");
  assert.equal(detectLocale({}), "en");
  assert.equal(detectLocale(), "en");
});
test("detectLocale: unsupported saved value is ignored", () => {
  assert.equal(detectLocale({ saved: "fr", languages: ["de"] }), "de");
});

test("t interpolates params", () => {
  assert.equal(t("test.hello", { name: "Ann" }), "Hello Ann");
});
test("t falls back to en when de lacks the key", () => {
  setLocale("de");
  assert.equal(t("test.hello", { name: "Ann" }), "Hello Ann");
});
test("t returns the key when unknown", () => {
  assert.equal(t("no.such.key"), "no.such.key");
});
test("t inserts param values literally", () => {
  assert.equal(t("test.hello", { name: "<b>$&{x}" }), "Hello <b>$&{x}");
});
test("t leaves a missing param placeholder", () => {
  assert.equal(t("test.hello"), "Hello {name}");
});

test("tn en plural forms", () => {
  assert.equal(tn("test.rider", 0), "0 riders");
  assert.equal(tn("test.rider", 1), "1 rider");
  assert.equal(tn("test.rider", 2), "2 riders");
});
test("tn de plural forms", () => {
  setLocale("de");
  assert.equal(tn("test.rider", 1), "1 Fahrer");
  assert.equal(tn("test.rider", 2), "2 Fahrer");
});

test("initLocale survives a throwing storage", () => {
  const storage = { getItem() { throw new Error("denied"); } };
  assert.equal(initLocale({ storage, languages: ["de"] }), "de");
  assert.equal(getLocale(), "de");
});
test("initLocale reads the saved choice", () => {
  const storage = { getItem: (k) => (k === LOCALE_KEY ? "de" : null) };
  assert.equal(initLocale({ storage, languages: ["en"] }), "de");
});
test("saveLocale never throws", () => {
  const storage = { setItem() { throw new Error("full"); } };
  assert.doesNotThrow(() => saveLocale("de", storage));
});
test("setLocale with unsupported code returns en", () => {
  assert.equal(setLocale("xx"), "en");
});

test("a saved choice round-trips through storage", () => {
  const data = {};
  const storage = { setItem: (k, v) => { data[k] = v; }, getItem: (k) => data[k] ?? null };
  saveLocale("de", storage);
  assert.equal(initLocale({ storage, languages: ["en"] }), "de");
});
test("junk in storage falls back to the detected locale", () => {
  const storage = { getItem: () => "" };
  assert.equal(initLocale({ storage, languages: ["de"] }), "de");
});
