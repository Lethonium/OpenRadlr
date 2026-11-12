/**
 * The studio's cameras: where to look from in a room (its own frame: riders
 * face −Z, up is +Y) and `StudioCamera`, which puts that pose onto the floor
 * of the building where the room is.
 */
import { transformPoint } from "./math.js";
import { RIDER_GEOMETRY } from "./riderModel.js";
import { SLAB } from "./studioBuilding.js";
import { INSTRUCTOR, ROOM, ROW_GAP, STAGE, seatPosition } from "./studioLayout.js";
import { floorTransform } from "./studioLayer.js";

export const STUDIO_CAMERAS = Object.freeze(["seat", "pov", "wide", "coach"]);

/** How far the head rises and sinks with each pedal stroke, metres. */
const BOB_M = 0.03;

/** A saved camera choice if it still exists, else the seat camera (older versions, garbage). */
export function cameraModeOf(saved) {
  return STUDIO_CAMERAS.includes(saved) ? saved : "seat";
}

/**
 * Camera eye and target for a mode, from my seat. `pov` is my own head on the
 * saddle looking over the bar; it bobs with `cadence` (rpm) at `timeS`, not
 * with `reducedMotion`.
 */
export function studioCamera(mode, mySeat, { cadence = 0, timeS = 0, reducedMotion = false } = {}) {
  const coachHead = [INSTRUCTOR.position[0], INSTRUCTOR.position[1] + 1.2, INSTRUCTOR.position[2]];
  if (mode === "wide") return { eye: [0, 3.9, ROOM.back - 0.6], target: [0, 0.6, -3.5] };
  // Just in front of the coach, over the stage edge (the coach is hidden: too close).
  if (mode === "coach") return { eye: [0, 2.5, STAGE.z + 1.1], target: [0, 0.8, ROW_GAP] };
  const seat = seatPosition(mySeat ?? 3);
  if (mode === "pov") {
    const bob = reducedMotion ? 0 : BOB_M * Math.sin(2 * Math.PI * (cadence / 60) * timeS);
    const y = seat[1] + RIDER_GEOMETRY.headHeight + bob;
    return { eye: [seat[0], y, seat[2]], target: [seat[0], y - 0.3, seat[2] - 10] };
  }
  // Over my shoulder, in front of the row behind me.
  return { eye: [seat[0] * 0.9, seat[1] + 2.25, seat[2] + 1.9], target: [coachHead[0], coachHead[1] - 0.4, coachHead[2]] };
}

/** The studio camera of a ride in the building: a room's camera on that room's floor. */
export class StudioCamera {
  #site;
  #room;
  #seat;
  #timeS = 0;
  #reducedMotion;
  /** Pedal rate in rpm, set by the view each frame; drives the pov bob. */
  cadence = 0;

  /**
   * @param {{position: number[], yaw: number}} site the building
   * @param {number} room my room (0-based, the floor)
   * @param {number} seat my seat in it
   * @param {string} mode one of STUDIO_CAMERAS
   */
  constructor(site, room, seat, mode, { reducedMotion = false } = {}) {
    this.#site = site;
    this.#room = room;
    this.#seat = seat;
    this.#reducedMotion = reducedMotion;
    this.mode = cameraModeOf(mode);
    this.update(0, 0, 0);
  }

  setMode(mode) {
    if (!STUDIO_CAMERAS.includes(mode)) return;
    this.mode = mode;
    this.update(0, 0, 0);
  }

  cycle() {
    this.setMode(STUDIO_CAMERAS[(STUDIO_CAMERAS.indexOf(this.mode) + 1) % STUDIO_CAMERAS.length]);
    return this.mode;
  }

  /** Another room or seat (the server moved me). */
  place(room, seat) {
    if (room === this.#room && seat === this.#seat) return;
    this.#room = room;
    this.#seat = seat;
    this.update(0, 0, 0);
  }

  /** Same signature as the chase camera's; only the time step matters. */
  update(_distance, _lane, dt) {
    this.#timeS += Math.max(0, dt);
    const pose = studioCamera(this.mode, this.#seat, { cadence: this.cadence, timeS: this.#timeS, reducedMotion: this.#reducedMotion });
    const floor = floorTransform(this.#site, this.#room);
    const world = ([x, y, z]) => transformPoint(floor, [x, y + SLAB, z]).slice(0, 3);
    this.eye = world(pose.eye);
    this.target = world(pose.target);
    return this;
  }
}
