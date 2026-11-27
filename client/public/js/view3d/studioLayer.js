/**
 * Where the spin studio's floors and riders are, with no drawing: the floor count follows the studio's rooms (and the
 * riders), so nothing of it is baked into the world chunks. The scene draws the building (scene/studioBuildingLayer.js)
 * and the riders (riderLayer). Local frame as in the studio: riders face −Z, up is +Y; the site gives its origin and yaw.
 */
import { placement, transformPoint } from "./math.js";
import { FLOOR_HEIGHT, INSTRUCTOR, SLAB, coachId, seatPosition } from "./studioLayout.js";

/** The building never has fewer storeys than this, so it reads as a building. */
const MIN_FLOORS = 2;

/** Storeys drawn for `rooms` studio rooms. */
export function floorCount(rooms) {
  return Math.max(MIN_FLOORS, rooms | 0);
}

/** Model matrix of storey `floor` (0 = ground): the site's placement raised by whole floor heights. */
export function floorTransform(site, floor) {
  return placement([site.position[0], site.position[1] + floor * FLOOR_HEIGHT, site.position[2]], site.yaw);
}

/** World position and yaw of `seat` in `room` (0-based): the room's floor sits on the storey's slab. */
export function seatWorld(site, room, seat) {
  const [x, y, z] = seatPosition(seat);
  const at = transformPoint(floorTransform(site, room), [x, y + SLAB, z]);
  return { position: [at[0], at[1], at[2]], yaw: site.yaw };
}

/** World pose of the coach on `floor`'s stage. */
export function coachWorld(site, floor) {
  const [x, y, z] = INSTRUCTOR.position;
  const at = transformPoint(floorTransform(site, floor), [x, y + SLAB, z]);
  return { position: [at[0], at[1], at[2]], yaw: site.yaw + INSTRUCTOR.yaw };
}

const forwardOf = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];

/**
 * Where the studio's floors and riders are, with no drawing: how many storeys (rooms, and any a rider sits above), which
 * are open (lit) and where each studio rider and each floor's coach stands.
 */
export class StudioFloors {
  #site;
  #rooms = MIN_FLOORS;
  #declaredOpen = 0;
  #open = 0;

  /** @param {{position: number[], yaw: number}} site from `studioSite` */
  constructor(site) {
    this.#site = site;
  }

  /** Storeys for the studio's rooms, or more where riders sit on a higher floor (road views never hear the room count). */
  get floors() {
    return Math.max(floorCount(this.#rooms), this.#open);
  }

  /** Floors below this count are open (lit): the declared ones, and those riders sit on. */
  get open() {
    return this.#open;
  }

  /** How many floors have a room, from the studio's room count. */
  setRooms(rooms) {
    this.#rooms = rooms | 0;
  }

  /** Floors below this count show their room; the others are dark. Riders can open more. */
  setOpen(openRooms) {
    this.#declaredOpen = openRooms | 0;
    this.#open = this.#declaredOpen;
  }

  /** Places the riders that sit in the studio; the others belong to the road. Opens the floors they ride on. */
  riders(list) {
    let open = this.#declaredOpen;
    const placed = [];
    for (const rider of list) {
      if (!rider.studio) continue;
      const { room, seat } = rider.studio;
      open = Math.max(open, room + 1);
      const { position, yaw } = seatWorld(this.#site, room, seat);
      placed.push({ rider, position, forward: forwardOf(yaw), yaw });
    }
    this.#open = open;
    return placed;
  }

  /** The coach on every open floor, as placed riders: one id per floor (`coachId`), all with the instructor's look, pedalling. */
  coaches() {
    const placed = [];
    for (let floor = 0; floor < Math.min(this.#open, this.floors); floor += 1) {
      const { position, yaw } = coachWorld(this.#site, floor);
      placed.push({ rider: { id: coachId(floor), lookId: INSTRUCTOR.id, coach: true, power: 1, speed: 0, studio: { room: floor, seat: -1 } }, position, forward: forwardOf(yaw), yaw });
    }
    return placed;
  }
}
