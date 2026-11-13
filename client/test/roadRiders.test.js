import { test } from "node:test";
import assert from "node:assert/strict";
import { elsewhereName, onRoute, ridesElsewhere } from "../public/js/ride/roadRiders.js";

test("riders on my route or on their own road count as on my route", () => {
  assert.equal(onRoute({ route: "hills" }, "hills"), true);
  assert.equal(onRoute({ route: null }, "hills"), true);
  assert.equal(onRoute({ route: "coast" }, "hills"), false);
});

test("a studio seat is never on my route, though the server sends it without one", () => {
  assert.equal(onRoute({ route: null, distance: 0, lane: 0, studio: { room: 0, seat: 3 } }, "hills"), false);
});

test("humans on other routes or in the studio ride elsewhere; bots don't", () => {
  assert.equal(ridesElsewhere({ route: "coast", is_bot: false }, "hills"), true);
  assert.equal(ridesElsewhere({ route: null, is_bot: false, studio: { room: 1, seat: 0 } }, "hills"), true);
  assert.equal(ridesElsewhere({ route: "coast", is_bot: true }, "hills"), false);
  assert.equal(ridesElsewhere({ route: null, is_bot: true, studio: { room: 0, seat: 2 } }, "hills"), false);
});

test("riders elsewhere are listed under their route's name, studio riders under the spin studio", () => {
  const routes = [{ id: "coast", name: "Coast Road" }];
  assert.equal(elsewhereName({ route: "coast" }, routes), "Coast Road");
  assert.equal(elsewhereName({ route: "gone" }, routes), "gone");
  assert.equal(elsewhereName({ route: null, studio: { room: 0, seat: 1 } }, routes), "Spin studio");
});
