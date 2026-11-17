import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("workout import accepts Android's generic file MIME type", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const input = html.match(/<input id="workout-file"[^>]*>/)?.[0] ?? "";

  assert.match(input, /accept="[^"]*application\/octet-stream/);
});
