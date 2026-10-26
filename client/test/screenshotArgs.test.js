import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, DEFAULT_URL } from "../screenshotArgs.mjs";

test("no arguments use the default url", () => {
  assert.equal(parseArgs([]).url, DEFAULT_URL);
});

test("a positional argument is the url", () => {
  assert.equal(parseArgs(["http://orserver:8080"]).url, "http://orserver:8080");
});

test("a second positional argument is rejected", () => {
  assert.throws(() => parseArgs(["http://a", "http://b"]), /Unexpected argument: http:\/\/b/);
});

test("flags are parsed alongside the url", () => {
  const opts = parseArgs(["http://a", "--out", "x.png", "--width", "400", "--wait", "0"]);
  assert.deepEqual([opts.url, opts.out, opts.width, opts.wait], ["http://a", "x.png", 400, 0]);
});

test("a negative or non-numeric flag value is rejected", () => {
  assert.throws(() => parseArgs(["--height", "abc"]), /Invalid --height/);
});
