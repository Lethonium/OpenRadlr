import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { BANNERS, ARCH_TEXT, bannerSpots, buildBanners } from "../public/js/view3d/banners.js";
import { GLYPHS, pixelText, textWidth } from "../public/js/view3d/pixelFont.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { buildArches, roadFrame } from "../public/js/view3d/world.js";

// --- pixel font -------------------------------------------------------------------

test("every glyph is 5 pixels wide and 7 high", () => {
  for (const [char, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, 7, `${char} rows`);
    for (const row of rows) assert.equal(row.length, 5, `${char}: "${row}"`);
  }
});

test("every banner and arch text can be written", () => {
  const texts = [...Object.values(ARCH_TEXT), ...Object.values(BANNERS.text)];
  for (const text of texts) for (const char of text) assert.ok(GLYPHS[char], `no glyph for "${char}" in "${text}"`);
});

test("text is as wide as its letters with a pixel between them", () => {
  assert.equal(textWidth("KOM", 0.1), (3 * 5 + 2) * 0.1);
  assert.equal(textWidth("", 0.1), 0);
});

test("text is drawn centred on its origin, one square per lit pixel, facing the reader", () => {
  const mesh = new MeshBuilder();
  const lit = [...GLYPHS.I.join("")].filter((c) => c === "#").length;
  pixelText(mesh, "I", { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], facing: [0, 0, 1], pixel: 0.1, color: [1, 1, 1] });
  const built = mesh.build();
  assert.equal(built.vertexCount, lit * 6, "two triangles per lit pixel");
  const xs = [];
  const ys = [];
  for (let i = 0; i < built.positions.length; i += 3) {
    xs.push(built.positions[i]);
    ys.push(built.positions[i + 1]);
  }
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-6, "centred across");
  assert.ok(Math.abs(Math.min(...ys) + Math.max(...ys)) < 1e-6, "centred up and down");
  for (let i = 2; i < built.normals.length; i += 3) assert.ok(built.normals[i] > 0.99, "faces +Z");
});

// --- where the banners hang ----------------------------------------------------------

function route({ length = 6000, loop = true, markers = [] } = {}) {
  return new RouteGeometry({
    id: "r",
    name: "R",
    lanes: 4,
    seed: 3,
    loop,
    points: loop
      ? [
          [0, 0, 100],
          [length / 2 - 10, 0, 100],
          [length / 2 - 10, 10, 100],
          [0, 10, 100],
        ]
      : [
          [0, 0, 100],
          [length, 0, 100],
        ],
    markers: [{ type: "start_finish", distance: 0 }, ...markers],
  });
}

test("a loop gets a halfway banner", () => {
  const r = route();
  const halfway = bannerSpots(r).filter((s) => s.kind === "halfway");
  assert.equal(halfway.length, 1);
  assert.equal(halfway[0].distance, r.length / 2);
  assert.equal(halfway[0].text, BANNERS.text.halfway);
});

test("short loops and routes that aren't loops get no halfway banner", () => {
  assert.equal(bannerSpots(route({ length: 2000 })).filter((s) => s.kind === "halfway").length, 0);
  assert.equal(bannerSpots(route({ loop: false })).filter((s) => s.kind === "halfway").length, 0);
});

test("a long climb counts down its last kilometre to the top", () => {
  const spots = bannerSpots(route({ markers: [{ type: "climb", distance: 1000, length: 2000 }] })).filter((s) => s.kind === "climb");
  assert.deepEqual(
    spots.map((s) => [s.distance, s.text]),
    [
      [2000, BANNERS.text.climb1000],
      [2500, BANNERS.text.climb500],
    ],
  );
});

test("a short climb only gets the banners that fit on it", () => {
  const spots = bannerSpots(route({ markers: [{ type: "climb", distance: 1000, length: 700 }] })).filter((s) => s.kind === "climb");
  assert.deepEqual(spots.map((s) => s.text), [BANNERS.text.climb500]);
  assert.equal(bannerSpots(route({ markers: [{ type: "climb", distance: 1000, length: 400 }] })).filter((s) => s.kind === "climb").length, 0);
});

test("no banner hangs right at an arch", () => {
  // Halfway (3000 m) would be 20 m after a sprint arch.
  const r = route({ markers: [{ type: "sprint", distance: 2980, length: 300 }] });
  assert.equal(bannerSpots(r).filter((s) => s.kind === "halfway").length, 0);
});

test("banners hang over the road, high enough to ride under", () => {
  const r = route({ markers: [{ type: "climb", distance: 1000, length: 2000 }] });
  const mesh = new MeshBuilder();
  buildBanners(mesh, r);
  const built = mesh.build();
  assert.ok(built.vertexCount > 0);
  const frame = roadFrame(r, 2500);
  let lowestOverRoad = Infinity;
  for (let i = 0; i < built.positions.length; i += 3) {
    const [x, y, z] = [built.positions[i], built.positions[i + 1], built.positions[i + 2]];
    if (Math.abs(x - frame.center[0]) < 1 && Math.abs(z - frame.center[2]) < 2.5) lowestOverRoad = Math.min(lowestOverRoad, y - frame.center[1]);
  }
  assert.ok(lowestOverRoad > 3.5, `lowest part over the road at ${lowestOverRoad.toFixed(2)} m`);
});

test("the arches carry their names", () => {
  const plain = new RouteGeometry({ id: "p", name: "P", lanes: 4, seed: 3, points: [[0, 0, 0], [500, 0, 0], [500, 10, 0], [0, 10, 0]], markers: [] });
  const withArches = route({ markers: [{ type: "climb", distance: 1000, length: 400 }, { type: "sprint", distance: 2000, length: 300 }] });
  const lettered = buildArches(withArches).vertexCount;
  // Three bare arches are 3 × (2 posts + beam) boxes plus the chequer; the letters add far more.
  assert.ok(lettered > 3 * 3 * 36 + 12 * 6 + 200, `${lettered} vertices`);
  assert.equal(buildArches(plain).vertexCount, 0);
});
