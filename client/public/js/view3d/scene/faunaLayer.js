/**
 * The island's animals as instanced meshes: one for each kind's body and one for each of its limbs, every instance
 * an animal. Poses come from `faunaMotion.js`; an animal is re-posed only while within `settings.animals.animateReach`
 * of the camera (every animal starts in its pose at t = 0), the others keep their last pose.
 * Wild animals step away when the camera comes within `FLEE` metres. At night every kind but the dolphins is hidden;
 * birds and butterflies are also hidden while it rains or snows.
 */
import * as THREE from "../../three.js";
import { CREATURES } from "../assets/creatures/index.js";
import { heightSampler } from "./grassField.js";
import { butterflyPose, dolphinPose, flockPose, grazePose, limbAngle } from "./faunaMotion.js";
import { createOwner } from "./tracker.js";

/** Wild animals flee from a camera this close (metres), up to `FLEE_MAX` away from where they grazed, at this many times their walking speed. */
const FLEE = 30;
const FLEE_MAX = 12;
const FLEE_RUN = 3;
/** How far a wild animal wanders from where the plan put it. */
const WILD_RADIUS = 3;
/** Share of night above which the walkers sleep; strength of precipitation above which birds and butterflies shelter. */
const DARK = 0.5;
const SHELTER = 0.3;

/** Kinds with coat variants, and how many coats each has (the animal's plan seed picks one). */
const COATS = 3;
const COATED = Object.freeze(["cow", "horse", "pig", "sheep", "chicken"]);

/** @param {string} id */
const hiddenAtNight = (id) => id !== "dolphin";
/** Dolphins to a pod, and how far apart they swim (metres). */
const POD = 3;
const POD_SPACING = 5;
const shelters = (id) => id === "bird" || id === "butterfly";

/** Every animal the plan lists, as `{kind, type, entry, seed}` records. */
function gather(fauna) {
  const animals = [];
  for (const herd of fauna?.herds ?? []) {
    for (let i = 0; i < herd.count; i += 1) animals.push({ kind: herd.kind, type: "herd", entry: herd, seed: herd.seed + i * 31, index: i });
  }
  for (const wild of fauna?.wild ?? []) animals.push({ kind: wild.kind, type: "wild", entry: { ...wild, radius: WILD_RADIUS }, seed: wild.seed, index: 0, fleeX: 0, fleeZ: 0 });
  for (const flock of fauna?.flocks ?? []) {
    for (let i = 0; i < flock.count; i += 1) animals.push({ kind: "bird", type: "flock", entry: flock, seed: flock.seed, index: i });
  }
  for (const spot of fauna?.butterflies ?? []) animals.push({ kind: "butterfly", type: "butterfly", entry: spot, seed: spot.seed, index: 0 });
  // A pod swims the same loop, a few metres apart and out of step, so a bay shows several backs at once.
  for (const spot of fauna?.dolphins ?? []) {
    for (let i = 0; i < POD; i += 1) {
      const entry = { ...spot, x: spot.x + POD_SPACING * Math.cos(i * 2.1), z: spot.z + POD_SPACING * Math.sin(i * 2.1), seed: spot.seed + i * 977 };
      animals.push({ kind: "dolphin", type: "dolphin", entry, seed: entry.seed, index: i });
    }
  }
  return animals;
}

/**
 * @param {{fauna?: import("../../world/plan/fauna.js").Fauna}|undefined} plan
 * @param {{season?: string, settings: import("../quality.js").QualitySettings, uniforms?: object, track: import("./tracker.js").Tracker["track"], ground?: {near: object}}} options
 */
export function createFaunaLayer(plan, { season = "summer", settings, track, ground }) {
  const { own, disposeAll } = createOwner(track);
  const object = new THREE.Group();
  object.name = "fauna";
  const heightAt = ground ? heightSampler(ground.near) : () => 0;
  const water = ground?.near.water ?? 0;
  const material = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  const reach2 = settings.animals.animateReach ** 2;

  const animals = gather(plan?.fauna);
  const byKind = new Map();
  for (const animal of animals) {
    animal.coat = COATED.includes(animal.kind) ? animal.seed % COATS : 0;
    const key = `${animal.kind}:${animal.coat}`;
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key).push(animal);
  }

  /** @type {Map<string, {id: string, parts: ReturnType<typeof CREATURES.cow.parts>, meshes: THREE.InstancedMesh[], limbs: object[], animals: object[]}>} */
  const kinds = new Map();
  for (const [key, list] of byKind) {
    const [id, coatText] = key.split(":");
    const coat = Number(coatText);
    const label = coat ? `${id}-${coat}` : id;
    const parts = CREATURES[id].parts({ season, detail: settings.detail, seed: 1 + coat, own });
    const make = (geometry, name) => {
      const mesh = own(new THREE.InstancedMesh(geometry, material, list.length));
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = settings.shadows;
      object.add(mesh);
      return mesh;
    };
    const body = make(parts.body, `${label}-body`);
    const limbs = parts.limbs.map((limb, k) => {
      const [px, py, pz] = limb.pivot;
      return { limb, mesh: make(limb.geometry, `${label}-limb-${k}`), to: new THREE.Matrix4().makeTranslation(px, py, pz), back: new THREE.Matrix4().makeTranslation(-px, -py, -pz) };
    });
    kinds.set(key, { id, parts, body, limbs, animals: list });
  }

  const dummy = new THREE.Object3D();
  dummy.rotation.order = "YXZ";
  const base = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const limbMatrix = new THREE.Matrix4();

  /** The animal's pose at `t`, with its height and (for wild ones) its flight from the camera added. */
  function poseOf(animal, kind, t, dt, camera) {
    const { entry } = animal;
    const speed = kind.parts.speed;
    let pose;
    let y;
    if (animal.type === "flock") {
      pose = flockPose(entry, animal.index, t, speed);
      y = heightAt(entry.x, entry.z) + entry.altitude + pose.y;
    } else if (animal.type === "dolphin") {
      pose = dolphinPose(entry, t);
      y = water + pose.y;
    } else if (animal.type === "butterfly") {
      pose = butterflyPose(entry, t);
      y = heightAt(pose.x, pose.z) + pose.y;
    } else {
      pose = grazePose({ x: entry.x, z: entry.z, radius: entry.radius, seed: animal.seed, speed }, t);
      if (animal.type === "wild") {
        const dx = pose.x + animal.fleeX - camera.x;
        const dz = pose.z + animal.fleeZ - camera.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = speed * FLEE_RUN * dt;
        const away = d < FLEE;
        const length = Math.hypot(animal.fleeX, animal.fleeZ);
        if (away && length < FLEE_MAX) {
          animal.fleeX += (dx / d) * step;
          animal.fleeZ += (dz / d) * step;
        } else if (!away && length > 0) {
          const back = Math.min(1, (speed * dt) / length);
          animal.fleeX -= animal.fleeX * back;
          animal.fleeZ -= animal.fleeZ * back;
        }
        if (away) pose = { ...pose, yaw: Math.atan2(dx, dz), legs: 1, gait: t * speed * FLEE_RUN * 4 };
        pose = { ...pose, x: pose.x + animal.fleeX, z: pose.z + animal.fleeZ };
      }
      y = heightAt(pose.x, pose.z);
    }
    return { pose, y };
  }

  /** Writes the animal's body and limb matrices. */
  function place(kind, animal, i, t, dt, camera) {
    const { pose, y } = poseOf(animal, kind, t, dt, camera);
    dummy.position.set(pose.x, y, pose.z);
    dummy.rotation.set(pose.pitch, pose.yaw, pose.roll);
    dummy.updateMatrix();
    base.copy(dummy.matrix);
    kind.body.setMatrixAt(i, base);
    for (const { limb, mesh, to, back } of kind.limbs) {
      const angle = limbAngle(limb, pose);
      if (limb.swing === "wing") turn.makeRotationZ(angle);
      else turn.makeRotationX(angle);
      limbMatrix.multiplyMatrices(base, to).multiply(turn).multiply(back);
      mesh.setMatrixAt(i, limbMatrix);
    }
  }
  const flush = (kind) => {
    kind.body.instanceMatrix.needsUpdate = true;
    for (const { mesh } of kind.limbs) mesh.instanceMatrix.needsUpdate = true;
  };
  // Every animal starts in its pose at t = 0, so far herds are drawn too; only those near the camera move afterwards.
  const nowhere = { x: 1e9, z: 1e9 };
  for (const kind of kinds.values()) {
    kind.animals.forEach((animal, i) => place(kind, animal, i, 0, 0, nowhere));
    flush(kind);
  }

  const writes = { posed: 0 };
  let night = 0;
  let falling = 0;
  const applyVisibility = () => {
    for (const kind of kinds.values()) {
      const visible = !(night > DARK && hiddenAtNight(kind.id)) && !(falling > SHELTER && shelters(kind.id));
      kind.body.visible = visible;
      for (const { mesh } of kind.limbs) mesh.visible = visible;
    }
  };

  return {
    object,
    /** Animals in the plan, instanced mesh groups (one per kind and coat), and how many `update` posed last time. */
    groups: kinds.size,
    total: animals.length,
    get posed() {
      return writes.posed;
    },
    groundAt: heightAt,
    update(frame) {
      writes.posed = 0;
      const camera = frame.camera.position;
      for (const kind of kinds.values()) {
        if (!kind.body.visible) continue;
        let touched = false;
        kind.animals.forEach((animal, i) => {
          const { x, z } = animal.entry;
          if ((x - camera.x) ** 2 + (z - camera.z) ** 2 > reach2 + (animal.entry.radius ?? 0) ** 2 + (animal.type === "dolphin" ? 400 : 0)) return;
          touched = true;
          writes.posed += 1;
          place(kind, animal, i, frame.t, frame.dt, camera);
        });
        if (touched) flush(kind);
      }
    },
    setEnvironment(env) {
      night = env.night;
      falling = env.precipitation;
      applyVisibility();
    },
    dispose() {
      object.clear();
      disposeAll();
    },
  };
}
