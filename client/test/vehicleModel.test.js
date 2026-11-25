import { test } from "node:test";
import assert from "node:assert/strict";
import { RIDER_GEOMETRY } from "../public/js/view3d/riderModel.js";
import { vehicleLayout } from "../public/js/view3d/vehicleModel.js";

test("tandem layout puts the captain ahead of the stoker on the centre line", () => {
  const layout = vehicleLayout("tandem", 2);
  assert.equal(layout.seats.length, 2);
  const [captain, stoker] = layout.seats;
  assert.ok(captain.hip[2] < stoker.hip[2]);
  assert.ok(captain.bottomBracket[2] < stoker.bottomBracket[2]);
  for (const seat of layout.seats) {
    assert.equal(seat.hip[0], 0);
    assert.equal(seat.yaw, 0);
  }
  assert.equal(layout.wheels.length, 2);
  assert.ok(layout.wheels[0][2] < layout.wheels[1][2]);
  assert.equal(layout.wheelRadius, RIDER_GEOMETRY.wheelRadius);
  assert.ok(layout.cameraBack > 0 && layout.cameraUp > 0);
});

test("every seat keeps the solo rider's hip-to-bottom-bracket offset, turned by its yaw", () => {
  const solo = RIDER_GEOMETRY.bottomBracket.map((v, i) => v - RIDER_GEOMETRY.hip[i]);
  for (const layout of [vehicleLayout("tandem", 2), vehicleLayout("beer_bike", 9)]) {
    for (const seat of layout.seats) {
      const c = Math.cos(seat.yaw);
      const s = Math.sin(seat.yaw);
      // Same rotation as `placement`: local +X → (cos, 0, −sin), local +Z → (sin, 0, cos).
      const expected = [solo[0] * c + solo[2] * s, solo[1], -solo[0] * s + solo[2] * c];
      seat.bottomBracket.forEach((v, i) => assert.ok(Math.abs(v - seat.hip[i] - expected[i]) < 1e-9));
    }
  }
});

test("beer bike layout: captain at the rear end of the table, the others in even pairs", () => {
  const layout = vehicleLayout("beer_bike", 9);
  assert.equal(layout.seats.length, 9);
  const [captain, ...crew] = layout.seats;
  assert.equal(captain.yaw, 0);
  assert.equal(captain.hip[0], 0);
  for (const seat of crew) assert.ok(captain.hip[2] > seat.hip[2], "captain is the rearmost seat");
  const left = crew.filter((s) => s.hip[0] < 0);
  const right = crew.filter((s) => s.hip[0] > 0);
  assert.equal(left.length, 4);
  assert.equal(right.length, 4);
  // Riders on the left face right (+X) and the other way round.
  for (const seat of left) assert.ok(Math.abs(seat.yaw + Math.PI / 2) < 1e-9);
  for (const seat of right) assert.ok(Math.abs(seat.yaw - Math.PI / 2) < 1e-9);
  // Each left rider has a partner right opposite.
  for (const seat of left) assert.ok(right.some((r) => Math.abs(r.hip[2] - seat.hip[2]) < 1e-9));
  assert.equal(layout.wheels.length, 4);
  assert.ok(layout.cameraBack > vehicleLayout("tandem", 2).cameraBack);
  assert.ok(layout.cameraUp > vehicleLayout("tandem", 2).cameraUp);
});

test("beer bike crews split evenly across the counter", () => {
  for (const seats of [5, 7, 9]) {
    const crew = vehicleLayout("beer_bike", seats).seats.slice(1);
    assert.equal(crew.filter((s) => s.hip[0] < 0).length, crew.length / 2);
    assert.equal(crew.filter((s) => s.hip[0] > 0).length, crew.length / 2);
  }
});

test("beer bike seats sit on the deck and never crowd each other", () => {
  for (const seats of [5, 7, 9]) {
    const layout = vehicleLayout("beer_bike", seats);
    assert.equal(layout.seats.length, seats);
    // Deck bounds: half width 1.0 (BEER.deckHalf), ends 0.45 m past the outer hubs.
    const deckZ = [Math.min(...layout.wheels.map((w) => w[2])) - 0.45, Math.max(...layout.wheels.map((w) => w[2])) + 0.45];
    for (const seat of layout.seats) {
      const [x, , z] = seat.bottomBracket;
      assert.ok(Math.abs(x) < 1.0 && z > deckZ[0] && z < deckZ[1], `seat bottom bracket ${seat.bottomBracket} off the deck`);
    }
    for (let i = 0; i < seats; i += 1) {
      for (let j = i + 1; j < seats; j += 1) {
        const a = layout.seats[i].hip;
        const b = layout.seats[j].hip;
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 0.55);
      }
    }
  }
  // Real beer bikes are 4.5–5.5 m long (9 seats): the wheelbase plus the deck's overhang.
  const wheels = vehicleLayout("beer_bike", 9).wheels.map((w) => w[2]);
  const length = Math.max(...wheels) - Math.min(...wheels) + 0.9;
  assert.ok(length > 4.2 && length < 5.6, `${length} m`);
});

test("beer bike wheels stand on the ground", () => {
  const layout = vehicleLayout("beer_bike", 7);
  assert.equal(layout.wheels.length, 4);
  for (const hub of layout.wheels) assert.ok(Math.abs(hub[1] - layout.wheelRadius) < 1e-9);
});

test("seat counts the vehicles do not come in are rejected", () => {
  assert.throws(() => vehicleLayout("tandem", 3));
  assert.throws(() => vehicleLayout("beer_bike", 4));
  assert.throws(() => vehicleLayout("beer_bike", 0));
  assert.throws(() => vehicleLayout("scooter", 2));
  assert.throws(() => vehicleLayout("beer_bike", 6));
  assert.equal(vehicleLayout("beer_bike", 5).seats.length, 5);
});

test("every seat has two grips in reach", () => {
  for (const [kind, count] of [["tandem", 2], ["beer_bike", 5], ["beer_bike", 7], ["beer_bike", 9]]) {
    const { seats } = vehicleLayout(kind, count);
    seats.forEach((seat, i) => {
      assert.equal(seat.grips.length, 2, `${kind} ${count} seat ${i}`);
      const forward = [-Math.sin(seat.yaw), 0, -Math.cos(seat.yaw)];
      for (const grip of seat.grips) {
        const offset = grip.map((v, a) => v - seat.hip[a]);
        const reach = Math.hypot(...offset);
        assert.ok(reach >= 0.45 && reach <= 0.75, `${kind} ${count} seat ${i}: grip ${reach} m from the hip`);
        assert.ok(offset[0] * forward[0] + offset[2] * forward[2] > 0, `${kind} ${count} seat ${i}: grip behind the hip`);
      }
    });
  }
});
