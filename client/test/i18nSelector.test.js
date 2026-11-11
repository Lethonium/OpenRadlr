import { test } from "node:test";
import assert from "node:assert/strict";
import { languageOptions } from "../public/js/i18n/selector.js";

test("one option per supported language, in its own name, with only the current one selected", () => {
  assert.deepEqual(languageOptions("de"), [
    { code: "en", label: "English", selected: false },
    { code: "de", label: "Deutsch", selected: true },
  ]);
  assert.deepEqual(
    languageOptions("en").map((option) => option.selected),
    [true, false],
  );
});
