/**
 * The spin studio in the valley: the shell (plinth, a storey per floor, roof with its sign) and one room per storey,
 * stacked at the studio's site. The floor count follows the frame (`frame.studio = {floors, open}`: the studio's rooms,
 * or more where a rider sits higher), so nothing of it is baked into the world; the shell and rooms are rebuilt only
 * when the count changes. Floors below `open` are lit, the others dark behind darker glass. The riders and the coaches
 * are ordinary entries of the rider layer.
 */
import * as THREE from "../../three.js";
import { createStudioRoom, createStudioShell } from "../assets/buildings/spinStudio.js";
import { FLOOR_HEIGHT, SLAB } from "../../world/studioLayout.js";
import { createOwner } from "./tracker.js";

/** The glass of an open floor, and of a closed one. */
const OPEN_GLASS = Object.freeze({ opacity: 0.2, colour: 0xcfe6ee });
const CLOSED_GLASS = Object.freeze({ opacity: 0.75, colour: 0x405060 });

/**
 * @param {{position: number[], yaw: number}} site from `studioSite`
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createStudioBuildingLayer(site, { settings, uniforms, track }) {
  const object = new THREE.Group();
  object.name = "studio";
  object.position.fromArray(site.position);
  object.rotation.y = site.yaw;

  let built = null;
  let floors = 0;
  let open = -1;

  const clear = () => {
    if (!built) return;
    object.remove(built.group);
    built.owner.disposeAll();
    built = null;
  };

  const build = (count) => {
    clear();
    const owner = createOwner(track);
    const group = new THREE.Group();
    group.name = "studio-building";
    const shell = createStudioShell({ floors: count, own: owner.own, uniforms });
    group.add(shell.object);
    const panes = shell.glass.map((pane) => {
      pane.material = owner.own(pane.material.clone());
      return pane;
    });
    const rooms = [];
    for (let floor = 0; floor < count; floor += 1) {
      const room = createStudioRoom({ own: owner.own, uniforms });
      room.object.name = `room-${floor}`;
      room.object.position.y = floor * FLOOR_HEIGHT + SLAB;
      group.add(room.object);
      rooms.push(room);
    }
    group.traverse((child) => {
      if (child.isMesh) child.castShadow = child.castShadow && settings.shadows;
    });
    object.add(group);
    built = { group, owner, rooms, panes };
    floors = count;
    open = -1;
  };

  const light = (count) => {
    open = count;
    built.rooms.forEach((room, floor) => room.setOpen(floor < count));
    built.panes.forEach((pane, floor) => {
      const look = floor < count ? OPEN_GLASS : CLOSED_GLASS;
      pane.material.opacity = look.opacity;
      pane.material.color.setHex(look.colour);
    });
  };

  return {
    object,
    /** @param {{studio?: {floors: number, open: number}}} frame */
    update(frame) {
      const state = frame.studio;
      if (!state) return;
      if (!built || state.floors !== floors) build(state.floors);
      if (state.open !== open) light(state.open);
    },
    setEnvironment() {},
    dispose() {
      clear();
      object.clear();
    },
  };
}
