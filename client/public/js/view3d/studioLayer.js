/**
 * The spin studio building in the valley, as a layer of the main-thread view
 * (like the statues): the shell's base once, a storey and a room per floor,
 * the roof on top. The floor count follows the studio's rooms, so nothing of
 * it is baked into the world chunks. Local frame as in the studio: riders
 * face −Z, up is +Y; the site gives its origin and yaw.
 */
import { multiply, placement, transformPoint } from "./math.js";
import { FLOOR_HEIGHT, SLAB, buildStudioShell } from "./studioBuilding.js";
import { buildStudioRoom } from "./studioRoom.js";
import { INSTRUCTOR, seatPosition } from "./studioLayout.js";

/** The building never has fewer storeys than this, so it reads as a building. */
const MIN_FLOORS = 2;
const CLOSED_TINT = Object.freeze([0.3, 0.32, 0.36]);
const CLOSED_GLASS = Object.freeze({ alpha: 0.75, tint: [0.25, 0.3, 0.36] });
const OPEN_GLASS = Object.freeze({ alpha: 0.22, tint: [1, 1, 1] });

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
function coachWorld(site, floor) {
  const [x, y, z] = INSTRUCTOR.position;
  const at = transformPoint(floorTransform(site, floor), [x, y + SLAB, z]);
  return { position: [at[0], at[1], at[2]], yaw: site.yaw + INSTRUCTOR.yaw };
}

const forwardOf = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];

export class StudioLayer {
  #renderer;
  #site;
  #rooms = MIN_FLOORS;
  #declaredOpen = 0;
  #open = 0;
  #handles;

  /**
   * @param {object} renderer uploads and draws meshes (the WebGL one, or a fake in tests)
   * @param {{position: number[], yaw: number}} site from `studioSite`
   */
  constructor(renderer, site) {
    this.#renderer = renderer;
    this.#site = site;
    const shell = buildStudioShell();
    const room = buildStudioRoom();
    const up = (mesh) => renderer.upload(mesh);
    this.#handles = { base: up(shell.base), floor: up(shell.floor), roof: up(shell.roof), glass: up(shell.glass), room: up(room.room), accents: up(room.accents) };
  }

  get floors() {
    return floorCount(this.#rooms);
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

  /** The coach on every open floor, as placed riders (id 0, pedalling). */
  coaches() {
    const placed = [];
    for (let floor = 0; floor < Math.min(this.#open, this.floors); floor += 1) {
      const { position, yaw } = coachWorld(this.#site, floor);
      placed.push({ rider: { id: INSTRUCTOR.id, power: 1, speed: 0, studio: { room: floor, seat: -1 } }, position, forward: forwardOf(yaw), yaw });
    }
    return placed;
  }

  /** "opaque": base, storeys, rooms, roof. "glass": the front panes, after every opaque mesh. */
  draw(pass, _ctx) {
    const r = this.#renderer;
    const h = this.#handles;
    const open = (floor) => floor < this.#open;
    if (pass === "opaque") {
      r.draw(h.base, floorTransform(this.#site, 0));
      for (let floor = 0; floor < this.floors; floor += 1) {
        const model = floorTransform(this.#site, floor);
        r.draw(h.floor, model);
        const at = multiply(model, placement([0, SLAB, 0]));
        if (open(floor)) {
          r.draw(h.room, at);
          r.drawBright(h.accents, at, 0.8);
        } else {
          r.draw(h.room, at, CLOSED_TINT);
        }
      }
      r.draw(h.roof, floorTransform(this.#site, this.floors));
    } else if (pass === "glass") {
      for (let floor = 0; floor < this.floors; floor += 1) {
        r.drawTransparent(h.glass, floorTransform(this.#site, floor), open(floor) ? OPEN_GLASS : CLOSED_GLASS);
      }
    }
  }

  dispose() {
    for (const handle of Object.values(this.#handles)) this.#renderer.dispose(handle);
  }
}
