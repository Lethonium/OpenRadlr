import { test } from "node:test";
import assert from "node:assert/strict";
import { createMenuDialog } from "../public/js/view/menuDialog.js";
import { createPanelStack } from "../public/js/input/panelStack.js";

const ALL = ["overview", "view", "vehicle", "race", "settings"];

function fakeEl(dataset = {}) {
  const listeners = new Map();
  const attrs = new Map();
  return {
    dataset, hidden: false, focused: 0, listeners, attrs,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    focus() { this.focused++; fakeEl.active = this; },
    fire(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ target: this, preventDefault() { event.prevented = true; }, ...event }); },
    listenerCount() { let n = 0; for (const set of listeners.values()) n += set.size; return n; },
  };
}

function fakeRoot(pageIds = ALL) {
  const root = fakeEl();
  root.pages = pageIds.map((id) => fakeEl({ menuPage: id }));
  root.navs = pageIds.map((id) => fakeEl({ menuNav: id }));
  root.backdrop = fakeEl();
  root.back = fakeEl();
  root.closeButton = fakeEl();
  root.querySelectorAll = (sel) => ({ "[data-menu-page]": root.pages, "[data-menu-nav]": root.navs }[sel] ?? []);
  root.querySelector = (sel) => ({ "[data-menu-backdrop]": root.backdrop, "[data-menu-back]": root.back, "[data-menu-close]": root.closeButton }[sel] ?? null);
  return root;
}

function fakeNarrow(matches) {
  const narrow = {
    matches, handlers: new Set(),
    addEventListener(_t, fn) { narrow.handlers.add(fn); },
    removeEventListener(_t, fn) { narrow.handlers.delete(fn); },
    set(value) { narrow.matches = value; for (const fn of [...narrow.handlers]) fn({ matches: value }); },
  };
  return narrow;
}

function setup({ narrow = false, pages = ALL } = {}) {
  fakeEl.active = null;
  const root = fakeRoot();
  const opener = fakeEl();
  fakeEl.active = opener;
  const stack = createPanelStack();
  const matchNarrow = fakeNarrow(narrow);
  const seen = [];
  const first = fakeEl(), last = fakeEl();
  const dialog = createMenuDialog({
    root, stack, matchNarrow, pages, onPage: (id) => seen.push(id),
    getActiveElement: () => fakeEl.active, focusables: () => [first, last],
  });
  return { root, opener, stack, matchNarrow, seen, dialog, first, last };
}

const shown = (root) => root.pages.filter((p) => !p.hidden).map((p) => p.dataset.menuPage);

test("open shows the overview first on a wide screen and the page list on a narrow one", () => {
  const wide = setup();
  wide.dialog.open();
  assert.equal(wide.dialog.page, "overview");
  assert.deepEqual(shown(wide.root), ["overview"]);
  const narrow = setup({ narrow: true });
  narrow.dialog.open();
  assert.equal(narrow.dialog.page, null);
  assert.deepEqual(shown(narrow.root), []);
  assert.equal(narrow.root.getAttribute("data-screen"), "list");
  narrow.dialog.open("view");
  assert.equal(narrow.dialog.page, "view");
});

test("close returns focus to the opener", () => {
  const { dialog, opener, first } = setup();
  dialog.open();
  assert.equal(first.focused, 1);
  dialog.close();
  assert.equal(opener.focused, 1);
  assert.equal(dialog.isOpen, false);
});

test("closing through the stack closes the dialog", () => {
  const { dialog, stack, root } = setup();
  dialog.open();
  assert.equal(stack.closeTop(), true);
  assert.equal(dialog.isOpen, false);
  assert.equal(root.hidden, true);
  assert.equal(stack.isOpen, false);
});

test("the popover registered later closes first", () => {
  const { dialog, stack } = setup();
  dialog.open();
  const log = [];
  stack.push({ close: () => log.push("popover") });
  stack.closeTop();
  assert.deepEqual(log, ["popover"]);
  assert.equal(dialog.isOpen, true);
  stack.closeTop();
  assert.equal(dialog.isOpen, false);
});

test("crossing the breakpoint with a page open keeps that page", () => {
  const { dialog, matchNarrow } = setup();
  dialog.open("vehicle");
  matchNarrow.set(true);
  assert.equal(dialog.page, "vehicle");
  matchNarrow.set(false);
  assert.equal(dialog.page, "vehicle");
});

test("going narrow with no page selected shows the list, and wide picks the first page", () => {
  const { dialog, matchNarrow, seen } = setup({ narrow: true });
  dialog.open();
  matchNarrow.set(false);
  assert.equal(dialog.page, "overview");
  assert.equal(seen.at(-1), "overview");
});

test("refreshPages drops an empty page and falls back", () => {
  const { dialog, root } = setup();
  dialog.open("vehicle");
  dialog.refreshPages(["overview", "view"]);
  assert.equal(dialog.page, "overview");
  assert.equal(root.navs.find((n) => n.dataset.menuNav === "vehicle").hidden, true);
  assert.equal(root.navs.find((n) => n.dataset.menuNav === "view").hidden, false);
  assert.deepEqual(shown(root), ["overview"]);
});

test("showConfirm pushes its own panel so Esc cancels it first", () => {
  const { dialog, stack, root } = setup();
  dialog.open("view");
  dialog.showConfirm();
  assert.equal(root.getAttribute("data-confirm"), "");
  stack.closeTop();
  assert.equal(root.getAttribute("data-confirm"), null);
  assert.equal(dialog.isOpen, true);
  assert.equal(dialog.page, "view");
});

test("cancelConfirm returns to the page that was open, including the narrow list", () => {
  const wide = setup();
  wide.dialog.open("race");
  wide.dialog.showConfirm();
  wide.dialog.cancelConfirm();
  assert.equal(wide.dialog.page, "race");
  assert.equal(wide.root.getAttribute("data-confirm"), null);
  const narrow = setup({ narrow: true });
  narrow.dialog.open();
  narrow.dialog.showConfirm();
  narrow.dialog.cancelConfirm();
  assert.equal(narrow.dialog.page, null);
  assert.equal(narrow.stack.closeTop(), true);
  assert.equal(narrow.dialog.isOpen, false);
});

test("closing while confirming leaves nothing on the stack", () => {
  const { dialog, stack, root } = setup();
  dialog.open();
  dialog.showConfirm();
  dialog.close();
  assert.equal(stack.isOpen, false);
  assert.equal(root.getAttribute("data-confirm"), null);
});

test("dispose removes the media listener and element listeners", () => {
  const { dialog, matchNarrow, root } = setup();
  dialog.dispose();
  assert.equal(matchNarrow.handlers.size, 0);
  const all = [root, root.backdrop, root.back, root.closeButton, ...root.navs];
  assert.deepEqual(all.map((e) => e.listenerCount()), all.map(() => 0));
});

test("onPage reports page changes", () => {
  const { dialog, seen } = setup();
  dialog.open();
  dialog.open("view");
  dialog.close();
  assert.deepEqual(seen, ["overview", "view", null]);
});

test("a nav entry opens its page, back returns to the list, the backdrop closes", () => {
  const { dialog, root } = setup({ narrow: true });
  dialog.open();
  root.navs.find((n) => n.dataset.menuNav === "race").fire("click");
  assert.equal(dialog.page, "race");
  root.back.fire("click");
  assert.equal(dialog.page, null);
  root.backdrop.fire("click", { target: fakeEl() });
  assert.equal(dialog.isOpen, true);
  root.backdrop.fire("click");
  assert.equal(dialog.isOpen, false);
});

test("Tab cycles inside the dialog", () => {
  const { dialog, root, first, last } = setup();
  dialog.open();
  fakeEl.active = last;
  const forward = {};
  root.fire("keydown", { key: "Tab", shiftKey: false, ...forward });
  assert.equal(first.focused, 2);
  fakeEl.active = first;
  root.fire("keydown", { key: "Tab", shiftKey: true });
  assert.equal(last.focused, 1);
  fakeEl.active = fakeEl();
  const middle = {};
  root.fire("keydown", { key: "Tab", shiftKey: false, ...middle });
  assert.equal(first.focused, 2, "a Tab from the middle is left to the browser");
});
