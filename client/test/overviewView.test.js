import { test } from "node:test";
import assert from "node:assert/strict";
import { RideRecorder } from "../public/js/ride/rideRecorder.js";
import { createOverviewView, overviewActive } from "../public/js/view/overviewView.js";

function fakeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(), children: [], textContent: "", className: "", hidden: false,
    append(...kids) { el.children.push(...kids); },
    replaceChildren(...kids) { el.children = [...kids]; },
    text() { return [el.textContent, ...el.children.map((kid) => kid.text())].join(" "); },
  };
  return el;
}

const fakeDoc = () => ({ createElement: (tag) => fakeEl(tag) });

/** A canvas whose 2D context accepts every call and counts strokes. */
function fakeCanvas() {
  const ctx = new Proxy({ strokes: 0 }, {
    get: (target, key) => (key in target ? target[key] : key === "stroke" ? () => { target.strokes += 1; } : () => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  return { clientWidth: 300, clientHeight: 120, width: 0, height: 0, getContext: () => ctx, ctx };
}

/** Interval fake that records the delay and fires on demand. */
function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setInterval: (fn, ms) => { timers.set(nextId, { fn, ms }); return nextId++; },
    clearInterval: (id) => timers.delete(id),
    fire: () => [...timers.values()].forEach(({ fn }) => fn()),
    get delays() { return [...timers.values()].map(({ ms }) => ms); },
  };
}

const T0 = Date.UTC(2026, 9, 30, 10, 0, 0);
const steadyRide = (watts, seconds) =>
  Array.from({ length: seconds }, (_, i) => ({ t: T0 + i * 1000, power: watts, heartRate: null, distance: i * 10, elevation: i * 0.1, speed: 10, cadence: 90 }));

function recording(samples, live = { power: 210, speed: 9.5, grade: 3.2 }) {
  const recorder = RideRecorder.from({ samples, pauses: [] });
  return { summary: recorder.summary(), samples, pauses: [], ftp: 200, live };
}

const tagged = {
  duration: (s) => `D${s}`,
  distance: (m) => `M${m}`,
  elevation: (m) => `E${m}`,
  power: (w) => `P${w}`,
  speed: (v) => `S${v}`,
  grade: (g) => `G${g}`,
  number: (v) => `N${v}`,
};

function setup({ samples = steadyRide(200, 61), live } = {}) {
  const root = fakeEl();
  const strip = fakeEl();
  const canvas = fakeCanvas();
  const timers = fakeTimers();
  let reads = 0;
  const view = createOverviewView({
    root, canvas, strip, format: tagged, doc: fakeDoc(), colors: () => ({ text: "#fff", muted: "#888", grid: "#333" }),
    read: () => { reads += 1; return recording(samples, live); },
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
  });
  return { view, root, strip, canvas, timers, reads: () => reads };
}

test("show renders immediately and then once a second", () => {
  const { view, timers, reads } = setup();
  view.show();
  const first = reads();
  timers.fire();
  assert.deepEqual({ first, after: reads(), delays: timers.delays }, { first: 1, after: 2, delays: [1000] });
});

test("hide stops the timer", () => {
  const { view, timers } = setup();
  view.show();
  view.hide();
  assert.equal(timers.delays.length, 0);
});

test("no timer runs while hidden", () => {
  const { timers, reads } = setup();
  assert.deepEqual({ timers: timers.delays.length, reads: reads() }, { timers: 0, reads: 0 });
});

test("showing twice keeps one timer", () => {
  const { view, timers } = setup();
  view.show();
  view.show();
  assert.equal(timers.delays.length, 1);
});

test("dispose stops the timer", () => {
  const { view, timers } = setup();
  view.show();
  view.dispose();
  assert.equal(timers.delays.length, 0);
});

test("figures use the injected formatters", () => {
  const { view, root } = setup();
  view.show();
  const text = root.text();
  for (const figure of ["D60", "M600", "E6", "P200", "N12"]) assert.ok(text.includes(figure), `${figure} in ${text}`);
});

test("an empty ride shows dashes, not NaN", () => {
  const { view, root } = setup({ samples: [] });
  view.show();
  const text = root.text();
  assert.ok(!/NaN|undefined/.test(text) && text.includes("–"), text);
});

test("the strip shows live power speed and grade", () => {
  const { view, strip } = setup();
  view.show();
  assert.deepEqual(strip.children.map((item) => item.textContent), ["P210", "S9.5", "G3.2"]);
});

test("the chart draws the power line", () => {
  const { view, canvas } = setup();
  view.show();
  assert.ok(canvas.ctx.strokes > 0);
});

test("it runs on the Overview page, and on a phone whenever the menu is open", () => {
  const cases = [
    overviewActive({ open: true, page: "overview", narrow: false }),
    overviewActive({ open: true, page: "view", narrow: false }),
    overviewActive({ open: true, page: null, narrow: true }),
    overviewActive({ open: false, page: null, narrow: true }),
  ];
  assert.deepEqual(cases, [true, false, true, false]);
});

test("weighted power shows a dash until there is half a minute of riding", () => {
  const { view, root } = setup({ samples: steadyRide(200, 10) });
  view.show();
  const row = root.children[0].children.find((item) => item.children[0].textContent === "Weighted power");
  assert.equal(row.children[1].textContent, "–");
});
