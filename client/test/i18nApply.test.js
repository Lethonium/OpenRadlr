import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyTranslations } from "../public/js/i18n/apply.js";
import { setLocale } from "../public/js/i18n/i18n.js";

afterEach(() => setLocale("en"));

function fakeEl({ i18n, attr } = {}) {
  const attrs = {};
  const el = {
    dataset: {},
    attrs,
    textContent: "",
    setAttribute(name, value) { attrs[name] = value; },
    matches(sel) {
      return (sel.includes("[data-i18n]") && i18n !== undefined) ||
        (sel.includes("[data-i18n-attr]") && attr !== undefined);
    },
  };
  if (i18n !== undefined) el.dataset.i18n = i18n;
  if (attr !== undefined) el.dataset.i18nAttr = attr;
  Object.defineProperty(el, "innerHTML", {
    set() { throw new Error("innerHTML must not be written"); },
  });
  return el;
}

function fakeRoot(children, self = {}) {
  return {
    ...self,
    querySelectorAll(sel) {
      return children.filter((c) => c.matches(sel));
    },
  };
}

test("sets text from data-i18n", () => {
  const el = fakeEl({ i18n: "test.hello" });
  applyTranslations(fakeRoot([el]));
  assert.equal(el.textContent, "Hello {name}");
});

test("sets attributes from data-i18n-attr pairs", () => {
  const el = fakeEl({ attr: "title:test.hello,aria-label:test.rider.other" });
  applyTranslations(fakeRoot([el]));
  assert.equal(el.attrs.title, "Hello {name}");
  assert.equal(el.attrs["aria-label"], "{n} riders");
});

test("assigns markup-like text as text, never innerHTML", () => {
  const el = fakeEl({ i18n: "<img>" });
  applyTranslations(fakeRoot([el]));
  assert.equal(el.textContent, "<img>");
});

test("renders English when de lacks the key", () => {
  setLocale("de");
  const el = fakeEl({ i18n: "test.hello" });
  applyTranslations(fakeRoot([el]));
  assert.equal(el.textContent, "Hello {name}");
});

test("handles the root element itself", () => {
  const self = fakeEl({ i18n: "test.hello" });
  const root = Object.assign(self, { querySelectorAll: () => [] });
  applyTranslations(root);
  assert.equal(self.textContent, "Hello {name}");
});

test("translates a cloned subtree like the ride template", () => {
  const el = fakeEl({ i18n: "test.hello" });
  const template = fakeRoot([el]);
  const clone = fakeRoot([{ ...el, attrs: {}, dataset: { ...el.dataset }, matches: el.matches, setAttribute() {} }]);
  applyTranslations(template);
  applyTranslations(clone);
  const [cloned] = clone.querySelectorAll("[data-i18n]");
  assert.equal(cloned.textContent, "Hello {name}");
});
