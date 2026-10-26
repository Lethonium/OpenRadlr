import { test } from "node:test";
import assert from "node:assert/strict";
import { VehicleView } from "../public/js/view/vehicleView.js";
import { vehicleErrorLine } from "../public/js/ride/vehicle.js";

/** Just enough DOM for the view: elements, text, hidden, events. */
class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.classList = { add: (c) => (this.className = `${this.className} ${c}`.trim()) };
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.checked = false;
    this._text = "";
  }

  set textContent(text) {
    this._text = String(text);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }

  append(...nodes) {
    for (const node of nodes) this.children.push(typeof node === "string" ? Object.assign(new FakeElement("#text", this.ownerDocument), { _text: node }) : node);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  fire(type) {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {} });
  }

  find(predicate, out = []) {
    if (predicate(this)) out.push(this);
    for (const child of this.children) child.find(predicate, out);
    return out;
  }
}

function setup(handlers = {}, options) {
  const doc = { createElement: (tag) => new FakeElement(tag, doc) };
  const root = new FakeElement("div", doc);
  return { root, view: new VehicleView(root, handlers, options) };
}

const byClass = (root, name) => root.find((e) => e.className.split(" ").includes(name));
const byText = (root, text) => root.find((e) => e.children.length === 0 && e._text === text)[0];

const state = {
  id: 1,
  code: "K7M2QX",
  kind: "beer_bike",
  captain: 10,
  bots: true,
  seats: [
    { rider_id: 10, name: "Anna", is_bot: false, power: 200, share: 0.4 },
    { rider_id: 11, name: "Ben", is_bot: false, power: 150, share: 0.3 },
    null,
    { rider_id: 12, name: "Bot 3", is_bot: true, power: 100, share: 0.2 },
    { rider_id: 13, name: "Chris", is_bot: false, power: 50, share: 0.1 },
  ],
};

test("renders every seat, the free one, the captain line and the code", () => {
  const { root, view } = setup();
  view.update(state, 11);
  assert.equal(root.hidden, false);
  assert.equal(byClass(root, "vehicle-seat").length, 5);
  assert.equal(byClass(root, "free").length, 1);
  assert.ok(byText(root, "Free seat"));
  assert.equal(byClass(root, "vehicle-captain")[0].textContent, "Captain: Anna steers");
  assert.equal(byClass(root, "vehicle-code")[0].textContent, "K7M2QX");
  assert.equal(byClass(root, "vehicle-title")[0].textContent, "Anna's beer bike");
  const marks = byClass(root, "vehicle-seat-marks").map((e) => e.textContent);
  assert.deepEqual(marks, ["", "you", "bot", ""]);
  assert.equal(byClass(root, "vehicle-share-fill")[0].style.width, "40%");
});

test("Copy writes the code to the clipboard", () => {
  const written = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => written.push(t) } }, configurable: true });
  const { root, view } = setup();
  view.update(state, 10);
  byText(root, "Copy").fire("click");
  assert.deepEqual(written, ["K7M2QX"]);
});

test("the board form sends the cleaned code or shows why not", () => {
  const boarded = [];
  const { root, view } = setup({ onBoard: (code) => boarded.push(code) });
  view.showBoard();
  assert.equal(root.hidden, false);
  const [input] = root.find((e) => e.attributes["aria-label"] === "Vehicle code");
  const [form] = byClass(root, "vehicle-form").filter((f) => f.find((e) => e.tagName === "INPUT").length > 0 && !f.find((e) => e.tagName === "SELECT").length);
  const error = byClass(root, "error")[0];
  input.value = " k7m 2qx ";
  form.fire("submit");
  assert.deepEqual(boarded, ["K7M2QX"]);
  assert.equal(error.textContent, "");
  input.value = "K7M0QX";
  form.fire("submit");
  assert.deepEqual(boarded, ["K7M2QX"]);
  assert.equal(error.textContent, "Codes don't use 0, O, 1 or I");
});

test("the create form offers beer bike seats 5, 7 or 9 and sends the choice", () => {
  const created = [];
  const { root, view } = setup({ onCreate: (v) => created.push(v) });
  view.showCreate();
  const [kind, seats] = root.find((e) => e.tagName === "SELECT");
  assert.deepEqual(seats.children.map((o) => o.value), ["2"]);
  kind.value = "beer_bike";
  kind.fire("change");
  assert.deepEqual(seats.children.map((o) => o.value), ["5", "7", "9"]);
  seats.value = "7";
  assert.ok(byText(root, " Bots fill free seats"));
  byClass(root, "vehicle-form")[0].fire("submit");
  assert.deepEqual(created, [{ kind: "beer_bike", seats: 7, bots: true }]);
});

test("leave calls back and null hides the panel", () => {
  let left = 0;
  const { root, view } = setup({ onLeave: () => left++ });
  view.update(state, 10);
  byText(root, "Leave").fire("click");
  assert.equal(left, 1);
  view.update(null, 10);
  assert.equal(root.hidden, true);
});

test("the compact view shows seats without code or Leave", () => {
  const { root, view } = setup({}, { compact: true });
  view.update(state, 10);
  assert.equal(root.hidden, false);
  assert.equal(byClass(root, "vehicle-code").length, 0);
  assert.equal(byText(root, "Leave"), undefined);
  view.update(null, 10);
  assert.equal(root.hidden, true);
});

test("friendly lines for the vehicle error codes", () => {
  assert.equal(vehicleErrorLine("vehicle_full"), "Vehicle full");
  assert.equal(vehicleErrorLine("vehicle_rate_limited"), "Too many tries, wait a moment");
  for (const code of ["unknown_vehicle", "vehicle_elsewhere", "not_captain", "in_event", "invalid_vehicle", "already_aboard"]) {
    assert.ok(vehicleErrorLine(code));
  }
  assert.equal(vehicleErrorLine("nope"), null);
});

test("a paddle rider's seat gets the paddle mark", () => {
  const { root, view } = setup();
  view.update(state, 10, [{ id: 11, device: "paddle" }, { id: 10 }]);
  const marks = byClass(root, "vehicle-seat-marks").map((e) => e.textContent);
  assert.deepEqual(marks, ["you", "paddle", "bot", ""]);
});
