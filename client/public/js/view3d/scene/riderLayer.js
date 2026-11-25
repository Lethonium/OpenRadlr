/**
 * The road riders (me, the others, bots, the ghost). Within the quality's `reach` of the camera the nearest riders (and
 * always mine) are full cyclists - rigged rider on a bike, pedalling at the rider's cadence - up to `riders.full`; the
 * rest are cheap instanced riders. Ghosts are always full cyclists, drawn see-through, and count toward neither.
 * Without a shadow map a dark disc under each drawn rider stands in for the shadow.
 *
 * A full cyclist is pooled by rider id: a rider that is not full for `POOL_DELAY` seconds is taken out of the scene and
 * kept on a short free list, so one that comes back is not rebuilt; the oldest beyond `POOL_SIZE` are freed. The jersey
 * is painted from the tint (the colour code) and repainted when the tint changes.
 *
 * The assets face +x; a rider's `forward` is turned into a yaw (and a pitch for the road's slope) here.
 */
import * as THREE from "../../three.js";
import { createCyclist } from "../assets/riders/cyclist.js";
import { bakeCheapRiders } from "../assets/riders/cheapRider.js";
import { kitTexture } from "../assets/riders/kitPainter.js";
import { lookOf } from "../assets/riders/look.js";
import { createOwner } from "./tracker.js";

/** Seconds a rider may be out of the full set before its cyclist goes to the free list. */
const POOL_DELAY = 2;
/** Cyclists kept on the free list. */
const POOL_SIZE = 4;
/** A ghost's opacity (the old renderer's `SCENE.ghost.alpha`). */
const GHOST_ALPHA = 0.38;
/** Contact blob: opacity, its size along and across the ride (metres), height above the road, most instances. */
const BLOB_ALPHA = 0.22;
const BLOB_LENGTH = 1.8;
const BLOB_WIDTH = 0.5;
const BLOB_LIFT = 0.03;
const BLOB_CAPACITY = 1024;

const hexOf = (tint) => `#${new THREE.Color().setRGB(tint[0], tint[1], tint[2], THREE.LinearSRGBColorSpace).getHexString()}`;

/**
 * @typedef {object} RiderEntry
 * @property {number} id
 * @property {boolean} me
 * @property {number[]} position road point under the rider, world metres
 * @property {number[]} forward unit direction of travel (may climb)
 * @property {number} cadence rpm
 * @property {number} speed m/s
 * @property {number} grade percent
 * @property {number[]} tint linear 0-1 jersey colour
 * @property {boolean} ghost
 */

/**
 * @param {{settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"]}} options
 */
export function createRiderLayer({ settings, uniforms, track }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "riders";
  const { full: fullBudget, reach } = settings.riders;
  const cheap = bakeCheapRiders({ own, uniforms });
  object.add(cheap.object);

  const blobs = own(new THREE.InstancedMesh(own(new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: BLOB_ALPHA, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), BLOB_CAPACITY));
  Object.assign(blobs, { name: "rider-blobs", frustumCulled: false, count: 0 });
  if (!settings.shadows) object.add(blobs);

  /** @type {Map<number, object>} cyclists in the scene by rider id; @type {Map<number, object>} the free list, oldest first */
  const active = new Map();
  const free = new Map();
  let night = 0;
  const counts = { full: 0, cheap: 0, ghosts: 0 };

  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, "YZX");
  const direction = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const blobScale = new THREE.Vector3(BLOB_LENGTH, 1, BLOB_WIDTH);
  const position = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  /** Yaw so that +x lands on `forward` (rotation about y takes +x to (cos, 0, -sin)), pitch up with its slope. */
  const orient = (target, forward) => {
    direction.fromArray(forward);
    euler.set(0, Math.atan2(-direction.z, direction.x), Math.asin(THREE.MathUtils.clamp(direction.y / (direction.length() || 1), -1, 1)));
    return target.setFromEuler(euler);
  };

  /** Dresses a cyclist in the jersey of `tint`, swapping out the old kit. */
  const paint = (record, tint) => {
    const key = `${record.id}|${tint.join(",")}`;
    if (record.kitKey === key) return;
    const previous = record.kit;
    record.kit = createOwner(track);
    const texture = kitTexture({ ...lookOf(record.id), primary: hexOf(tint) }, record.kit.own);
    if (record.cyclist) record.cyclist.setKit(texture);
    record.kitKey = key;
    record.texture = texture;
    previous?.disposeAll();
  };

  const create = (id, tint) => {
    const record = { id, owner: createOwner(track), kit: null, kitKey: "", texture: null, cyclist: null, ghost: false, seen: 0, drawn: false, casts: new Map() };
    paint(record, tint);
    record.cyclist = createCyclist({ ...lookOf(id), primary: hexOf(tint) }, { own: record.owner.own, uniforms, seed: id, texture: record.texture });
    record.cyclist.object.traverse((child) => child.isMesh && record.casts.set(child, child.castShadow));
    return record;
  };

  const destroy = (record) => {
    record.owner.disposeAll();
    record.kit.disposeAll();
  };

  /** Sets or clears the see-through look of a cyclist. */
  const setGhost = (record, ghost) => {
    if (record.ghost === ghost) return;
    record.ghost = ghost;
    for (const [mesh, casts] of record.casts) {
      mesh.castShadow = casts && !ghost;
      for (const material of [].concat(mesh.material)) {
        material.transparent = ghost;
        material.opacity = ghost ? GHOST_ALPHA : 1;
        material.needsUpdate = true;
      }
    }
  };

  /** The cyclist for this entry: the one in the scene, one off the free list, or a new one. */
  const acquire = (rider) => {
    let record = active.get(rider.id);
    if (!record) {
      record = free.get(rider.id);
      if (record) free.delete(rider.id);
      else record = create(rider.id, rider.tint);
      active.set(rider.id, record);
      object.add(record.cyclist.object);
    }
    paint(record, rider.tint);
    setGhost(record, rider.ghost);
    return record;
  };

  const release = (record) => {
    active.delete(record.id);
    object.remove(record.cyclist.object);
    free.set(record.id, record);
    while (free.size > POOL_SIZE) {
      const [oldest] = free.keys();
      destroy(free.get(oldest));
      free.delete(oldest);
    }
  };

  let blobCount = 0;
  const addBlob = (rider) => {
    if (settings.shadows || blobCount >= BLOB_CAPACITY) return;
    position.fromArray(rider.position);
    position.y += BLOB_LIFT;
    orient(quaternion, rider.forward);
    blobs.setMatrixAt(blobCount, matrix.compose(position, quaternion, blobScale));
    blobCount += 1;
  };

  return {
    object,
    /** What was drawn last frame, for tests and the readout. */
    stats: () => ({ ...counts }),
    /** The full cyclist drawn for this rider id last frame, or null. */
    cyclistOf: (id) => (active.get(id)?.drawn ? active.get(id).cyclist : null),
    setEnvironment(env) {
      night = env.night ?? 0;
    },
    /** @param {{dt: number, t: number, camera: import("../../three.js").Camera, riders?: RiderEntry[]}} frame */
    update(frame) {
      const riders = frame.riders ?? [];
      const camera = frame.camera.position;
      const distance = (rider) => Math.hypot(rider.position[0] - camera.x, rider.position[1] - camera.y, rider.position[2] - camera.z);
      const inReach = riders.map((rider) => ({ rider, away: distance(rider) })).filter(({ rider, away }) => rider.me || away <= reach);
      const ghosts = inReach.filter(({ rider }) => rider.ghost);
      const road = inReach.filter(({ rider }) => !rider.ghost).sort((a, b) => Number(b.rider.me) - Number(a.rider.me) || a.away - b.away);
      const full = road.slice(0, fullBudget);
      const far = road.slice(fullBudget);

      for (const record of active.values()) record.drawn = false;
      blobCount = 0;
      for (const { rider } of [...full, ...ghosts]) {
        const record = acquire(rider);
        const { cyclist } = record;
        record.drawn = true;
        record.seen = frame.t;
        cyclist.object.visible = true;
        cyclist.object.position.fromArray(rider.position);
        orient(quaternion, rider.forward);
        cyclist.object.quaternion.copy(quaternion);
        cyclist.setLights(night);
        cyclist.ride(frame.dt, { cadence: rider.cadence, speed: rider.speed, grade: rider.grade, t: frame.t, near: true });
        addBlob(rider);
      }
      for (const record of [...active.values()]) {
        if (record.drawn) continue;
        record.cyclist.object.visible = false;
        if (frame.t - record.seen > POOL_DELAY) release(record);
      }

      cheap.set(
        far.map(({ rider }) => {
          position.fromArray(rider.position);
          orient(quaternion, rider.forward);
          addBlob(rider);
          return { matrix: new THREE.Matrix4().compose(position, quaternion, scale), crank: rider.cadence > 0 ? frame.t * (rider.cadence / 60) * Math.PI * 2 : 0, tint: rider.tint };
        }),
      );
      blobs.count = blobCount;
      blobs.instanceMatrix.needsUpdate = true;
      counts.full = full.length;
      counts.cheap = far.length;
      counts.ghosts = ghosts.length;
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
