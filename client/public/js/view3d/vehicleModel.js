/**
 * Shared vehicles: the tandem (2 seats) and the beer bike (5, 7 or 9 seats).
 * Same local axes and units as riderModel.js: forward = −Z, up = +Y, ground at
 * y = 0, metres, origin on the ground in the middle of the wheelbase.
 *
 * Pure layout data: where each seat's rider has the hip, the bottom bracket and
 * the two hands, which way the rider faces, and where the wheels are. The meshes
 * are built on the rigged rider by `assets/riders/vehicles.js`.
 */
import { add } from "./math.js";
import { RIDER_GEOMETRY } from "./riderModel.js";

/** Hip to bottom bracket of the solo rider, in the rider's frame (the legs' IK assumes it). */
const HIP_TO_BB = RIDER_GEOMETRY.bottomBracket.map((v, i) => v - RIDER_GEOMETRY.hip[i]);

/** `placement`'s turn around Y (yaw 0 = facing −Z) applied to a vector. */
const turn = (yaw, [x, y, z]) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];

/** The two hand points (left, right), `forward` metres in front of the hip, `half` to each side and `drop` below it. */
const gripsAt = (hip, yaw, { forward, half, drop }) => [-half, half].map((x) => add(hip, turn(yaw, [x, drop, -forward])));

function seatAt(hip, yaw, hands) {
  return { hip, bottomBracket: add(hip, turn(yaw, HIP_TO_BB)), yaw, grips: gripsAt(hip, yaw, hands) };
}

// --- tandem -------------------------------------------------------------------

const TANDEM = Object.freeze({
  /** Hub distance from the middle: wheelbase 1.75 m. */
  hubZ: 0.875,
  captainZ: -0.25,
  stokerZ: 0.58,
});

/** Height of the bar ends, where the hands rest. */
const TANDEM_BAR_END = 0.88;

function tandemLayout() {
  const y = RIDER_GEOMETRY.hip[1];
  const hubY = RIDER_GEOMETRY.wheelRadius;
  return {
    // Hands on the bar ends: the captain's, and the stoker's on the stem behind the captain's saddle.
    seats: [
      seatAt([0, y, TANDEM.captainZ], 0, { forward: 0.39, half: 0.2, drop: TANDEM_BAR_END - y }),
      seatAt([0, y, TANDEM.stokerZ], 0, { forward: 0.64, half: 0.2, drop: TANDEM_BAR_END - y }),
    ],
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
  // The captain holds the steering wheel; the others rest their hands on the counter edge in front of the seat.
  const seats = [seatAt([0, BEER.hipY, captainZ], 0, { forward: -HIP_HAND_Z, half: 0.2, drop: HIP_HAND_Y })];
  for (let j = 0; j < seatCount - 1; j += 1) {
    const left = j % 2 === 0;
    const z = BEER.firstRow + (j >> 1) * BEER.rowGap;
    seats.push(seatAt([left ? -BEER.hipX : BEER.hipX, BEER.hipY, z], left ? -Math.PI / 2 : Math.PI / 2, { forward: 0.5, half: 0.16, drop: -0.07 }));
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
    seats: plan.seats.map((seat) => ({ hip: shift(seat.hip), bottomBracket: shift(seat.bottomBracket), yaw: seat.yaw, grips: seat.grips.map(shift) })),
    wheels: plan.hubs.map(shift),
    wheelRadius: BEER.wheelRadius,
    cameraBack: 7 + 0.3 * seatCount,
    cameraUp: 3.2 + 0.1 * seatCount,
  };
}

/** Hands of every seated rider rest 1 cm under the hip and 0.6 m in front of it. */
const HIP_HAND_Y = -0.01;
const HIP_HAND_Z = -0.6;

// --- layout ---------------------------------------------------------------------

/**
 * Where the riders sit.
 * @param {"tandem" | "beer_bike"} kind
 * @param {number} seats 2 for the tandem, 5, 7 or 9 for the beer bike
 * @returns {{seats: {hip: number[], bottomBracket: number[], yaw: number, grips: number[][]}[], wheels: number[][],
 *            wheelRadius: number, cameraBack: number, cameraUp: number}}
 */
export function vehicleLayout(kind, seats) {
  checkSeats(kind, seats);
  return kind === "tandem" ? tandemLayout() : beerLayout(seats);
}
