import { test } from "node:test";
import assert from "node:assert/strict";
import { ftpPromptText } from "../public/js/view/ftpPrompt.js";

test("the title names the new FTP and the rise", () => {
  assert.equal(ftpPromptText({ ftp: 252, delta: 7, basis: "cp" }).title, "New FTP detected: 252 W (+7)");
});

test("the detail follows the basis", () => {
  assert.equal(ftpPromptText({ ftp: 252, delta: 7, basis: "cp" }).detail, "From your best efforts of the last 90 days.");
  assert.equal(ftpPromptText({ ftp: 252, delta: 7, basis: "twenty" }).detail, "From your best 20 minutes.");
});

test("a test result says it was measured by the ramp test", () => {
  assert.equal(ftpPromptText({ ftp: 260, delta: 10, source: "test" }).detail, "Measured by the ramp test.");
});

test("a lower value shows its own minus sign", () => {
  assert.equal(ftpPromptText({ ftp: 240, delta: -5, source: "test" }).title, "New FTP detected: 240 W (−5)");
});
