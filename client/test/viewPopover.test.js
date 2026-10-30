import { test } from "node:test";
import assert from "node:assert/strict";
import { createViewPopover } from "../public/js/view/viewPopover.js";
import { createPanelStack } from "../public/js/input/panelStack.js";
import { viewControls } from "../public/js/view/viewControls.js";

function fakeEl(tag = "div") {
  const listeners = new Map();
  const attrs = new Map();
  const el = {
    tagName: tag.toUpperCase(), dataset: {}, hidden: false, children: [], parent: null, textContent: "", innerHTML: "", className: "",
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    append(...kids) { for (const kid of kids) { kid.parent = el; el.children.push(kid); } },
    replaceChildren(...kids) { el.children = []; el.append(...kids); },
    contains(other) { for (let node = other; node; node = node.parent) if (node === el) return true; return false; },
    focus() {},
    fire(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ target: el, ...event }); },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
    all() { return el.children.flatMap((kid) => [kid, ...kid.all()]); },
  };
  return el;
}

function fakeDoc() {
  const doc = fakeEl("document");
  doc.createElement = (tag) => fakeEl(tag);
  doc.body = fakeEl("body");
  return doc;
}

const fakeNarrow = (matches) => ({ matches, addEventListener() {}, removeEventListener() {} });

function setup({ studio = false } = {}) {
  const doc = fakeDoc();
  const root = fakeEl();
  const button = fakeEl("button");
  const stack = createPanelStack();
  const picks = [];
  const popover = createViewPopover({
    root, button, controls: viewControls({ studio }), stack, matchNarrow: fakeNarrow(false),
    onPick: (kind, id) => picks.push([kind, id]), doc,
  });
  const option = (kind, id) => root.all().find((el) => el.dataset.kind === kind && el.dataset.id === id);
  return { doc, root, button, stack, picks, popover, option };
}

test("picking calls onPick and keeps the popover open", () => {
  const { popover, picks, option } = setup();
  popover.open();
  option("camera", "drone").fire("click");
  option("layout", "race").fire("click");
  assert.deepEqual({ picks, open: popover.isOpen }, { picks: [["camera", "drone"], ["layout", "race"]], open: true });
});

test("a tap outside and closing through the stack close it", () => {
  const { popover, doc, stack, root } = setup();
  popover.open();
  const inside = root.all()[0];
  doc.fire("pointerdown", { target: inside });
  const afterInside = popover.isOpen;
  doc.fire("pointerdown", { target: doc.body });
  const afterOutside = popover.isOpen;
  popover.open();
  stack.closeTop();
  assert.deepEqual([afterInside, afterOutside, popover.isOpen, root.hidden], [true, false, false, true]);
});

test("opening the popover pushes it above the dialog", () => {
  const { popover, stack } = setup();
  let dialogOpen = true;
  stack.push({ close: () => { dialogOpen = false; } });
  popover.open();
  stack.closeTop();
  assert.deepEqual([popover.isOpen, dialogOpen], [false, true]);
});

test("dispose removes the document listener", () => {
  const { popover, doc } = setup();
  popover.open();
  popover.dispose();
  assert.equal(doc.listenerCount("pointerdown"), 0);
});

test("the button toggles the popover", () => {
  const { popover, button } = setup();
  button.fire("click");
  const opened = popover.isOpen;
  button.fire("click");
  assert.deepEqual([opened, popover.isOpen, button.getAttribute("aria-expanded")], [true, false, "false"]);
});

test("the studio popover has no layout row", () => {
  const { root, option } = setup({ studio: true });
  assert.deepEqual([option("camera", "coach") !== undefined, root.all().some((el) => el.dataset.kind === "layout")], [true, false]);
});

test("the current choices show as pressed", () => {
  const doc = fakeDoc();
  const root = fakeEl();
  const popover = createViewPopover({
    root, button: fakeEl("button"), controls: viewControls({ studio: false }), stack: createPanelStack(),
    matchNarrow: fakeNarrow(false), onPick() {}, doc, selected: () => ({ camera: "side", layout: "auto", mode: "3d", time: "dusk" }),
  });
  popover.open();
  const pressed = root.all().filter((el) => el.getAttribute("aria-pressed") === "true").map((el) => `${el.dataset.kind}:${el.dataset.id}`);
  assert.deepEqual(pressed, ["camera:side", "layout:auto", "mode:3d", "time:dusk"]);
});

test("a narrow screen shows it as a bottom sheet", () => {
  const doc = fakeDoc();
  const root = fakeEl();
  const popover = createViewPopover({
    root, button: fakeEl("button"), controls: viewControls({ studio: false }), stack: createPanelStack(),
    matchNarrow: fakeNarrow(true), onPick() {}, doc,
  });
  popover.open();
  assert.equal(root.getAttribute("data-sheet"), "true");
});
