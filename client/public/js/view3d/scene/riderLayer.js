/**
 * The road riders (me, the others, bots, the ghost). Within the quality's `reach` of the camera the nearest riders (and
 * always mine) are full cyclists - rigged rider on a bike, pedalling at the rider's cadence - up to `riders.full`; the
 * rest are cheap instanced riders. Ghosts are always full cyclists, drawn see-through, and count toward neither.
 * Without a shadow map a dark disc under each drawn rider stands in for the shadow.
 *
 * A full cyclist is pooled by rider id and style (rigged or classic, so a flip of the style releases the old one): a rider that is not full for `POOL_DELAY` seconds is taken out of the scene and
 * kept on a short free list, so one that comes back is not rebuilt; the oldest beyond `POOL_SIZE` are freed. The jersey
 * is painted from the tint (the colour code) and repainted when the tint changes.
 *
 * Vehicles (tandem, beer bike) are drawn up to `reach` with a full rig in every occupied seat; those riders do not count
 * against `riders.full`. Vehicles and their seated riders are pooled like the cyclists.
 *
 * The assets face +x; a rider's `forward` is turned into a yaw (and a pitch for the road's slope) here.
 */
import * as THREE from "../../three.js";
import { createCyclist } from "../assets/riders/cyclist.js";
import { createClassicCyclist } from "../assets/riders/classicCyclist.js";
import { bakeCheapRiders } from "../assets/riders/cheapRider.js";
import { kitTexture } from "../assets/riders/kitPainter.js";
import { lookOf } from "../assets/riders/look.js";
import { createRider } from "../assets/riders/rider.js";
import { createVehicle, seatFit } from "../assets/riders/vehicles.js";
import { createOwner } from "./tracker.js";

/** Seconds a rider may be out of the full set before its cyclist goes to the free list. */
const POOL_DELAY = 2;
/** Cyclists kept on the free list. */
const POOL_SIZE = 4;
/** Vehicles and seated riders kept on their free lists. */
const VEHICLE_POOL_SIZE = 2;
const SEATED_POOL_SIZE = 9;
const TAU = Math.PI * 2;
/** Height above a seated rider's head where its label hangs, metres. */
const LABEL_LIFT = 0.25;
/** Contact blob under a vehicle: margin past the wheels along the ride, and its width, metres. */
const VEHICLE_BLOB_MARGIN = 1;
const VEHICLE_BLOB_WIDTH = { tandem: 0.7, beer_bike: 2.4 };
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
 * @property {number} [lookId] the id the look, kit and seed come from (default `id`): the studio's coaches have one id per floor but one look
 * @property {boolean} [classic] drawn as the classic cyclist (the old rider and bike) instead of the rigged one
 * @property {import("../assets/riders/look.js").RiderLook} [look] the rider's own look (#25) instead of the one rolled from `lookId`
 * @property {string} [lookKey] names `look` (its code): a new key builds the cyclist anew
 * @property {boolean} [hideBody] the rider is not drawn, its bike is (my own point of view in the studio)
 */

/**
 * @typedef {object} VehicleEntry
 * @property {number} id
 * @property {"tandem" | "beer_bike"} kind
 * @property {{seats: object[], wheels: number[][], wheelRadius: number}} layout from `vehicleLayout`
 * @property {number[]} position road point under the middle of the wheelbase, world metres
 * @property {number[]} forward unit direction of travel (may climb)
 * @property {number} speed m/s
 * @property {({id: number, me: boolean, cadence: number, tint: number[]} | null)[]} seats one per layout seat
 */

/** A rider's own pedal phase, so a cheap group does not pedal in lockstep. */
const crankPhase = (id) => ((Math.imul(id | 0, 2654435761) >>> 0) / 4294967296) * Math.PI * 2;

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

  /** The pool key of a rider's cyclist: the id, with suffixes for the classic style and a chosen look. */
  const poolKey = (rider) => {
    const style = rider.classic ? `${rider.id}c` : rider.id;
    return rider.lookKey ? `${style}|${rider.lookKey}` : style;
  };
  /** @type {Map<number, string>} the key of each rider's cyclist in the scene */
  const keyById = new Map();

  /** Dresses a cyclist in the jersey of `tint`, swapping out the old kit (the classic jersey is vertex-coloured). */
  const paint = (record, tint) => {
    const key = `${record.lookId}|${record.lookKey}|${tint.join(",")}`;
    if (record.kitKey === key) return;
    if (record.classic) {
      record.cyclist?.setPrimary(hexOf(tint));
      record.kitKey = key;
      return;
    }
    const previous = record.kit;
    record.kit = createOwner(track);
    const texture = kitTexture({ ...(record.look ?? lookOf(record.lookId)), primary: hexOf(tint) }, record.kit.own);
    if (record.cyclist) record.cyclist.setKit(texture);
    else record.rig?.setTexture(texture);
    record.kitKey = key;
    record.texture = texture;
    previous?.disposeAll();
  };

  const create = (rider) => {
    const { id, tint } = rider;
    const lookId = rider.lookId ?? id;
    const classic = Boolean(rider.classic);
    const record = { id, key: poolKey(rider), classic, lookId, look: rider.look ?? null, lookKey: rider.lookKey ?? "", bodyHidden: false, bodyMeshes: [], owner: createOwner(track), kit: null, kitKey: "", texture: null, cyclist: null, ghost: false, seen: 0, drawn: false, casts: new Map() };
    paint(record, tint);
    const look = { ...(record.look ?? lookOf(lookId)), primary: hexOf(tint) };
    record.cyclist = classic ? createClassicCyclist(look, { own: record.owner.own, uniforms, seed: lookId }) : createCyclist(look, { own: record.owner.own, uniforms, seed: lookId, texture: record.texture });
    record.cyclist.object.traverse((child) => child.isMesh && record.casts.set(child, child.castShadow));
    record.cyclist.rider.object.traverse((child) => child.isMesh && record.bodyMeshes.push(child));
    return record;
  };

  const destroy = (record) => {
    record.owner.disposeAll();
    record.kit?.disposeAll();
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

  /**
   * Shows or hides the rider's body, the bike staying. The skinned meshes themselves are hidden: their bones live under them,
   * so hiding a parent of the bones would stop the posing.
   */
  const setBody = (record, shown) => {
    if (record.bodyHidden === !shown) return;
    record.bodyHidden = !shown;
    for (const mesh of record.bodyMeshes) mesh.visible = shown;
  };

  /** The cyclist for this entry: the one in the scene, one off the free list, or a new one. */
  const acquire = (rider) => {
    const key = poolKey(rider);
    // The rider's cyclist of another style or look is dropped at once: the look changed, one cyclist stays.
    const shown = keyById.get(rider.id);
    if (shown !== undefined && shown !== key && active.has(shown)) release(active.get(shown));
    let record = active.get(key);
    if (!record) {
      record = free.get(key);
      if (record) free.delete(key);
      else record = create(rider);
      active.set(key, record);
      keyById.set(rider.id, key);
      object.add(record.cyclist.object);
    }
    paint(record, rider.tint);
    setGhost(record, rider.ghost);
    setBody(record, !rider.hideBody);
    return record;
  };

  const release = (record) => {
    active.delete(record.key);
    if (keyById.get(record.id) === record.key) keyById.delete(record.id);
    object.remove(record.cyclist.object);
    free.set(record.key, record);
    while (free.size > POOL_SIZE) {
      const [oldest] = free.keys();
      destroy(free.get(oldest));
      free.delete(oldest);
    }
  };

  /** @type {Map<string, object>} vehicles in the scene by key; the free list, oldest first */
  const vehicles = new Map();
  const freeVehicles = new Map();
  /** @type {Map<number, object>} seated riders by rider id; their free list */
  const seated = new Map();
  const freeSeated = new Map();
  const heads = new Map();

  const createSeatedRider = (id, tint) => {
    const record = { id, lookId: id, owner: createOwner(track), kit: null, kitKey: "", texture: null, rig: null, seen: 0, drawn: false, fitKey: "", fit: null };
    paint(record, tint);
    record.rig = createRider({ ...lookOf(id), primary: hexOf(tint) }, { own: record.owner.own, uniforms, texture: record.texture });
    return record;
  };

  const acquireSeated = (occupant) => {
    let record = seated.get(occupant.id);
    if (!record) {
      record = freeSeated.get(occupant.id);
      if (record) freeSeated.delete(occupant.id);
      else record = createSeatedRider(occupant.id, occupant.tint);
      seated.set(occupant.id, record);
    }
    paint(record, occupant.tint);
    return record;
  };

  const releaseSeated = (record) => {
    seated.delete(record.id);
    record.rig.object.removeFromParent();
    record.fitKey = "";
    freeSeated.set(record.id, record);
    while (freeSeated.size > SEATED_POOL_SIZE) {
      const [oldest] = freeSeated.keys();
      const gone = freeSeated.get(oldest);
      freeSeated.delete(oldest);
      gone.owner.disposeAll();
      gone.kit.disposeAll();
    }
  };

  const vehicleKey = (entry) => `${entry.id}|${entry.kind}|${entry.layout.seats.length}`;

  const createVehicleRecord = (entry) => {
    const owner = createOwner(track);
    const vehicle = createVehicle({ kind: entry.kind, layout: entry.layout, own: owner.own, uniforms });
    return { key: vehicleKey(entry), owner, vehicle, seen: 0, drawn: false, distance: 0, cranks: entry.layout.seats.map(() => 0.6), coasts: entry.layout.seats.map(() => 0), riders: [] };
  };

  const acquireVehicle = (entry) => {
    const key = vehicleKey(entry);
    let record = vehicles.get(key);
    if (!record) {
      record = freeVehicles.get(key);
      if (record) freeVehicles.delete(key);
      else record = createVehicleRecord(entry);
      vehicles.set(key, record);
      object.add(record.vehicle.object);
    }
    return record;
  };

  const destroyVehicle = (record) => {
    for (const rider of record.riders) rider.rig.object.removeFromParent();
    record.riders = [];
    record.owner.disposeAll();
  };

  const releaseVehicle = (record) => {
    vehicles.delete(record.key);
    object.remove(record.vehicle.object);
    freeVehicles.set(record.key, record);
    while (freeVehicles.size > VEHICLE_POOL_SIZE) {
      const [oldest] = freeVehicles.keys();
      destroyVehicle(freeVehicles.get(oldest));
      freeVehicles.delete(oldest);
    }
  };

  /** Eases a seat's pedals to level when the legs stop, turns them at the cadence otherwise. */
  const turnCrank = (record, i, cadence, dt) => {
    if (cadence < 1) {
      const level = Math.round(record.cranks[i] / Math.PI) * Math.PI;
      record.cranks[i] += (level - record.cranks[i]) * Math.min(1, dt * 3);
      record.coasts[i] = Math.min(1, record.coasts[i] + dt * 2);
    } else {
      record.cranks[i] -= (cadence / 60) * TAU * dt;
      record.coasts[i] = Math.max(0, record.coasts[i] - dt * 2);
    }
  };

  /** Moves, spins and seats one vehicle; the riders in it are posed on its pedals and grips. */
  const drawVehicle = (entry, frame) => {
    const record = acquireVehicle(entry);
    const { vehicle } = record;
    record.drawn = true;
    record.seen = frame.t;
    vehicle.object.visible = true;
    vehicle.object.position.fromArray(entry.position);
    orient(quaternion, entry.forward);
    vehicle.object.quaternion.copy(quaternion);
    record.distance += entry.speed * frame.dt;
    vehicle.setWheels(record.distance);
    vehicle.object.updateMatrixWorld(true);
    const feet = [];
    record.riders = [];
    entry.layout.seats.forEach((seat, i) => {
      const occupant = entry.seats[i] ?? null;
      if (!occupant) {
        turnCrank(record, i, 0, frame.dt);
        return;
      }
      const rider = acquireSeated(occupant);
      const frameOfSeat = vehicle.seatFrame(i);
      const fitKey = `${record.key}|${i}`;
      if (rider.rig.object.parent !== frameOfSeat || rider.fitKey !== fitKey) {
        frameOfSeat.add(rider.rig.object);
        const look = { ...lookOf(occupant.id), primary: hexOf(occupant.tint) };
        rider.fit = seatFit(seat, look, rider.rig.saddleFor(seatFit(seat, look)));
        rider.fitKey = fitKey;
      }
      rider.drawn = true;
      rider.seen = frame.t;
      rider.rig.object.visible = true;
      record.riders.push(rider);
      turnCrank(record, i, occupant.cadence ?? 0, frame.dt);
      feet[i] = rider.rig.poseRide(rider.fit, { crank: record.cranks[i], t: frame.t, coast: record.coasts[i] > 0.5 });
    });
    vehicle.setCranks(record.cranks, feet);
    vehicle.object.updateMatrixWorld(true);
    for (const rider of record.riders) {
      const head = rider.rig.headPos(position);
      rider.rig.object.localToWorld(head);
      heads.set(rider.id, [head.x, head.y + LABEL_LIFT, head.z]);
    }
    const hubs = entry.layout.wheels.map((hub) => hub[2]);
    addBlob(entry, Math.max(...hubs) - Math.min(...hubs) + VEHICLE_BLOB_MARGIN * 2, VEHICLE_BLOB_WIDTH[entry.kind] ?? BLOB_WIDTH);
  };

  let blobCount = 0;
  const addBlob = (rider, length = BLOB_LENGTH, width = BLOB_WIDTH) => {
    if (settings.shadows || blobCount >= BLOB_CAPACITY) return;
    position.fromArray(rider.position);
    position.y += BLOB_LIFT;
    orient(quaternion, rider.forward);
    blobs.setMatrixAt(blobCount, matrix.compose(position, quaternion, blobScale.set(length, 1, width)));
    blobCount += 1;
  };

  return {
    object,
    /** What was drawn last frame, for tests and the readout. */
    stats: () => ({ ...counts }),
    /** The full cyclist drawn for this rider id last frame, or null. */
    cyclistOf: (id) => {
      const record = active.get(keyById.get(id));
      return record?.drawn ? record.cyclist : null;
    },
    /** The vehicle asset drawn for this vehicle id last frame, or null. */
    vehicleOf: (id) => [...vehicles.values()].find((record) => record.drawn && record.key.startsWith(`${id}|`))?.vehicle ?? null,
    /** The rig of a seated rider drawn last frame, or null. */
    seatedOf: (id) => (seated.get(id)?.drawn ? seated.get(id).rig : null),
    /** World points above the head of each seated rider after the last update, for the view's labels. */
    seatHeads: () => new Map(heads),
    setEnvironment(env) {
      night = env.night ?? 0;
    },
    /** @param {{dt: number, t: number, camera: import("../../three.js").Camera, riders?: RiderEntry[], vehicles?: VehicleEntry[]}} frame */
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

      for (const record of vehicles.values()) record.drawn = false;
      for (const record of seated.values()) record.drawn = false;
      heads.clear();
      for (const entry of frame.vehicles ?? []) {
        if (entry.seats.some((seat) => seat?.me) || distance(entry) <= reach) drawVehicle(entry, frame);
      }
      for (const record of [...seated.values()]) {
        if (record.drawn) continue;
        record.rig.object.visible = false;
        if (frame.t - record.seen > POOL_DELAY) releaseSeated(record);
      }
      for (const record of [...vehicles.values()]) {
        if (record.drawn) continue;
        record.vehicle.object.visible = false;
        if (frame.t - record.seen > POOL_DELAY) releaseVehicle(record);
      }

      cheap.set(
        far.map(({ rider }) => {
          position.fromArray(rider.position);
          orient(quaternion, rider.forward);
          addBlob(rider);
          return { matrix: new THREE.Matrix4().compose(position, quaternion, scale), crank: rider.cadence > 0 ? frame.t * (rider.cadence / 60) * Math.PI * 2 + crankPhase(rider.id) : 0, tint: rider.tint };
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
      for (const record of [...vehicles.values(), ...freeVehicles.values()]) destroyVehicle(record);
      for (const record of [...seated.values(), ...freeSeated.values()]) {
        record.owner.disposeAll();
        record.kit?.disposeAll();
      }
      active.clear();
      free.clear();
      vehicles.clear();
      freeVehicles.clear();
      seated.clear();
      freeSeated.clear();
      object.clear();
      disposeAll();
    },
  };
}
