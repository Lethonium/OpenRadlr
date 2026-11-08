import { test } from "node:test";
import assert from "node:assert/strict";
import { isRemote, riderLabel } from "../public/js/view/remoteRiders.js";
import { renderRiderList } from "../public/js/view/panels.js";
import { riderLabelElement } from "../public/js/view3d/view3d.js";
import { riderColor } from "../public/js/view/canvas.js";
import { t } from "../public/js/i18n/i18n.js";

/** Just enough DOM: elements keep their children and text, and never parse markup. */
class FakeElement {
  children = [];
  className = "";
  textContent = "";
  constructor(tag) {
    this.tag = tag;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  get classList() {
    return { add: (name) => (this.className = `${this.className} ${name}`.trim()) };
  }
  /** Every element in this subtree, itself included. */
  all() {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

function withFakeDocument(run) {
  const before = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  try {
    return run();
  } finally {
    globalThis.document = before;
  }
}

const ben = { id: 0xf000_0000, name: "Ben", app: "incyclist", is_bot: false, power: 180 };
const anna = { id: 3, name: "Anna", is_bot: false, power: 150 };
const hostile = { ...ben, name: "<img src=x onerror=alert(1)>" };

test("remote riders are labelled with their app", () => {
  assert.equal(isRemote(ben), true);
  assert.equal(riderLabel(ben, t), "Ben · incyclist");
});

test("local riders keep their label", () => {
  assert.equal(isRemote(anna), false);
  assert.equal(riderLabel(anna, t), "Anna");
  assert.equal(riderLabel({ id: 4, name: "Bo", is_bot: true }, t), "Bo (bot)");
});

test("remote riders get their own colour", () => {
  const colors = { me: "me", human: "human", bot: "bot", remote: "remote" };
  assert.equal(riderColor(ben, 1, colors), "remote");
  assert.equal(riderColor(anna, 1, colors), "human");
  assert.equal(riderColor(ben, ben.id, colors), "me");
});

test("a remote name with markup stays text in the panel row", () =>
  withFakeDocument(() => {
    const list = new FakeElement("ul");
    renderRiderList(list, [{ rider: hostile, gap: 5, routeName: "" }], 1);
    const nodes = list.all();
    assert.equal(nodes.filter((node) => node.tag === "img").length, 0);
    assert.ok(nodes.some((node) => node.textContent === "<img src=x onerror=alert(1)>"));
    assert.ok(nodes.some((node) => node.className.includes("badge") && node.textContent === "incyclist"));
  }));

test("a remote name with markup stays text in the 3D label", () =>
  withFakeDocument(() => {
    const label = riderLabelElement(hostile, 1);
    const nodes = label.all();
    assert.equal(nodes.filter((node) => node.tag === "img").length, 0);
    assert.ok(nodes.some((node) => node.textContent === "<img src=x onerror=alert(1)>"));
    assert.ok(nodes.some((node) => node.className.includes("badge") && node.textContent === "incyclist"));
  }));
