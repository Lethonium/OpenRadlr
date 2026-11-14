import { test } from "node:test";
import assert from "node:assert/strict";
import { GLYPHS } from "../public/js/view3d/pixelFont.js";

const NEEDED = [..."BCGHWZ/.:-·%0123456789"];

test("the glyphs the hologram needs exist and are 5 × 7", () => {
  for (const char of NEEDED) {
    const rows = GLYPHS[char];
    assert.ok(rows, `glyph ${char}`);
    assert.equal(rows.length, 7, `${char} rows`);
    assert.ok(
      rows.every((row) => row.length === 5),
      `${char} columns`,
    );
  }
});
