import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAnalytics } from "../public/js/analytics.js";

function fakeDocument() {
  const appended = [];
  return {
    appended,
    createElement: (tag) => ({ tag, dataset: {} }),
    head: { append: (el) => appended.push(el) },
  };
}

const analytics = { domain: "ride.example.org", script: "https://plausible.io/js/script.js" };

test("without analytics in the server info nothing is loaded", () => {
  const document = fakeDocument();
  assert.equal(loadAnalytics({ name: "Mine" }, document), false);
  assert.equal(loadAnalytics(null, document), false);
  assert.deepEqual(document.appended, []);
});

test("analytics from the server info adds a deferred script for its domain", () => {
  const document = fakeDocument();
  assert.equal(loadAnalytics({ analytics }, document), true);
  const [script] = document.appended;
  assert.equal(script.tag, "script");
  assert.equal(script.src, analytics.script);
  assert.equal(script.defer, true);
  assert.equal(script.dataset.domain, "ride.example.org");
});

test("the script is added only once however often the info is refreshed", () => {
  const document = fakeDocument();
  loadAnalytics({ analytics }, document);
  assert.equal(loadAnalytics({ analytics }, document), false);
  assert.equal(document.appended.length, 1);
});
