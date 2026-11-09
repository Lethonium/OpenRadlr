// main.js imports `t`: a bare `t` that is not a call (a leftover `t - start`) is a bug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../public/js/main.js", import.meta.url), "utf8");

test("main.js never uses the i18n function t as a plain value", () => {
  const offenders = [];
  main.split("\n").forEach((line, index) => {
    if (/^\s*(\/\/|\/\*|\*|import )/.test(line)) return;
    const code = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    if (/(?<![\w$.])t(?![\w$:])(?!\s*\()/.test(code)) offenders.push(`${index + 1} ${line.trim()}`);
  });
  assert.deepEqual(offenders, []);
});
