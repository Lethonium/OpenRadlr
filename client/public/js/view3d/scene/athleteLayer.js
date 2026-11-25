/**
 * The athletes at the outdoor gyms: the rigged rider (or its penguin outfit in winter) doing the exercise the view poses
 * it in, settled on its spot from the rig itself, with its parked bike at the rack. Within `ATHLETE_REACH` of the camera
 * only; a rig that is not drawn goes to a short free list, so one that comes back is not rebuilt. Athletes do not count
 * against the road riders' full budget.
 *
 * The rig faces +x; an athlete's `yaw` is the placement's (0 faces -Z), turned here.
 */
import * as THREE from "../../three.js";
import { bikeGeometry, createBike } from "../assets/riders/bicycle.js";
import { kitTexture } from "../assets/riders/kitPainter.js";
import { lookOf } from "../assets/riders/look.js";
import { dressAsPenguin } from "../assets/riders/penguinOutfit.js";
import { settleOnRig } from "../assets/riders/retarget.js";
import { createRider } from "../assets/riders/rider.js";
import { createOwner } from "./tracker.js";

/** Metres from the camera within which athletes are drawn. */
export const ATHLETE_REACH = 200;
/** Rigs kept on the free list. */
const POOL_SIZE = 6;
/** The frame is scaled with the rider's height around the reference rider, within these bounds (as the cyclist does). */
const REFERENCE_HEIGHT = 1.78;
const SCALE_RANGE = [0.88, 1.12];

/**
 * @typedef {object} AthleteEntry
 * @property {number} id
 * @property {number[]} position the spot on the mat, world metres
 * @property {number} yaw the placement's yaw: 0 faces -Z
 * @property {import("../riderPose.js").Pose} pose already blended and mirrored by the view, not settled
 * @property {string | null} plantMesh the clip's planted mesh after mirroring (`footR`), or null
 * @property {number[]} tint linear 0-1 jersey colour
 * @property {"rider" | "penguin"} figure
 * @property {{position: number[], yaw: number} | null} bike the parked bike
 */

const hexOf = (tint) => `#${new THREE.Color().setRGB(tint[0], tint[1], tint[2], THREE.LinearSRGBColorSpace).getHexString()}`;
/** Our mesh names (`footR`) as the rig's bone names (`foot_R`). */
const boneOfMesh = (mesh) => mesh.replace(/([LR])$/, "_$1");
/** Yaw about y that takes the rig's +x to our forward (yaw 0 faces -Z). */
const turnOf = (yaw) => Math.PI / 2 + yaw;

/**
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createAthleteLayer({ uniforms, track }) {
  const { disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "athletes";

  /** @type {Map<string, object>} rigs in the scene by `id|figure`; the free list, oldest first */
  const active = new Map();
  const free = new Map();
  const counts = { drawn: 0 };

  const paint = (record, tint) => {
    const key = tint.join(",");
    if (record.kitKey === key) return;
    const previous = record.kit;
    record.kit = createOwner(track);
    record.texture = kitTexture({ ...lookOf(record.id), primary: hexOf(tint) }, record.kit.own);
    record.rig?.setTexture(record.texture);
    record.kitKey = key;
    previous?.disposeAll();
  };

  const create = (entry) => {
    const record = { key: `${entry.id}|${entry.figure}`, id: entry.id, owner: createOwner(track), kit: null, kitKey: "", texture: null, rig: null, group: new THREE.Group(), bike: null, plantMesh: null, plant: null };
    const look = { ...lookOf(entry.id), primary: hexOf(entry.tint) };
    paint(record, entry.tint);
    record.rig = createRider(look, { own: record.owner.own, uniforms, texture: record.texture });
    if (entry.figure === "penguin") dressAsPenguin(record.rig, { own: record.owner.own, uniforms, scarf: look.primary });
    record.group.add(record.rig.object);
    return record;
  };

  const destroy = (record) => {
    record.owner.disposeAll();
    record.kit.disposeAll();
  };

  const acquire = (entry) => {
    const key = `${entry.id}|${entry.figure}`;
    let record = active.get(key);
    if (!record) {
      record = free.get(key);
      if (record) free.delete(key);
      else record = create(entry);
      active.set(key, record);
      object.add(record.group);
    }
    paint(record, entry.tint);
    return record;
  };

  const release = (record) => {
    active.delete(record.key);
    object.remove(record.group);
    if (record.bike) object.remove(record.bike.object);
    free.set(record.key, record);
    while (free.size > POOL_SIZE) {
      const [oldest] = free.keys();
      destroy(free.get(oldest));
      free.delete(oldest);
    }
  };

  /** The parked bike of a record, built on first use, placed at the rack. */
  const park = (record, bike) => {
    if (!bike) {
      if (record.bike) record.bike.object.visible = false;
      return;
    }
    if (!record.bike) {
      const look = lookOf(record.id);
      const scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], look.height / REFERENCE_HEIGHT));
      record.bike = createBike({ type: look.bike, frame: look.frame, accent: look.frameAccent, scale, saddleHeight: record.rig.saddleFor(bikeGeometry(look.bike, { scale })), own: record.owner.own, uniforms });
    }
    if (!record.bike.object.parent) object.add(record.bike.object);
    record.bike.object.visible = true;
    record.bike.object.position.fromArray(bike.position);
    record.bike.object.rotation.set(0, turnOf(bike.yaw), 0);
  };

  /** Settles the rig on its spot; the planted bone's x is measured once per plant mesh and held. */
  const pose = (record, entry) => {
    if (entry.plantMesh !== record.plantMesh) {
      record.plantMesh = entry.plantMesh;
      record.plant = null;
      if (entry.plantMesh) {
        const bone = boneOfMesh(entry.plantMesh);
        settleOnRig(record.rig, entry.pose);
        record.plant = { bone, x: record.rig.boneWorld(bone).x };
      }
    }
    settleOnRig(record.rig, entry.pose, record.plant);
  };

  return {
    object,
    stats: () => ({ ...counts }),
    /** The rig drawn for this athlete id last frame, or null. */
    rigOf: (id) => [...active.values()].find((record) => record.id === id && record.drawn)?.rig ?? null,
    /** The parked bike of this athlete id, or null. */
    bikeOf: (id) => [...active.values()].find((record) => record.id === id && record.drawn)?.bike ?? null,
    setEnvironment() {},
    /** @param {{camera: import("../../three.js").Camera, athletes?: AthleteEntry[]}} frame */
    update(frame) {
      const camera = frame.camera.position;
      const near = (frame.athletes ?? []).filter((entry) => Math.hypot(entry.position[0] - camera.x, entry.position[1] - camera.y, entry.position[2] - camera.z) <= ATHLETE_REACH);
      for (const record of active.values()) record.drawn = false;
      for (const entry of near) {
        const record = acquire(entry);
        record.drawn = true;
        record.group.position.fromArray(entry.position);
        record.group.rotation.set(0, turnOf(entry.yaw), 0);
        pose(record, entry);
        park(record, entry.bike);
      }
      for (const record of [...active.values()]) if (!record.drawn) release(record);
      counts.drawn = near.length;
    },
    dispose() {
      for (const record of [...active.values(), ...free.values()]) destroy(record);
      active.clear();
      free.clear();
      object.clear();
      disposeAll();
    },
  };
}
