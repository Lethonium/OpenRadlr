// Every bundled route has a description in each language, so a new route can't ship half-translated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import en from "../public/js/i18n/en.js";
import de from "../public/js/i18n/de.js";

const ROUTES_DIR = new URL("../../routes/", import.meta.url);
const routes = readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, ROUTES_DIR), "utf8")));

test("each bundled route has an English description matching its file, and a German one", () => {
  assert.ok(routes.length > 0);
  for (const { id, description } of routes) {
    assert.equal(en[`route.${id}.description`], description, `en route.${id}.description`);
    assert.ok(de[`route.${id}.description`], `de route.${id}.description`);
  }
});
