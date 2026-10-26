/**
 * Shared vehicles: the tandem (2 seats) and the beer bike (4, 6 or 8 seats).
 * Same local axes and units as riderModel.js: forward = −Z, up = +Y, ground at
 * y = 0, metres, origin on the ground in the middle of the wheelbase.
 *
 * Every seat is a normal rider. `vehicleLayout` says where each rider's hip and
 * bottom bracket are and which way the rider faces; the legs, cranks and wheels
 * come from riderModel (`buildThigh`, `buildShin`, `buildFoot`, `buildCrankset`,
 * `buildWheel`, posed with `legPose`) and are placed there. The seat's hip and
 * bottom bracket keep the solo rider's offset, so `legPose` reaches the pedals.
 * Model a seat like this: translate the solo frame so its hip lands on `hip`
 * (`placement(hip, yaw)` then `placement([0, −hy, −hz])` with the solo hip),
 * then draw the legs exactly as for a solo rider. `buildSeatedBody` has its
 * origin at the hip instead and goes straight to `placement(hip, yaw)`.
 */
import { add, cross, normalize, placement, scale, sub } from "./math.js";
import { MeshBuilder } from "./meshBuilder.js";
import { RIDER_GEOMETRY, variantLook } from "./riderModel.js";

const KIT = [1, 1, 1, 1];
const SADDLE = [0.08, 0.08, 0.09];
const VISOR = [0.08, 0.08, 0.1];
const TYRE = [0.07, 0.07, 0.08];
const RIM = [0.62, 0.64, 0.67];
const METAL = [0.2, 0.21, 0.24];
const CHROME = [0.8, 0.82, 0.86];
const TANDEM_FRAME = [0.1, 0.38, 0.34];
const WOOD = [0.62, 0.42, 0.24];
const WOOD_LIGHT = [0.74, 0.54, 0.32];
const WOOD_DARK = [0.4, 0.26, 0.16];
const LEATHER = [0.3, 0.17, 0.12];
const ROOF = [0.8, 0.2, 0.17];
const CREAM = [0.95, 0.9, 0.78];
const CEILING = [0.86, 0.78, 0.62];
const AMBER = [0.92, 0.62, 0.12];
const FOAM = [0.98, 0.97, 0.92];
const LAMP = [1, 0.9, 0.55];

/** Hip to bottom bracket of the solo rider, in the rider's frame (the legs' IK assumes it). */
const HIP_TO_BB = RIDER_GEOMETRY.bottomBracket.map((v, i) => v - RIDER_GEOMETRY.hip[i]);

/** `placement`'s turn around Y (yaw 0 = facing −Z) applied to a vector. */
const turn = (yaw, [x, y, z]) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];

function seatAt(hip, yaw) {
  return { hip, bottomBracket: add(hip, turn(yaw, HIP_TO_BB)), yaw };
}

/** Round-ish tube between two points, any direction (a four-sided box along the axis). */
function tube(m, a, b, thickness, color) {
  const u = sub(b, a);
  const ref = Math.abs(u[1]) > 0.9 * Math.hypot(u[0], u[1], u[2]) ? [1, 0, 0] : [0, 1, 0];
  const v = scale(normalize(cross(u, ref)), thickness);
  const w = scale(normalize(cross(u, v)), thickness);
  m.orientedBox(scale(add(a, b), 0.5), u, v, w, color);
}

/** Upper body of a rider with the hip at the origin, facing −Z. No bike, no legs. */
export function buildSeatedBody({ skin, helmet, shorts } = variantLook(0)) {
  const m = new MeshBuilder();
  // Same torso, arms and head as `buildBike`, moved so the hip is the origin.
  const hip = [0, 0, 0];
  const chest = [0, 0.28, -0.3];
  const shoulder = [0, 0.36, -0.44];
  m.segment(hip, chest, 0.34, 0.22, KIT);
  m.segment(chest, shoulder, 0.38, 0.22, KIT);
  m.box([0, 0.02, 0.02], [0.32, 0.12, 0.2], shorts);
  for (const side of [-0.18, 0.18]) {
    const elbow = [side * 1.08, 0.17, -0.52];
    const hand = [side * 1.1, -0.01, -0.6];
    m.segment([side, 0.34, -0.42], elbow, 0.1, 0.1, KIT);
    m.segment(elbow, hand, 0.08, 0.08, skin);
  }
  m.box([0, 0.46, -0.5], [0.12, 0.08, 0.1], skin); // neck
  m.ellipsoid([0, 0.53, -0.54], [0.1, 0.11, 0.11], skin, 3, 6);
  m.ellipsoid([0, 0.6, -0.52], [0.13, 0.09, 0.17], helmet, 3, 7);
  m.box([0, 0.53, -0.64], [0.18, 0.04, 0.03], VISOR);
  return m.build();
}

// --- tandem -------------------------------------------------------------------

const TANDEM = Object.freeze({
  /** Hub distance from the middle: wheelbase 1.75 m. */
  hubZ: 0.875,
  captainZ: -0.25,
  stokerZ: 0.58,
});

/** Bike parts of one seat relative to its hip: seat tube top, saddle, head tube, bars. */
const TANDEM_BAR_Y = 0.98;

export function buildTandemFrame() {
  const m = new MeshBuilder();
  const frame = TANDEM_FRAME;
  const { hubZ, captainZ: c, stokerZ: s } = TANDEM;
  const hubY = RIDER_GEOMETRY.wheelRadius;
  const front = [0, hubY, -hubZ];
  const rear = [0, hubY, hubZ];
  const bbY = RIDER_GEOMETRY.bottomBracket[1];
  const bbC = [0, bbY, c + HIP_TO_BB[2]];
  const bbS = [0, bbY, s + HIP_TO_BB[2]];
  const seatC = [0, 0.94, c + 0.06];
  const seatS = [0, 0.94, s + 0.06];
  const head = [0, 0.9, c - 0.5];

  // Captain's front triangle, like the solo bike.
  m.segment(bbC, seatC, 0.045, 0.05, frame);
  m.segment(bbC, head, 0.065, 0.065, KIT);
  m.segment(seatC, head, 0.05, 0.05, frame);
  m.segment(head, front, 0.04, 0.045, frame);
  m.box(bbC, [0.12, 0.1, 0.1], frame);
  m.box([0, 0.97, c + 0.08], [0.12, 0.04, 0.26], SADDLE);
  m.segment(head, [0, TANDEM_BAR_Y, c - 0.56], 0.04, 0.04, frame);
  m.box([0, TANDEM_BAR_Y, c - 0.58], [0.44, 0.035, 0.05], SADDLE);
  for (const x of [-0.2, 0.2]) m.segment([x, TANDEM_BAR_Y, c - 0.58], [x, 0.88, c - 0.64], 0.035, 0.035, SADDLE);

  // Stoker's rear triangle and the long tubes that join the two.
  m.segment(bbS, seatS, 0.045, 0.05, frame);
  m.segment(rear, bbS, 0.04, 0.045, frame);
  m.segment(rear, seatS, 0.032, 0.036, frame);
  m.box(bbS, [0.12, 0.1, 0.1], frame);
  m.box([0, 0.97, s + 0.08], [0.12, 0.04, 0.26], SADDLE);
  m.segment(bbC, bbS, 0.05, 0.055, frame); // lower joining tube
  const joinFrom = [0, 0.8, c + 0.027];
  const joinTo = [0, 0.9, s + 0.05];
  m.segment(joinFrom, joinTo, 0.045, 0.05, frame); // stoker top tube

  // Stoker's bars sit on a stem standing on that top tube, behind the captain's saddle.
  const barZ = s - 0.58;
  const tubeY = joinFrom[1] + ((joinTo[1] - joinFrom[1]) * (barZ - joinFrom[2])) / (joinTo[2] - joinFrom[2]);
  m.segment([0, tubeY, barZ], [0, TANDEM_BAR_Y, barZ], 0.045, 0.045, frame);
  m.box([0, TANDEM_BAR_Y, barZ], [0.44, 0.035, 0.05], SADDLE);
  for (const x of [-0.2, 0.2]) m.segment([x, TANDEM_BAR_Y, barZ], [x, 0.88, barZ - 0.06], 0.035, 0.035, SADDLE);
  return m.build();
}

function tandemLayout() {
  const y = RIDER_GEOMETRY.hip[1];
  const hubY = RIDER_GEOMETRY.wheelRadius;
  return {
    seats: [seatAt([0, y, TANDEM.captainZ], 0), seatAt([0, y, TANDEM.stokerZ], 0)],
    wheels: [
      [0, hubY, -TANDEM.hubZ],
      [0, hubY, TANDEM.hubZ],
    ],
    wheelRadius: RIDER_GEOMETRY.wheelRadius,
    cameraBack: 6.5,
    cameraUp: 2.5,
  };
}

const SEAT_COUNTS = { tandem: [2], beer_bike: [5, 7, 9] };

function checkSeats(kind, seats) {
  if (!SEAT_COUNTS[kind]) throw new Error(`unknown vehicle kind: ${kind}`);
  if (!SEAT_COUNTS[kind].includes(seats)) throw new Error(`${kind} takes ${SEAT_COUNTS[kind].join(", ")} seats, not ${seats}`);
}

// --- beer bike ----------------------------------------------------------------

/** The counter reaches this far past the first and last side row. */
const COUNTER_END = 0.42;

const BEER = Object.freeze({
  /** Hip height of a seated rider and distance of the hip from the middle line. */
  hipY: 1.06,
  hipX: 0.78,
  /** First side row (z = 0) and spacing between rows (hip to hip). */
  firstRow: 0,
  rowGap: 0.72,
  /** The captain's hip is this far behind the counter's rear end, and the deck reaches `tailPast` past it. */
  captainBehind: 0.95,
  /** Deck: half width, top, and how far it reaches in front of the counter's front end. */
  deckHalf: 1.0,
  deckTop: 0.16,
  noseZ: -0.87,
  tailPast: 0.5,
  wheelRadius: 0.3,
  wheelX: 1.12,
  wheelWidth: 0.1,
  counterHalf: 0.28,
  counterTop: 0.96,
  roofEave: 2.4,
  roofRidge: 2.62,
  roofHalf: 1.25,
  postX: 1.04,
});

/**
 * Seats of a beer bike in a frame where the first side row is at z = 0 and the
 * captain is behind the rear end of the counter. Seat 0 is the captain, on the
 * centre line facing forward (−Z) along the table; it is the rearmost seat. Seats
 * 1.. alternate left, right, left… front to back, in even pairs. Left riders
 * (−X) face right with yaw −π/2, right riders face left with yaw +π/2.
 */
function beerPlan(seatCount) {
  const rows = (seatCount - 1) / 2;
  const lastRow = BEER.firstRow + (rows - 1) * BEER.rowGap;
  const captainZ = lastRow + COUNTER_END + BEER.captainBehind;
  const seats = [seatAt([0, BEER.hipY, captainZ], 0)];
  for (let j = 0; j < seatCount - 1; j += 1) {
    const left = j % 2 === 0;
    const z = BEER.firstRow + (j >> 1) * BEER.rowGap;
    seats.push(seatAt([left ? -BEER.hipX : BEER.hipX, BEER.hipY, z], left ? -Math.PI / 2 : Math.PI / 2));
  }
  const tailZ = captainZ + BEER.tailPast;
  const frontHub = BEER.noseZ + 0.45;
  const rearHub = tailZ - 0.45;
  const hubs = [
    [-BEER.wheelX, BEER.wheelRadius, frontHub],
    [BEER.wheelX, BEER.wheelRadius, frontHub],
    [-BEER.wheelX, BEER.wheelRadius, rearHub],
    [BEER.wheelX, BEER.wheelRadius, rearHub],
  ];
  return { seats, hubs, rows, lastRow, captainZ, tailZ, middle: (frontHub + rearHub) / 2 };
}

function beerLayout(seatCount) {
  const plan = beerPlan(seatCount);
  const shift = (p) => [p[0], p[1], p[2] - plan.middle];
  return {
    seats: plan.seats.map((seat) => ({ hip: shift(seat.hip), bottomBracket: shift(seat.bottomBracket), yaw: seat.yaw })),
    wheels: plan.hubs.map(shift),
    wheelRadius: BEER.wheelRadius,
    cameraBack: 7 + 0.3 * seatCount,
    cameraUp: 3.2 + 0.1 * seatCount,
  };
}

function addWheel(m, hub) {
  const r = BEER.wheelRadius;
  m.wheel(hub, r, BEER.wheelWidth, TYRE, 14);
  m.wheel(hub, r * 0.72, BEER.wheelWidth + 0.012, RIM, 14);
  m.wheel(hub, r * 0.62, BEER.wheelWidth + 0.016, TYRE, 14);
  m.wheel(hub, 0.06, BEER.wheelWidth + 0.06, RIM, 8);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = [hub[0], hub[1] + Math.cos(a) * r * 0.64, hub[2] + Math.sin(a) * r * 0.64];
    m.segment(hub, spoke, 0.014, 0.014, RIM);
  }
}

function addDeck(m, plan) {
  const { noseZ } = BEER;
  const length = plan.tailZ - noseZ;
  const centre = (noseZ + plan.tailZ) / 2;
  const lanes = 8;
  const lane = (BEER.deckHalf * 2) / lanes;
  for (let i = 0; i < lanes; i += 1) {
    m.box([-BEER.deckHalf + lane * (i + 0.5), BEER.deckTop - 0.03, centre], [lane - 0.006, 0.06, length], i % 2 ? WOOD_LIGHT : WOOD);
  }
  for (const x of [-BEER.deckHalf + 0.03, BEER.deckHalf - 0.03]) m.box([x, BEER.deckTop - 0.045, centre], [0.1, 0.1, length + 0.04], WOOD_DARK);
  for (const z of [noseZ, plan.tailZ]) m.box([0, BEER.deckTop - 0.045, z], [BEER.deckHalf * 2 + 0.04, 0.1, 0.1], WOOD_DARK);
}

function addWheelsAndBumpers(m, plan) {
  for (const hub of plan.hubs) {
    addWheel(m, hub);
    const side = Math.sign(hub[0]);
    const stayX = side * (BEER.deckHalf + 0.005);
    // Stay from the deck up past the hub, with a mudguard over the tyre.
    m.box([stayX, (BEER.deckTop + hub[1] + BEER.wheelRadius + 0.05) / 2, hub[2]], [0.04, hub[1] + BEER.wheelRadius + 0.05 - BEER.deckTop, 0.08], METAL);
    m.box([side * BEER.wheelX, hub[1] + BEER.wheelRadius + 0.05, hub[2]], [0.17, 0.03, 0.66], WOOD_DARK);
    m.box([side * (BEER.deckHalf + 0.04), hub[1], hub[2]], [0.1, 0.05, 0.05], METAL); // axle stub
  }
  for (const [z, out] of [
    [BEER.noseZ, -1],
    [plan.tailZ, 1],
  ]) {
    const bz = z + out * 0.12;
    m.box([0, 0.4, bz], [BEER.deckHalf * 2 + 0.1, 0.07, 0.07], METAL);
    for (const x of [-0.8, 0.8]) m.box([x, (BEER.deckTop + 0.4) / 2, z + out * 0.06], [0.06, 0.4 - BEER.deckTop, 0.06], METAL);
  }
  for (const x of [-0.62, 0.62]) {
    m.box([x, 0.55, BEER.noseZ - 0.1], [0.2, 0.14, 0.07], METAL);
    m.box([x, 0.55, BEER.noseZ - 0.14], [0.15, 0.1, 0.03], LAMP);
  }
  for (const x of [-0.62, 0.62]) m.box([x, 0.5, plan.tailZ + 0.12], [0.1, 0.08, 0.03], ROOF);
}

function addStool(m, seat) {
  const [hx, hy] = seat.hip;
  const centre = add(seat.hip, turn(seat.yaw, [0, 0, 0.06]));
  const base = hy - 0.09;
  m.cylinder([centre[0], base, centre[2]], 0.19, 0.07, LEATHER, 10);
  m.cylinder([centre[0], base - 0.025, centre[2]], 0.14, 0.025, METAL, 8);
  if (Math.abs(hx) < 0.01) {
    // Captain: a post under the stool, between the legs and behind the cranks.
    m.cylinder([centre[0], BEER.deckTop, centre[2] + 0.05], 0.032, base - BEER.deckTop, METAL, 8);
    return;
  }
  // Side rider: post on the outer deck edge, an arm carries the stool.
  const post = Math.sign(hx) * (BEER.deckHalf - 0.03);
  m.cylinder([post, BEER.deckTop, centre[2]], 0.034, base - 0.04 - BEER.deckTop, METAL, 8);
  tube(m, [post, base - 0.03, centre[2]], [centre[0], base - 0.03, centre[2]], 0.05, METAL);
}

function addCounter(m, plan) {
  const first = BEER.firstRow - COUNTER_END;
  const last = plan.lastRow + COUNTER_END;
  const centre = (first + last) / 2;
  const length = last - first;
  const topY = BEER.counterTop;
  m.box([0, (BEER.deckTop + topY - 0.09) / 2, centre], [0.34, topY - 0.09 - BEER.deckTop, length - 0.1], WOOD);
  m.box([0, topY - 0.06, centre], [BEER.counterHalf * 2, 0.07, length], WOOD_DARK);
  m.box([0, topY - 0.015, centre], [BEER.counterHalf * 2 - 0.04, 0.03, length - 0.04], WOOD_LIGHT);
  for (const z of [first, last]) m.box([0, (BEER.deckTop + topY - 0.09) / 2, z], [0.4, topY - 0.09 - BEER.deckTop, 0.04], WOOD_DARK);

  // Barrel in the middle: two stacked frustums, hoops, lid and a bung.
  const barrel = [0, topY, centre];
  m.cylinder(barrel, 0.15, 0.17, WOOD_DARK, 10, 0.18);
  m.cylinder([0, topY + 0.17, centre], 0.18, 0.17, WOOD_DARK, 10, 0.15, false);
  m.cylinder([0, topY + 0.03, centre], 0.168, 0.025, METAL, 10, 0.168, false);
  m.cylinder([0, topY + 0.29, centre], 0.168, 0.025, METAL, 10, 0.168, false);
  m.cylinder([0, topY + 0.34, centre], 0.15, 0.012, WOOD_LIGHT, 10);
  m.cylinder([0, topY + 0.352, centre], 0.025, 0.014, METAL, 6);

  // Taps on the counter either side of the barrel, a handle on each.
  const taps = plan.rows >= 3 ? [-0.9, -0.5, 0.5, 0.9] : [-0.5, 0.5];
  for (const dz of taps) {
    const z = centre + dz;
    m.cylinder([0, topY, z], 0.045, 0.02, CHROME, 8);
    m.cylinder([0, topY + 0.02, z], 0.02, 0.2, CHROME, 8);
    m.box([0, topY + 0.2, z + Math.sign(dz) * 0.035], [0.035, 0.035, 0.1], CHROME);
    m.box([0, topY + 0.255, z], [0.035, 0.07, 0.035], ROOF);
  }

  // A mug in front of every rider.
  for (const [i, seat] of plan.seats.entries()) {
    // The captain's mug stands on the rear end of the counter, in front of the wheel.
    const x = i === 0 ? 0 : Math.sign(seat.hip[0]) * 0.22;
    const z = i === 0 ? last - 0.1 : seat.hip[2];
    m.cylinder([x, topY, z], 0.04, 0.1, AMBER, 8);
    m.cylinder([x, topY + 0.1, z], 0.04, 0.025, FOAM, 8);
  }
}

function addSteering(m, plan) {
  const hand = [0, BEER.hipY + HIP_HAND_Y, plan.captainZ + HIP_HAND_Z];
  const tilt = (28 * Math.PI) / 180;
  const up = [0, Math.cos(tilt), -Math.sin(tilt)];
  const radius = 0.2;
  const at = (a) => add(hand, add(scale([1, 0, 0], Math.cos(a) * radius), scale(up, Math.sin(a) * radius)));
  const sides = 12;
  for (let i = 0; i < sides; i += 1) tube(m, at((i / sides) * Math.PI * 2), at(((i + 1) / sides) * Math.PI * 2), 0.034, SADDLE);
  for (const a of [Math.PI, -Math.PI / 2, 0]) tube(m, hand, at(a), 0.026, METAL);
  m.cylinder([hand[0], hand[1] - 0.025, hand[2]], 0.05, 0.05, METAL, 8);
  tube(m, [0, BEER.deckTop, hand[2] - 0.13], [0, hand[1] - 0.06, hand[2] - 0.02], 0.055, METAL);
  m.box([0, BEER.deckTop + 0.12, hand[2] - 0.1], [0.3, 0.24, 0.12], WOOD_DARK);
}

/** Hands of every seated rider rest 1 cm under the hip and 0.6 m in front of it. */
const HIP_HAND_Y = -0.01;
const HIP_HAND_Z = -0.6;

const ROOF_THICK = 0.06;

/** Height of the roof's underside `x` metres off the middle line. */
export const roofUnderside = (x) => BEER.roofEave - ROOF_THICK + (BEER.roofRidge - BEER.roofEave) * (1 - Math.abs(x) / BEER.roofHalf);

/** Beer bike posts stand at this |x| and end at the roof underside. */
export const ROOF_POST_X = BEER.postX;

function addRoof(m, plan) {
  const { roofEave: eave, roofRidge: ridge, roofHalf: half, postX } = BEER;
  const front = BEER.noseZ - 0.18;
  const back = plan.tailZ + 0.18;
  const stripe = 0.46;
  const count = Math.ceil((back - front) / stripe);
  const thick = ROOF_THICK;
  const drop = 0.15;
  for (let i = 0; i < count; i += 1) {
    const z0 = front + i * stripe;
    const z1 = Math.min(back, z0 + stripe);
    const colour = i % 2 ? CREAM : ROOF;
    for (const side of [-1, 1]) {
      m.quad([side * half, eave, z0], [side * half, eave, z1], [0, ridge, z1], [0, ridge, z0], colour);
      m.quad([side * half, eave - thick, z0], [side * half, eave - thick, z1], [0, ridge - thick, z1], [0, ridge - thick, z0], CEILING);
      m.quad([side * half, eave, z0], [side * half, eave - thick, z0], [side * half, eave - thick, z1], [side * half, eave, z1], colour);
      m.triangle([side * half, eave - thick, z0], [side * half, eave - thick, z1], [side * half, eave - thick - drop, (z0 + z1) / 2], colour);
    }
  }
  // Front and back edges follow the pitch, hung with the same pennant trim.
  const cuts = 6;
  for (const z of [front, back]) {
    for (let i = 0; i < cuts; i += 1) {
      const point = (t) => {
        const x = -half + 2 * half * t;
        return [x, eave + (ridge - eave) * (1 - Math.abs(x) / half), z];
      };
      const a = point(i / cuts);
      const b = point((i + 1) / cuts);
      const colour = i % 2 ? CREAM : ROOF;
      m.quad(a, b, [b[0], b[1] - thick, z], [a[0], a[1] - thick, z], colour);
      m.triangle([a[0], a[1] - thick, z], [b[0], b[1] - thick, z], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - thick - drop, z], colour);
    }
  }

  // Posts: the front and back corners, plus a pair between rows to carry long roofs.
  const gaps = [BEER.noseZ + 0.12, plan.tailZ - 0.12];
  if (plan.rows >= 2) gaps.push(BEER.firstRow + Math.floor((plan.rows - 1) / 2) * BEER.rowGap + BEER.rowGap / 2);
  const top = roofUnderside(postX);
  for (const z of gaps) {
    for (const side of [-1, 1]) m.cylinder([side * postX, BEER.deckTop, z], 0.035, top - BEER.deckTop, METAL, 8);
    tube(m, [-postX, top - 0.02, z], [postX, top - 0.02, z], 0.045, METAL);
  }

  // A pennant on the ridge at the front.
  tube(m, [0, ridge - 0.02, front + 0.15], [0, ridge + 0.4, front + 0.15], 0.03, METAL);
  m.triangle([0, ridge + 0.4, front + 0.15], [0, ridge + 0.27, front + 0.15], [0, ridge + 0.335, front + 0.55], ROOF);
}

export function buildBeerBike(seats) {
  checkSeats("beer_bike", seats);
  const plan = beerPlan(seats);
  const m = new MeshBuilder();
  addDeck(m, plan);
  addWheelsAndBumpers(m, plan);
  addCounter(m, plan);
  for (const seat of plan.seats) addStool(m, seat);
  addSteering(m, plan);
  addRoof(m, plan);
  // Origin in the middle of the wheelbase, like the layout says.
  const centred = new MeshBuilder();
  centred.append(m.build(), placement([0, 0, -plan.middle]));
  return centred.build();
}

// --- layout ---------------------------------------------------------------------

/**
 * Where the riders sit.
 * @param {"tandem" | "beer_bike"} kind
 * @param {number} seats 2 for the tandem, 5, 7 or 9 for the beer bike
 * @returns {{seats: {hip: number[], bottomBracket: number[], yaw: number}[], wheels: number[][],
 *            wheelRadius: number, cameraBack: number, cameraUp: number}}
 */
export function vehicleLayout(kind, seats) {
  checkSeats(kind, seats);
  return kind === "tandem" ? tandemLayout() : beerLayout(seats);
}
