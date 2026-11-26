import { test } from "node:test";
import assert from "node:assert/strict";
import { RouteGeometry } from "../public/js/route/geometry.js";
import { drawProfileStrip, profileStrip } from "../public/js/view2d/profileStrip.js";

const route = new RouteGeometry({ id: "open", name: "Open", loop: false, lanes: 3, seed: 1, points: [[0, 0, 10], [400, 0, 10], [800, 0, 30]], markers: [], zones: [] });
const RECT = { x: 16, y: 600, width: 800, height: 54 };

/** A context that records the calls of the names asked for. */
function spy() {
  const log = [];
  const ctx = new Proxy({}, {
    get: (_, name) => (name === "createLinearGradient" ? () => ({ addColorStop() {} }) : (...args) => log.push({ name, args })),
    set: () => true,
  });
  return { ctx, log };
}

test("the strip samples the whole route and knows its lowest and highest point", () => {
  const strip = profileStrip(route, { samples: 100 });
  assert.equal(strip.points.length, 101);
  assert.equal(strip.points[0], 10);
  assert.equal(strip.points.at(-1), 30);
  assert.equal(strip.lo, 10);
  assert.equal(strip.hi, 30);
  assert.equal(profileStrip(route).points.length, 301);
});

test("the strip marks me larger than the others, and the visible stretch as a band", () => {
  const { ctx, log } = spy();
  const riders = [{ d: 300, mine: true, look: { primary: "#ff7a1a" } }, { d: 320, look: { primary: "#2f7de1" } }, { d: 280 }];
  drawProfileStrip(ctx, profileStrip(route), { rect: RECT, me: { d: 300 }, riders, viewM: 55 });
  const arcs = log.filter((c) => c.name === "arc");
  assert.equal(arcs.length, 3);
  const [mine, other, plain] = arcs.map((c) => c.args[2]);
  assert.ok(mine > other && other === plain);
  const band = log.find((c) => c.name === "fillRect");
  assert.ok(Math.abs(band.args[2] - (55 / route.length) * RECT.width) < 1e-9, `band ${band.args}`);
});

test("a rider's dot sits on the profile at its distance", () => {
  const { ctx, log } = spy();
  const strip = profileStrip(route);
  drawProfileStrip(ctx, strip, { rect: RECT, me: { d: 0 }, riders: [{ d: 800, mine: true }], viewM: 55 });
  const [x, y] = log.find((c) => c.name === "arc").args;
  assert.ok(Math.abs(x - (RECT.x + RECT.width)) < 1e-9 || x < RECT.x + RECT.width, "at the right end");
  assert.ok(y < RECT.y + RECT.height / 2, "30 m is the top of the profile");
});
