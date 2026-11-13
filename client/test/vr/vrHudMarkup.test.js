import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = (name) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const ride = page("index.html");
const vr = page("vr.html");

const normalise = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").replace(/> </g, "><").trim();

/** The `<div class="…">` block with this class, up to its balanced closing tag. */
function block(html, className) {
  const start = html.search(new RegExp(`<div class="(?:[\\w-]+ )*${className}[ "]`));
  assert.notEqual(start, -1, `no .${className} block`);
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<(\/?)div\b/g)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return normalise(html.slice(start, start + tag.index + "</div>".length));
  }
  throw new Error(`.${className} is not closed`);
}

for (const className of ["hud-info", "layout-cockpit", "layout-broadcast", "layout-training", "layout-race"]) {
  test(`the VR page's HUD layouts match the ride screen's: ${className}`, () => {
    assert.equal(block(vr, className), block(ride, className));
  });
}

test("the VR page's HUD has no controls", () => {
  for (const control of ["pause-ride", "shift-up", "take-photo", "open-menu"]) {
    assert.ok(!vr.includes(`id="${control}"`), control);
  }
});

test("the VR page's ride section picks the layout like the ride screen", () => {
  assert.match(vr, /<section id="ride" class="ride" data-layout="cockpit"/);
});
