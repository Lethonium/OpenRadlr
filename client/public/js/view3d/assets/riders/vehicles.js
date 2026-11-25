/**
 * Shared vehicles on the rigged rider: the tandem (2 seats) and the beer bike (5, 7 or 9). A vehicle is built from its
 * layout (`vehicleLayout`, handed in as data) in the rider's frame, forward +x, up +y, right +z, origin on the ground in
 * the middle of the wheelbase. Every seat has a frame of its own at the seat's bottom bracket with the crankset in it;
 * a rider's rig goes into that frame and is posed with `seatFit`. The layout speaks the old frame (forward -z, right +x).
 */
import * as THREE from "../../../three.js";
import { box, colour, cylinder, paint, rod } from "../geom.js";
import { createSharedUniforms } from "../materials.js";
import { createOwner } from "../owner.js";
import { lookOf } from "./look.js";
import { createRider } from "./rider.js";
import { BIKE_TYPES, bikeGeometry, bikeMaterial, bucket, buildCrankset, buildWheel, flush } from "./bicycle.js";

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const REFERENCE_HEIGHT = 1.78;
/** The saddle top sits this far under the hip when no saddle height is given, metres. */
const HIP_ABOVE_SADDLE = 0.12;

/**
 * A `bikeGeometry("city")` fit with the seat's bottom bracket, saddle and grips, in the seat's frame (the bottom bracket
 * at x = z = 0, +x the way the rider faces, +z the rider's right). The seat tube points from the bottom bracket to the hip.
 * @param {{hip: number[], bottomBracket: number[], yaw: number, grips: number[][]}} seat in the layout's frame
 * @param {{height: number}} look
 * @param {number | null} [saddleHeight] along the seat tube; the hip less a hand's breadth when null
 * @returns {import("./bicycle.js").BikeFit}
 */
export function seatFit(seat, look, saddleHeight = null) {
  const fit = bikeGeometry("city", { scale: clamp(look.height / REFERENCE_HEIGHT, 0.88, 1.12) });
  const [bx, by, bz] = seat.bottomBracket;
  const forward = [-Math.sin(seat.yaw), -Math.cos(seat.yaw)];
  const right = [Math.cos(seat.yaw), -Math.sin(seat.yaw)];
  const local = ([x, y, z]) => new THREE.Vector3((x - bx) * forward[0] + (z - bz) * forward[1], y, (x - bx) * right[0] + (z - bz) * right[1]);
  const bb = new THREE.Vector3(0, by, 0);
  const toHip = local(seat.hip).sub(bb);
  const sd = toHip.clone().normalize();
  const height = saddleHeight ?? toHip.length() - HIP_ABOVE_SADDLE;
  fit.bb.copy(bb);
  fit.sd.copy(sd);
  fit.saddle.copy(bb).addScaledVector(sd, height);
  fit.saddleH = height;
  fit.grips = { flat: seat.grips.map(local) };
  fit.T = { ...fit.T, grip: "flat" };
  return fit;
}

// ---------- parts

const WOOD = "#9e6b3d";
const WOOD_DARK = "#66422a";
const WOOD_LIGHT = "#bd8851";
const METAL = "#33363c";
const SADDLE = "#16161a";
const LEATHER = "#4d2c1f";
const ROOF = "#cc3329";
const CREAM = "#f2e6c7";
const TANDEM_FRAME = "#1a6157";
/** Beer bike sizes, as the layout draws them (`vehicleModel.js`): deck half width, top; counter; roof; posts. */
const BEER = Object.freeze({ deckHalf: 1, deckTop: 0.16, counterHalf: 0.28, counterTop: 0.96, counterEnd: 0.42, hubToEnd: 0.45, wheelX: 1.12, wheelWidth: 0.1, eave: 2.4, ridge: 2.62, roofHalf: 1.25, postX: 1.04 });

const tube = (parts, kind, a, b, radius, value, segments = 8) => parts[kind].push(rod(a, b, radius, colour(value), segments));
/** The layout's point (forward -z, right +x) in the vehicle's frame (forward +x, right +z). */
const rigPoint = ([x, y, z]) => [-z, y, x];

/** Tandem frame in the layout's frame: two front triangles' worth of tubes joining both bottom brackets, the bars. */
function tandemBody(layout, parts) {
  const [captain, stoker] = layout.seats;
  const [front, rear] = layout.wheels;
  const bbC = captain.bottomBracket;
  const bbS = stoker.bottomBracket;
  const seatTop = (seat) => [seat.hip[0], seat.hip[1] - 0.08, seat.hip[2] + 0.05];
  const head = [0, 0.9, captain.hip[2] - 0.5];
  tube(parts, "paint", bbC, seatTop(captain), 0.032, TANDEM_FRAME);
  tube(parts, "paint", bbC, head, 0.04, TANDEM_FRAME);
  tube(parts, "paint", seatTop(captain), head, 0.032, TANDEM_FRAME);
  tube(parts, "paint", head, front, 0.028, TANDEM_FRAME);
  tube(parts, "paint", bbS, seatTop(stoker), 0.032, TANDEM_FRAME);
  tube(parts, "paint", rear, bbS, 0.028, TANDEM_FRAME);
  tube(parts, "paint", rear, seatTop(stoker), 0.024, TANDEM_FRAME);
  tube(parts, "paint", bbC, bbS, 0.035, TANDEM_FRAME);
  tube(parts, "paint", seatTop(captain), seatTop(stoker), 0.032, TANDEM_FRAME);
  for (const seat of layout.seats) {
    const [left, right] = seat.grips;
    parts.rubber.push(box(0.14, 0.04, 0.24, colour(SADDLE), seat.hip[0], seat.hip[1] - 0.09, seat.hip[2] + 0.05));
    tube(parts, "metal", left, right, 0.017, METAL, 6);
    const middle = [(left[0] + right[0]) / 2, left[1] + 0.1, (left[2] + right[2]) / 2];
    tube(parts, "metal", middle, [middle[0], middle[1] - 0.45, middle[2]], 0.02, METAL, 6);
    for (const grip of seat.grips) tube(parts, "metal", grip, [grip[0], grip[1] + 0.07, grip[2] + 0.02], 0.016, METAL, 6);
  }
}

/** Beer bike body in the layout's frame: deck, counter with a barrel, stools, steering wheel, posts and roof. */
function beerBody(layout, parts) {
  const hubZ = layout.wheels.map((hub) => hub[2]);
  const nose = Math.min(...hubZ) - BEER.hubToEnd;
  const tail = Math.max(...hubZ) + BEER.hubToEnd;
  const rows = layout.seats.slice(1).map((seat) => seat.hip[2]);
  const first = Math.min(...rows) - BEER.counterEnd;
  const last = Math.max(...rows) + BEER.counterEnd;
  const mid = (a, b) => (a + b) / 2;
  parts.paint.push(box(BEER.deckHalf * 2, 0.12, tail - nose, colour(WOOD_DARK), 0, BEER.deckTop - 0.06, mid(nose, tail)));
  parts.paint.push(box(BEER.counterHalf * 1.2, BEER.counterTop - 0.1 - BEER.deckTop, last - first - 0.1, colour(WOOD), 0, mid(BEER.deckTop, BEER.counterTop - 0.1), mid(first, last)));
  parts.paint.push(box(BEER.counterHalf * 2, 0.08, last - first, colour(WOOD_LIGHT), 0, BEER.counterTop - 0.04, mid(first, last)));
  parts.paint.push(cylinder(0.17, 0.15, 0.36, 10, colour(WOOD_DARK), 0, BEER.counterTop + 0.18, mid(first, last)));
  for (const y of [0.1, 0.28]) parts.metal.push(cylinder(0.172, 0.172, 0.025, 10, colour(METAL), 0, BEER.counterTop + y, mid(first, last)));
  for (const end of [nose, tail]) parts.metal.push(box(BEER.deckHalf * 2 + 0.1, 0.07, 0.07, colour(METAL), 0, 0.4, end + Math.sign(end - mid(nose, tail)) * 0.12));
  layout.seats.forEach((seat, i) => {
    const [hx, hy, hz] = seat.hip;
    const stool = [hx - Math.sin(seat.yaw) * -0.06, hy - 0.09, hz - Math.cos(seat.yaw) * -0.06];
    parts.rubber.push(cylinder(0.19, 0.19, 0.07, 10, colour(LEATHER), stool[0], stool[1], stool[2]));
    const edge = i === 0 ? 0 : Math.sign(hx) * (BEER.deckHalf - 0.03);
    parts.metal.push(cylinder(0.034, 0.034, stool[1] - 0.04 - BEER.deckTop, 8, colour(METAL), edge, mid(BEER.deckTop, stool[1] - 0.04), i === 0 ? stool[2] + 0.05 : stool[2]));
    if (i) tube(parts, "metal", [edge, stool[1] - 0.03, stool[2]], [stool[0], stool[1] - 0.03, stool[2]], 0.04, METAL);
  });
  const wheel = layout.seats[0].grips;
  const centre = [0, wheel[0][1], mid(wheel[0][2], wheel[1][2])];
  parts.rubber.push(paint(new THREE.TorusGeometry(0.2, 0.026, 6, 18), colour(SADDLE)).rotateX(-0.49).translate(...centre));
  tube(parts, "metal", [0, BEER.deckTop, centre[2] - 0.13], [centre[0], centre[1] - 0.06, centre[2]], 0.045, METAL);
  const eaveY = BEER.eave;
  const rise = BEER.ridge - BEER.eave;
  const slope = Math.atan2(rise, BEER.roofHalf);
  const length = tail - nose + 0.36;
  for (const side of [-1, 1]) {
    parts.paint.push(box(Math.hypot(BEER.roofHalf, rise), 0.06, length, colour(side < 0 ? CREAM : ROOF), 0, 0, 0).rotateZ(-side * slope).translate(side * BEER.roofHalf / 2, eaveY + rise / 2, mid(nose, tail)));
  }
  const top = eaveY - 0.06 + rise * (1 - BEER.postX / BEER.roofHalf);
  for (const z of [nose + 0.12, tail - 0.12]) for (const side of [-1, 1]) parts.metal.push(cylinder(0.035, 0.035, top - BEER.deckTop, 8, colour(METAL), side * BEER.postX, mid(BEER.deckTop, top), z));
}

/**
 * Builds a vehicle for a layout.
 * @param {object} options
 * @param {"tandem" | "beer_bike"} options.kind
 * @param {{seats: {hip: number[], bottomBracket: number[], yaw: number, grips: number[][]}[], wheels: number[][], wheelRadius: number}} options.layout
 * @param {(resource: any) => any} options.own
 * @param {ReturnType<typeof createSharedUniforms>} [options.uniforms]
 * @returns {{object: import("../../../three.js").Group, setWheels: (distanceM: number) => void,
 *   setCranks: (angles: number[], feet?: {pitchL: number, pitchR: number}[]) => void,
 *   seatFrame: (index: number) => import("../../../three.js").Object3D,
 *   pedals: (index: number) => import("../../../three.js").Group[]}}
 */
export function createVehicle({ kind, layout, own = (resource) => resource, uniforms = createSharedUniforms() }) {
  const kit = { own, material: bikeMaterial(own, uniforms, { value: 1 }) };
  const object = new THREE.Group();
  object.name = kind;
  const body = new THREE.Group();
  body.rotation.y = -Math.PI / 2; // layout frame (forward -z) to rig frame (forward +x)
  object.add(body);
  const parts = bucket();
  if (kind === "tandem") tandemBody(layout, parts);
  else beerBody(layout, parts);
  flush(parts, body, kit);

  const radius = layout.wheelRadius;
  const wheelFit = { T: { ...BIKE_TYPES.city, R: radius, disc: false, spokes: 24 } };
  const wheels = layout.wheels.map((hub, i) => {
    const wheel = buildWheel(wheelFit, { rear: false, rimColour: "#1d1f24", wall: "black" }, kit);
    wheel.name = `wheel-${i}`;
    wheel.position.set(...rigPoint(hub));
    if (kind === "beer_bike") wheel.scale.z = 2;
    object.add(wheel);
    return wheel;
  });

  const seats = layout.seats.map((seat) => {
    const frame = new THREE.Group();
    frame.name = `seat-${seat.yaw}`;
    frame.position.set(...rigPoint([seat.bottomBracket[0], 0, seat.bottomBracket[2]]));
    frame.rotation.y = seat.yaw;
    object.add(frame);
    const fit = seatFit(seat, { height: REFERENCE_HEIGHT });
    return { frame, crankset: buildCrankset(fit, kit, frame) };
  });

  return {
    object,
    setWheels(distance) {
      for (const wheel of wheels) wheel.rotation.z = -distance / radius;
    },
    setCranks(angles, feet = []) {
      seats.forEach(({ crankset }, i) => crankset.setCrank(angles[i] ?? 0, feet[i]?.pitchL ?? 0, feet[i]?.pitchR ?? 0));
    },
    seatFrame: (index) => seats[index].frame,
    pedals: (index) => seats[index].crankset.pedals,
  };
}

// ---------- the workbench assets

/** Rider ids the workbench seats (any, they only pick the looks). */
const BENCH_FIRST_RIDER = 3;
const BENCH_CADENCE = 80;

const benchMeta = (id, name, description, options) => Object.freeze({ id, name, category: "Creatures", description, options: Object.freeze(options) }); // i18n-ok

/**
 * The workbench assets of the two vehicles. They need the layouts, which live outside the assets' layer, so the page hands
 * `vehicleLayout` in.
 * @param {(kind: string, seats: number) => {seats: object[], wheels: number[][], wheelRadius: number}} layoutFor
 */
export function vehicleAssets(layoutFor) {
  const speed = Object.freeze({ type: "range", min: 0, max: 30, step: 1, default: 12 });
  const make = (kind, defaultSeats) => ({ track, uniforms, seats = defaultSeats, speed: kmh = 12 } = {}) => {
    const owner = createOwner(track);
    const layout = layoutFor(kind, Number(seats));
    const vehicle = createVehicle({ kind, layout, own: owner.own, uniforms });
    const fits = [];
    const rigs = layout.seats.map((seat, i) => {
      const look = lookOf(BENCH_FIRST_RIDER + i);
      const rig = createRider(look, { own: owner.own, uniforms });
      vehicle.seatFrame(i).add(rig.object);
      fits.push(seatFit(seat, look, rig.saddleFor(seatFit(seat, look))));
      return rig;
    });
    const cranks = layout.seats.map(() => 0.6);
    let distance = 0;
    const update = (dt, t) => {
      distance += (kmh / 3.6) * dt;
      vehicle.setWheels(distance);
      const rpm = kmh > 1 ? BENCH_CADENCE : 0;
      const feet = rigs.map((rig, i) => {
        cranks[i] -= (rpm / 60) * TAU * dt;
        return rig.poseRide(fits[i], { crank: cranks[i], t, coast: rpm === 0 });
      });
      vehicle.setCranks(cranks, feet);
    };
    update(0, 0);
    return { object: vehicle.object, update, dispose: () => owner.disposeAll() };
  };
  return Object.freeze({
    tandem: Object.freeze({
      meta: benchMeta("tandem", "Tandem (seated riders)", "The tandem with a captain and a stoker on the rigged rider, pedalling.", { speed }), // i18n-ok
      create: make("tandem", 2),
    }),
    "beer-bike": Object.freeze({
      meta: benchMeta("beer-bike", "Beer bike (seated riders)", "The beer bike with a rider on every seat of the rigged rider, pedalling.", { // i18n-ok
        seats: Object.freeze({ type: "select", values: Object.freeze(["5", "7", "9"]), default: "7" }),
        speed,
      }),
      create: make("beer_bike", 7),
    }),
  });
}
