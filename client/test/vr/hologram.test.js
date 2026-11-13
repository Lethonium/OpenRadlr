import { test } from "node:test";
import assert from "node:assert/strict";
import { Hologram, hologramLayout } from "../../public/js/vr/hologram.js";
import { identity } from "../../public/js/view3d/math.js";
import { GLYPHS } from "../../public/js/view3d/pixelFont.js";
import { ZONE_COLORS } from "../../public/js/view/workoutView.js";

const values = { power: 250, zone: "Z3", cadence: 90, hr: "–", speed: "36.0", grade: "2.3 %", target: "–" };
const cell = (layout, text) => layout.cells.find((c) => c.text === text);
const workout = { workout: { segments: [{ durationS: 60 }, { durationS: 120 }] }, state: { index: 1, segmentRemainingS: 95 } };

test("power is big and in the centre", () => {
  const power = cell(hologramLayout(values, {}), "250");
  assert.equal(power.size, "big");
  assert.equal(power.at[0], 0);
});

test("power takes its zone colour", () => {
  const power = cell(hologramLayout(values, {}), "250");
  const hex = ZONE_COLORS[2];
  assert.deepEqual(
    power.color.map((v) => Math.round(v * 255)),
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
  );
});

test("heart rate shows a dash until known", () => {
  const hr = hologramLayout(values, {}).cells.filter((c) => c.at[0] > 0.05 && c.size === "small").map((c) => c.text);
  assert.ok(hr.includes("-"));
});

test("a workout adds the target row", () => {
  const plain = hologramLayout(values, {}).cells.length;
  const layout = hologramLayout({ ...values, target: 280 }, { workout });
  assert.ok(layout.cells.length > plain);
  assert.ok(cell(layout, "280 W"));
  assert.ok(cell(layout, "2/2"));
  assert.ok(cell(layout, "1:35"));
});

test("every character is in the font", () => {
  const layout = hologramLayout({ ...values, target: 280, grade: "−2.3 %" }, { workout });
  for (const { text } of layout.cells) for (const char of text) assert.ok(GLYPHS[char], `glyph ${char} in "${text}"`);
});

class StubRenderer {
  uploaded = [];
  disposed = [];
  bright = [];
  transparent = [];
  upload(mesh) {
    const handle = { mesh };
    this.uploaded.push(handle);
    return handle;
  }
  dispose(handle) {
    this.disposed.push(handle);
  }
  drawBright(handle, model, unlit) {
    this.bright.push({ handle, model, unlit });
  }
  drawTransparent(handle, model, options) {
    this.transparent.push({ handle, model, options });
  }
}

test("update with the same text uploads nothing", () => {
  const renderer = new StubRenderer();
  const hologram = new Hologram(renderer);
  hologram.update(values, {});
  const uploads = renderer.uploaded.length;
  hologram.update({ ...values }, {});
  assert.equal(renderer.uploaded.length, uploads);
});

test("update with new text replaces the mesh and disposes the old one", () => {
  const renderer = new StubRenderer();
  const hologram = new Hologram(renderer);
  hologram.update(values, {});
  const old = renderer.uploaded.at(-1);
  hologram.update({ ...values, power: 260 }, {});
  assert.notEqual(renderer.uploaded.at(-1), old);
  assert.ok(renderer.disposed.includes(old));
});

test("update rebuilds at most four times a second", () => {
  const renderer = new StubRenderer();
  const hologram = new Hologram(renderer);
  hologram.update(values, {}, 10);
  const uploads = renderer.uploaded.length;
  hologram.update({ ...values, power: 260 }, {}, 10.1);
  assert.equal(renderer.uploaded.length, uploads, "too soon");
  hologram.update({ ...values, power: 260 }, {}, 10.3);
  assert.equal(renderer.uploaded.length, uploads + 1);
});

test("draw places the panel above the bars", () => {
  const renderer = new StubRenderer();
  const hologram = new Hologram(renderer);
  hologram.update(values, {});
  hologram.draw(identity());
  const lean = (-49 * Math.PI) / 180;
  const [x, y, z] = renderer.transparent[0].model.slice(12, 15);
  // Bar height + gap, then half the panel up its lean (top tipped away by 49°).
  const expected = [0, 0.99 + 0.04 + 0.075 * Math.cos(lean), -0.46 + 0.075 * Math.sin(lean)];
  [x, y, z].forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-3, `${[x, y, z]} != ${expected}`));
});

test("draw uses one transparent and two bright calls", () => {
  const renderer = new StubRenderer();
  const hologram = new Hologram(renderer);
  hologram.update(values, {});
  hologram.draw(identity());
  assert.equal(renderer.transparent.length, 1);
  assert.equal(renderer.bright.length, 2);
  assert.equal(renderer.transparent[0].options.alpha, 0.18);
});

test("draw before any update draws nothing", () => {
  const renderer = new StubRenderer();
  new Hologram(renderer).draw(identity());
  assert.equal(renderer.transparent.length + renderer.bright.length, 0);
});

test("dispose frees every mesh", () => {
  const renderer = new StubRenderer();
  const hologram = new Hologram(renderer);
  hologram.update(values, {});
  hologram.dispose();
  assert.equal(renderer.disposed.length, renderer.uploaded.length);
});
