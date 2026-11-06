import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setLocale, t } from "../public/js/i18n/i18n.js";
import { EXERCISES, planDuration } from "../public/js/workout/plan.js";
import { PRESETS } from "../public/js/workout/presets.js";
import { EXERCISE_COLORS, blockStrip, workoutCard, renderWorkoutCards } from "../public/js/view/workoutCards.js";

const [fullBody, core, tabata] = PRESETS;

function fakeEl(tag = "div") {
  const listeners = new Map();
  const attrs = new Map();
  const el = {
    tagName: tag.toUpperCase(), style: {}, dataset: {}, children: [], parent: null, textContent: "", className: "", title: "", tabIndex: 0,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    append(...kids) { for (const kid of kids) { kid.parent = el; el.children.push(kid); } },
    replaceChildren(...kids) { el.children = []; el.append(...kids); },
    contains(other) { for (let node = other; node; node = node.parent) if (node === el) return true; return false; },
    focus() { doc.activeElement = el; },
    fire(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn({ target: el, preventDefault() {}, stopPropagation() {}, ...event }); },
    all() { return el.children.flatMap((kid) => [kid, ...kid.all()]); },
  };
  return el;
}

const doc = fakeEl("document");
doc.createElement = (tag) => fakeEl(tag);
let hint;

beforeEach(() => {
  hint = fakeEl("p");
  doc.getElementById = (id) => (id === "workout-hint" ? hint : null);
  globalThis.document = doc;
});
afterEach(() => {
  setLocale("en");
  delete globalThis.document;
});

function draw(options = {}) {
  const container = fakeEl();
  const calls = { select: [], figure: [] };
  const render = (extra = {}) =>
    renderWorkoutCards(container, PRESETS, {
      selectedId: "full-body", cafeNames: new Map([["valley-cafe", "Valley Café"]]), figureIndex: null,
      onSelect: (id) => calls.select.push(id), onFigure: (id, index) => calls.figure.push([id, index]),
      ...options, ...extra,
    });
  render();
  const radios = () => container.all().filter((el) => el.getAttribute("role") === "radio");
  const chips = () => container.all().filter((el) => el.dataset.figure !== undefined);
  return { container, calls, render, radios, chips };
}

test("the block strip has one segment per block without the get-ready rest", () => {
  const strip = blockStrip(tabata);
  assert.equal(strip.length, 16);
  assert.ok(Math.abs(strip.reduce((sum, s) => sum + s.fraction, 0) - 1) < 1e-9);
  strip.forEach((segment, i) => assert.equal(segment.kind, i % 2 === 0 ? "exercise" : "rest"));
  assert.deepEqual(strip[0], { fraction: 20 / planDuration(tabata), kind: "exercise", exercise: "squats", label: "Squats", seconds: 20 });
  assert.equal(strip[1].exercise, null);
  assert.equal(strip[1].label, "Rest");
});

test("a card names its tag, café, length and figures in order", () => {
  const card = workoutCard(fullBody, { cafeName: "Valley Café" });
  assert.equal(card.id, "full-body");
  assert.equal(card.tag, t("workout.category.fullBody"));
  assert.equal(card.cafe, "Valley Café");
  assert.equal(card.minutes, 12);
  assert.deepEqual(card.figures.map((f) => f.exercise), ["squats", "situps", "pushups", "jumping_jacks", "plank", "burpees"]);
  for (const figure of card.figures) assert.equal(figure.color, EXERCISE_COLORS[figure.exercise]);
  assert.equal(card.figures[0].label, "Squats");
});

test("a card without a known café has an empty café line", () => {
  assert.equal(workoutCard(core, {}).cafe, "");
});

test("every exercise has a colour", () => {
  for (const key of Object.keys(EXERCISES)) assert.match(EXERCISE_COLORS[key], /\S/);
});

test("the selected card is checked and the only one with figure chips", () => {
  const { radios, chips, render } = draw();
  render({ selectedId: "core" });
  assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.equal(chips().length, 3);
});

test("a saved workout that no longer exists selects the first card", () => {
  const { radios } = draw({ selectedId: "gone" });
  assert.deepEqual(radios().map((r) => r.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.equal(draw({ selectedId: null }).radios()[0].getAttribute("aria-checked"), "true");
});

test("cards show the name, tag, café and minutes as text", () => {
  const { container } = draw();
  const texts = container.all().map((el) => el.textContent);
  for (const text of ["Full body", "12 min · Valley Café"]) assert.ok(texts.includes(text), text);
});

test("clicking a card selects it; arrow keys move in preset order and wrap", () => {
  const { radios, calls } = draw({ selectedId: "full-body" });
  radios()[2].fire("click");
  radios()[0].fire("keydown", { key: "ArrowRight" });
  radios()[0].fire("keydown", { key: "ArrowLeft" });
  radios()[1].fire("keydown", { key: "ArrowDown" });
  assert.deepEqual(calls.select, ["tabata", "core", "tabata", "tabata"]);
});

test("only the selected card is in the tab order", () => {
  const { radios } = draw({ selectedId: "core" });
  assert.deepEqual(radios().map((r) => r.tabIndex), [-1, 0, -1]);
});

test("a figure chip flies to its statue; the pressed chip goes back", () => {
  const { chips, calls, render } = draw();
  chips()[1].fire("click");
  assert.deepEqual(calls.figure, [["full-body", 1]]);
  render({ figureIndex: 1 });
  assert.deepEqual(chips().map((c) => c.getAttribute("aria-pressed")), ["false", "true", "false", "false", "false", "false"]);
  chips()[1].fire("click");
  assert.deepEqual(calls.figure[1], ["full-body", null]);
});

test("tapping a strip segment writes its label into the hint", () => {
  const { container } = draw();
  const segment = container.all().find((el) => el.dataset.segment === "0");
  assert.equal(segment.getAttribute("aria-label"), "Squats 40 s");
  assert.equal(segment.title, "Squats 40 s");
  segment.fire("click");
  assert.equal(hint.textContent, "Squats 40 s");
});

test("the language switch re-renders the texts and the selection stays", () => {
  const { radios, render, container } = draw({ selectedId: "core" });
  setLocale("de");
  render({ selectedId: "core" });
  const texts = container.all().map((el) => el.textContent);
  assert.ok(texts.includes(t("workout.category.core")));
  assert.notEqual(t("workout.category.core"), "Core");
  assert.ok(texts.includes("Kniebeugen") || texts.includes(EXERCISES.situps.name));
  assert.equal(radios()[1].getAttribute("aria-checked"), "true");
});
