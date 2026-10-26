import { test } from "node:test";
import assert from "node:assert/strict";
import { RIDER_GEOMETRY, variantLook } from "../public/js/view3d/riderModel.js";
import { ROOF_POST_X, buildBeerBike, buildSeatedBody, buildTandemFrame, roofUnderside, vehicleLayout } from "../public/js/view3d/vehicleModel.js";

const bounds = (mesh) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      lo[a] = Math.min(lo[a], mesh.positions[i + a]);
      hi[a] = Math.max(hi[a], mesh.positions[i + a]);
    }
  }
  return { lo, hi };
};

const wellFormed = (mesh) => {
  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.positions.length % 9, 0);
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.colors.length, (mesh.positions.length / 3) * 4);
  assert.equal(mesh.vertexCount, mesh.positions.length / 3);
  assert.ok(Array.from(mesh.positions).every(Number.isFinite));
  assert.ok(Array.from(mesh.normals).every(Number.isFinite));
};

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

test("the captain's legs stay clear of the steering column", () => {
  for (const seats of [5, 7, 9]) {
    const [captain] = vehicleLayout("beer_bike", seats).seats;
    const { positions } = buildBeerBike(seats);
    let nearest = Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
      // The column stands on the centre line in front of the captain, from the deck up to the wheel.
      if (Math.abs(x) < 0.1 && y > 0.3 && y < 0.9 && z < captain.bottomBracket[2] - 0.2) {
        nearest = Math.min(nearest, captain.bottomBracket[2] - z);
      }
    }
    assert.ok(nearest > 0.35, `column ${nearest} m ahead of the captain's bottom bracket`);
  }
});

test("beer bike seats sit inside the footprint and never crowd each other", () => {
  for (const seats of [5, 7, 9]) {
    const layout = vehicleLayout("beer_bike", seats);
    const { lo, hi } = bounds(buildBeerBike(seats));
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
    // Real beer bikes are 4.5–5.5 m long (9 seats) and 1.8–2.4 m wide.
    assert.ok(hi[0] - lo[0] > 1.8 && hi[0] - lo[0] < 2.6);
  }
  const { lo, hi } = bounds(buildBeerBike(9));
  assert.ok(hi[2] - lo[2] > 4.2 && hi[2] - lo[2] < 5.6);
});

test("beer bike wheels are part of the mesh and stand on the ground", () => {
  const layout = vehicleLayout("beer_bike", 7);
  const { lo } = bounds(buildBeerBike(7));
  assert.ok(Math.abs(lo[1]) < 1e-6);
  for (const hub of layout.wheels) assert.ok(Math.abs(hub[1] - layout.wheelRadius) < 1e-9);
});

test("vehicle meshes are well formed", () => {
  wellFormed(buildBeerBike(5));
  wellFormed(buildBeerBike(7));
  wellFormed(buildBeerBike(9));
  wellFormed(buildTandemFrame());
  wellFormed(buildSeatedBody(variantLook(0)));
});

test("tandem frame spans the wheelbase and carries no wheels or cranks", () => {
  const layout = vehicleLayout("tandem", 2);
  const { lo, hi } = bounds(buildTandemFrame());
  assert.ok(lo[2] <= layout.wheels[0][2] + 0.05 && hi[2] >= layout.wheels[1][2] - 0.05);
  // The wheels (radius 0.34) would reach the ground; the bare frame stays above the hubs' low edge.
  assert.ok(lo[1] > 0.05);
});

test("seated body is a torso, arms and head only: nothing below the hips", () => {
  const { lo, hi } = bounds(buildSeatedBody(variantLook(0)));
  // Hip at the origin. The lowest part is the shorts, a hand-width under the hip joint.
  assert.ok(lo[1] > -0.15, `lowest vertex ${lo[1]}`);
  // Head and helmet reach about the solo rider's head height above the hip.
  assert.ok(hi[1] > RIDER_GEOMETRY.headHeight - RIDER_GEOMETRY.hip[1] - 0.05);
  assert.ok(hi[1] < 0.9);
  // Leans forward (−Z) like the solo rider and keeps within a rider's width.
  assert.ok(lo[2] < -0.5);
  assert.ok(hi[0] - lo[0] < 0.7);
});

test("seated body keeps the rider tint on the jersey and nothing else", () => {
  const mesh = buildSeatedBody(variantLook(0));
  let tinted = 0;
  for (let i = 3; i < mesh.colors.length; i += 4) if (mesh.colors[i] === 1) tinted += 1;
  assert.ok(tinted > 0 && tinted < mesh.vertexCount);
});

test("roof posts reach the roof's underside", () => {
  for (const seats of [5, 9]) {
    const { positions } = buildBeerBike(seats);
    const want = roofUnderside(ROOF_POST_X);
    let highest = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(Math.abs(positions[i]) - ROOF_POST_X) < 0.04 && positions[i + 1] < want + 0.1) highest = Math.max(highest, positions[i + 1]);
    }
    assert.ok(Math.abs(highest - want) < 0.05, `posts end at ${highest}, roof underside ${want}`);
  }
});

test("seat counts the vehicles do not come in are rejected", () => {
  assert.throws(() => vehicleLayout("tandem", 3));
  assert.throws(() => vehicleLayout("beer_bike", 4));
  assert.throws(() => vehicleLayout("beer_bike", 0));
  assert.throws(() => vehicleLayout("scooter", 2));
  assert.throws(() => buildBeerBike(8));
  assert.throws(() => buildBeerBike(4));
  assert.throws(() => vehicleLayout("beer_bike", 6));
  assert.equal(vehicleLayout("beer_bike", 5).seats.length, 5);
});
