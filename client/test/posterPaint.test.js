import { test } from "node:test";
import assert from "node:assert/strict";
import { setLocale } from "../public/js/i18n/i18n.js";
import { POSTERS } from "../public/js/view3d/posters/lines.js";
import { drawArt } from "../public/js/view3d/posters/art.js";
import { paintAtlas, paintPoster, slotUv } from "../public/js/view3d/posters/paint.js";
import en from "../public/js/i18n/en.js";

/** A recording 2D context: any method call is logged, properties are plain; measureText is 0.6 x font px per char. */
function fakeContext() {
  const calls = [];
  const state = { fillStyle: "#000", font: "10px system-ui" };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === "calls") return calls;
      if (prop === "measureText") {
        return (text) => ({ width: 0.6 * Number.parseFloat(String(target.font).match(/([\d.]+)px/)[1]) * text.length });
      }
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push({ name: String(prop), args, fillStyle: target.fillStyle, font: target.font });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return ctx;
}

const SIZE = { width: 1024, height: 512 };
const texts = (ctx) => ctx.calls.filter((c) => c.name === "fillText");
const joined = (ctx) => texts(ctx).map((c) => c.args[0]).join(" ");
const poster = (id) => ({ type: "default", id });

test("an upload poster paints the red bar over the bottom 8 percent with 'Your upload'", () => {
  setLocale("en");
  const ctx = fakeContext();
  paintPoster(ctx, { type: "upload", image: {}, text: "Mine" }, SIZE);
  const bar = ctx.calls.find((c) => c.name === "fillRect" && c.fillStyle === "#d62828");
  assert.ok(bar);
  assert.equal(bar.args[1], SIZE.height * 0.92);
  assert.equal(bar.args[3], SIZE.height * 0.08);
  assert.match(joined(ctx), /Your upload/);
});

test("an upload poster draws its picture covering the whole poster", () => {
  const ctx = fakeContext();
  const image = { width: 2000, height: 500 };
  paintPoster(ctx, { type: "upload", image }, SIZE);
  const draw = ctx.calls.find((c) => c.name === "drawImage");
  assert.equal(draw.args[0], image);
  assert.equal(draw.args.length, 9);
  const [, sx, sy, sw, sh] = draw.args;
  assert.ok(sx >= 0 && sy >= 0 && sx + sw <= 2000 && sy + sh <= 500);
  assert.equal(sw / sh, 2);
});

test("a default poster paints its line and no upload marker", () => {
  setLocale("en");
  const ctx = fakeContext();
  paintPoster(ctx, poster("painRadler"), SIZE);
  assert.equal(joined(ctx), en["boards.line.painRadler"]);
  assert.equal(
    ctx.calls.some((c) => c.name === "fillRect" && c.fillStyle === "#d62828"),
    false,
  );
});

test("default posters take the colour of their kind", () => {
  const colourOf = (id) => {
    const ctx = fakeContext();
    paintPoster(ctx, poster(id), SIZE);
    return ctx.calls.find((c) => c.name === "fillRect").fillStyle;
  };
  assert.equal(colourOf("halfLegend"), "#ffd23f");
  assert.equal(colourOf("squeeze"), "#1b998b");
  assert.equal(colourOf("emptyGlass"), "#f46036");
});

test("a goal poster paints its text on deep blue", () => {
  const ctx = fakeContext();
  paintPoster(ctx, { type: "goal", text: "42 km to this week's step" }, SIZE);
  assert.equal(joined(ctx), "42 km to this week's step");
  assert.equal(ctx.calls.find((c) => c.name === "fillRect").fillStyle, "#22356f");
});

test("long text wraps to at most 3 lines and never draws wider than the text box", () => {
  const long = "word ".repeat(60).trim();
  const ctx = fakeContext();
  paintPoster(ctx, { type: "goal", text: long }, SIZE);
  const lines = texts(ctx);
  assert.ok(lines.length >= 1 && lines.length <= 3);
  for (const line of lines) {
    const px = Number.parseFloat(line.font.match(/([\d.]+)px/)[1]);
    assert.ok(0.6 * px * line.args[0].length <= SIZE.width, `${line.args[0]} too wide`);
  }
});

test("every default poster paints its text without throwing", () => {
  for (const entry of POSTERS) {
    const ctx = fakeContext();
    paintPoster(ctx, poster(entry.id), SIZE);
    assert.equal(joined(ctx), en[`boards.line.${entry.id}`], entry.id);
  }
});

test("every art id draws shapes inside its square", () => {
  for (const art of new Set(POSTERS.map((p) => p.art))) {
    const ctx = fakeContext();
    drawArt(ctx, art, { x: 10, y: 20, size: 100 });
    assert.ok(ctx.calls.length > 3, art);
  }
});

test("slotUv maps the 2 x 4 grid with row 0 at the top", () => {
  assert.deepEqual(slotUv(0), [0, 0.75, 0.5, 1]);
  assert.deepEqual(slotUv(3), [0.5, 0.5, 1, 0.75]);
});

test("paintAtlas paints every slot into its own cell", () => {
  const atlasCtx = fakeContext();
  const made = [];
  const createCanvas = (width, height) => {
    const canvas = { width, height, getContext: () => atlasCtx };
    made.push(canvas);
    return canvas;
  };
  const slots = [poster("halfLegend"), poster("squeeze"), { type: "upload", id: "u1" }];
  const uploadsById = new Map([["u1", { image: { width: 100, height: 50 }, text: "" }]]);
  const atlas = paintAtlas(createCanvas, slots, { slotWidth: 512, slotHeight: 256, uploadsById });
  assert.equal(atlas, made[0]);
  assert.equal(atlas.width, 1024);
  assert.equal(atlas.height, 1024);
  const clips = atlasCtx.calls.filter((c) => c.name === "rect").map((c) => c.args.join(","));
  assert.deepEqual(clips, ["0,0,512,256", "0,0,512,256", "0,0,512,256"]);
  const cellOrigins = atlasCtx.calls
    .filter((c, i, all) => c.name === "translate" && all[i + 1]?.name === "beginPath" && all[i + 2]?.name === "rect")
    .map((c) => c.args.join(","));
  assert.deepEqual(cellOrigins, ["0,0", "512,0", "0,256"]);
});
