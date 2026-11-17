import { test } from "node:test";
import assert from "node:assert/strict";
import { webUrl, renderExternalLink } from "../public/js/view/externalLink.js";

for (const url of [null, undefined, "", "  ", 42, "javascript:alert(1)", "https://", "https://bad host/join", "//discord.gg/invite"]) {
  test(`external links reject ${JSON.stringify(url)}`, () => {
    assert.equal(webUrl(url), null);
  });
}

test("external links accept and trim operator-provided web addresses", () => {
  assert.equal(webUrl(" https://community.example.org/join "), "https://community.example.org/join");
  assert.equal(webUrl("http://localhost/community"), "http://localhost/community");
});

function link() {
  return { hidden: true, removeAttribute(name) { delete this[name]; } };
}

test("configured links are revealed with the supplied destination", () => {
  const element = link();
  renderExternalLink(element, "https://community.example.org/join");
  assert.equal(element.hidden, false);
  assert.equal(element.href, "https://community.example.org/join");
});

test("a removed configuration hides the link and clears its old destination", () => {
  const element = link();
  renderExternalLink(element, "https://community.example.org/join");
  renderExternalLink(element, undefined);
  assert.equal(element.hidden, true);
  assert.equal(element.href, undefined);
});

test("an unsafe configuration never reveals a link", () => {
  const element = link();
  renderExternalLink(element, "javascript:alert(1)");
  assert.equal(element.hidden, true);
  assert.equal(element.href, undefined);
});

test("the browser start screen offers the published Android app", async () => {
  const { renderAndroidAppLink } = await import("../public/js/view/externalLink.js");
  const element = link();
  renderAndroidAppLink(element, { native: false });
  assert.equal(element.hidden, false);
  assert.equal(element.href, "https://play.google.com/store/apps/details?id=com.openradlr.app");
});

test("the native shell does not advertise installing the Android app", async () => {
  const { renderAndroidAppLink } = await import("../public/js/view/externalLink.js");
  const element = link();
  renderAndroidAppLink(element, { native: false });
  renderAndroidAppLink(element, { native: true });
  assert.equal(element.hidden, true);
  assert.equal(element.href, undefined);
});
