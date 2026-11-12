import { test } from "node:test";
import assert from "node:assert/strict";
import { StudioLayer, floorCount, floorTransform, seatWorld } from "../../public/js/view3d/studioLayer.js";
import { FLOOR_HEIGHT } from "../../public/js/view3d/studioBuilding.js";

const site = { position: [100, 20, -50], yaw: 0 };
const turned = { position: [100, 20, -50], yaw: Math.PI / 2 };

class FakeRenderer {
  uploads = [];
  draws = [];
  transparent = [];
  upload(mesh) {
    this.uploads.push(mesh);
    return { id: this.uploads.length };
  }
  dispose() {}
  draw(handle, model, tint) {
    this.draws.push({ handle, model, tint });
  }
  drawBright(handle, model) {
    this.draws.push({ handle, model, bright: true });
  }
  drawTransparent(handle, model, look) {
    this.transparent.push({ handle, model, look });
  }
}

test("the building has at least two floors", () => {
  assert.equal(floorCount(0), 2);
  assert.equal(floorCount(1), 2);
  assert.equal(floorCount(3), 3);
});

test("floor n stands n floor heights above the ground", () => {
  assert.ok(Math.abs(floorTransform(site, 2)[13] - (20 + 2 * FLOOR_HEIGHT)) < 1e-4);
});

test("a seat one floor up is one floor height above the same seat below", () => {
  const down = seatWorld(site, 0, 0);
  const up = seatWorld(site, 1, 0);
  assert.ok(Math.abs(up.position[1] - down.position[1] - FLOOR_HEIGHT) < 1e-4);
  assert.ok(Math.abs(up.position[0] - down.position[0]) < 1e-4);
});

test("the site's yaw turns the seat offset around the site", () => {
  const plain = seatWorld(site, 0, 0).position;
  const rotated = seatWorld(turned, 0, 0).position;
  const dx = plain[0] - site.position[0];
  const dz = plain[2] - site.position[2];
  // A quarter turn about Y sends the local (x, z) offset to (z, -x).
  assert.ok(Math.abs(rotated[0] - (site.position[0] + dz)) < 1e-4);
  assert.ok(Math.abs(rotated[2] - (site.position[2] - dx)) < 1e-4);
});

test("studio riders face the road, the site's -Z", () => {
  const layer = new StudioLayer(new FakeRenderer(), site);
  const [placed] = layer.riders([{ id: 1, studio: { room: 0, seat: 0 } }]);
  assert.deepEqual(placed.forward.map((v) => Math.round(v) + 0), [0, 0, -1]);
  const [turnedPlaced] = new StudioLayer(new FakeRenderer(), turned).riders([{ id: 1, studio: { room: 0, seat: 0 } }]);
  assert.ok(Math.abs(turnedPlaced.forward[0] + 1) < 1e-4);
  assert.ok(Math.abs(turnedPlaced.forward[2]) < 1e-4);
});

test("a studio rider is placed at its seat and a road rider is left alone", () => {
  const layer = new StudioLayer(new FakeRenderer(), site);
  const placed = layer.riders([
    { id: 7, studio: { room: 2, seat: 5 } },
    { id: 8, route: null, distance: 10 },
  ]);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].rider.id, 7);
  assert.deepEqual(placed[0].position, seatWorld(site, 2, 5).position);
});

test("a rider in room 2 opens the third floor, so three coaches are not needed below", () => {
  const layer = new StudioLayer(new FakeRenderer(), site);
  layer.setRooms(3);
  assert.equal(layer.coaches().length, 0);
  layer.riders([{ id: 7, studio: { room: 2, seat: 5 } }]);
  assert.equal(layer.coaches().length, 3);
});

test("a closed floor draws its room darker, an open one with its bright accents", () => {
  const fake = new FakeRenderer();
  const layer = new StudioLayer(fake, site);
  layer.setRooms(3);
  layer.setOpen(1);
  layer.draw("opaque", {});
  assert.equal(fake.draws.filter((d) => d.bright).length, 1);
  assert.equal(fake.draws.filter((d) => d.tint).length, 2);
});

test("the glass is drawn blended, darker on closed floors", () => {
  const fake = new FakeRenderer();
  const layer = new StudioLayer(fake, site);
  layer.setRooms(2);
  layer.setOpen(1);
  layer.draw("glass", {});
  assert.equal(fake.transparent.length, 2);
  assert.ok(fake.transparent[1].look.alpha > fake.transparent[0].look.alpha);
});
