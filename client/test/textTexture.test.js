/** Text painted into a texture from the pixel font: inked in the middle, background at the edges, no throwing. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { textTexture } from "../public/js/view3d/assets/textTexture.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const colours = { background: [1, 1, 1], ink: [0, 0, 0], width: 128, height: 32 };
const pixel = (texture, x, y) => Array.from(texture.image.data.slice((y * texture.image.width + x) * 4, (y * texture.image.width + x) * 4 + 3));
const isInk = (rgb) => rgb.every((v) => v < 128);
const isBackground = (rgb) => rgb.every((v) => v > 127);

test("the text is inked in the middle and the edges stay background", () => {
  const tracker = createTracker();
  const texture = textTexture("KOM", colours, (resource) => tracker.track(resource));
  let ink = 0;
  for (let x = 0; x < 128; x += 1) if (isInk(pixel(texture, x, 16))) ink += 1;
  assert.ok(ink > 0, "ink on the centre row");
  for (let y = 0; y < 32; y += 1) {
    assert.ok(isBackground(pixel(texture, 0, y)), `column 0 at ${y}`);
    assert.ok(isBackground(pixel(texture, 127, y)), `column 127 at ${y}`);
  }
});

test("unknown characters do not throw", () => {
  assert.doesNotThrow(() => textTexture("Ü✓", colours, (resource) => resource));
});

test("lowercase reads as uppercase", () => {
  const a = textTexture("kom", colours, (r) => r).image.data;
  const b = textTexture("KOM", colours, (r) => r).image.data;
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("accented letters paint as their base letter", () => {
  const a = textTexture("Café", colours, (r) => r).image.data;
  const b = textTexture("CAFE", colours, (r) => r).image.data;
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("every letter A to Z has a glyph of the font's size", async () => {
  const { GLYPHS, COLS, ROWS } = await import("../public/js/view3d/assets/pixelFont.js");
  for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ.-'!&·") {
    assert.ok(GLYPHS[char], `glyph for ${char}`);
    assert.equal(GLYPHS[char].length, ROWS, char);
    for (const row of GLYPHS[char]) assert.equal(row.length, COLS, char);
  }
});
