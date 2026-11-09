import { test } from "node:test";
import assert from "node:assert/strict";
import { languageButtonStates } from "../public/js/i18n/selector.js";

test("only the current language is pressed", () => {
  assert.deepEqual(languageButtonStates("de"), { en: false, de: true });
  assert.deepEqual(languageButtonStates("en"), { en: true, de: false });
});
