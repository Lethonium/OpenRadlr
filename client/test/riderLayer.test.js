/** Rider layer: nearest riders as full cyclists, the rest as cheap instances, kit repaint, pooling, ghosts, night lights. */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createRiderLayer } from "../public/js/view3d/scene/riderLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { vehicleLayout } from "../public/js/view3d/vehicleModel.js";

const make = (level = "high") => {
  const tracker = createTracker();
  const layer = createRiderLayer({ settings: qualitySettings(level), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const camera = new THREE.PerspectiveCamera();
let clock = 0;
const frame = (riders, dt = 0.1) => {
  clock += dt;
  return { dt, t: clock, camera, focus: [0, 0, 0], riders };
};
const entry = (id, distance, extra = {}) => ({
  id, me: false, position: [distance, 0, 0], forward: [0, 0, -1], cadence: 80, speed: 8, grade: 0, tint: [0.5, 0.5, 0.5], ghost: false, ...extra,
});
const SOLID_ID = Array.from({ length: 200 }, (_, id) => id + 1).find((id) => lookOf(id).pattern === "solid");

/** The kit texture's pixel (linear-free bytes) at the middle of the torso region. */
function torsoPixel(cyclist) {
  let texture;
  cyclist.object.traverse((child) => {
    if (child.material?.map?.isDataTexture) texture = child.material.map;
  });
  const { data, width } = texture.image;
  const at = ((width / 4) * width + width / 4) * 4; // v 0 is row 0 after the flip; torso centre is u = v = 0.25
  return [data[at], data[at + 1], data[at + 2]];
}

test("the nearest riders are full, the rest cheap", () => {
  const { layer } = make("high");
  const riders = Array.from({ length: 20 }, (_, i) => entry(i + 1, 10 + i * 10));
  riders[14].me = true; // 160 m
  layer.update(frame(riders));
  assert.deepEqual({ full: layer.stats().full, cheap: layer.stats().cheap }, { full: 8, cheap: 12 });
  assert.ok(layer.cyclistOf(15), "me is full");
  assert.ok(layer.cyclistOf(1), "the nearest is full");
  assert.equal(layer.cyclistOf(20), null);
});

test("cheap riders at the same cadence pedal out of step", () => {
  const { layer } = make("high");
  layer.update(frame(Array.from({ length: 40 }, (_, i) => entry(i + 1, 10 + i * 5))));
  const poses = [];
  layer.object.traverse((child) => {
    if (child.isInstancedMesh && child.name.includes("jersey") && child.count > 0) poses.push(child.name);
  });
  assert.ok(poses.length >= 3, `cheap riders use ${poses.length} crank poses`);
});

test("riders past the reach are not drawn", () => {
  const { layer } = make("low");
  layer.update(frame([entry(1, 200), entry(2, 400)]));
  assert.equal(layer.stats().full + layer.stats().cheap, 1);
});

test("my rider is full even at Low", () => {
  const { layer } = make("low");
  layer.update(frame([entry(1, 5), entry(2, 6), entry(3, 7), entry(4, 100, { me: true })]));
  assert.equal(layer.stats().full, 1);
  assert.ok(layer.cyclistOf(4));
});

test("the jersey follows the tint and repaints when it changes", () => {
  const { layer } = make("high");
  layer.update(frame([entry(SOLID_ID, 10, { tint: [1, 0, 0] })]));
  const red = torsoPixel(layer.cyclistOf(SOLID_ID));
  assert.ok(red[0] > 200 && red[1] < 60 && red[2] < 60, `red ${red}`);
  layer.update(frame([entry(SOLID_ID, 10, { tint: [0, 0, 1] })]));
  const blue = torsoPixel(layer.cyclistOf(SOLID_ID));
  assert.ok(blue[2] > 200 && blue[0] < 60 && blue[1] < 60, `blue ${blue}`);
});

test("a rider faces along its forward", () => {
  const { layer } = make("high");
  const forwards = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-0.6, 0, 0.8]];
  layer.update(frame(forwards.map((forward, i) => entry(i + 1, 10 + i, { forward }))));
  forwards.forEach((forward, i) => {
    const cyclist = layer.cyclistOf(i + 1);
    cyclist.object.updateMatrixWorld(true);
    const front = cyclist.bike.frontWheel.getWorldPosition(new THREE.Vector3());
    const rear = cyclist.bike.rearWheel.getWorldPosition(new THREE.Vector3());
    const direction = front.sub(rear).normalize();
    assert.ok(direction.distanceTo(new THREE.Vector3(...forward)) < 0.01, `forward ${forward}: ${direction.toArray()}`);
  });
});

test("a rider on a slope is pitched with the road", () => {
  const { layer } = make("high");
  const forward = new THREE.Vector3(0, 0.1, -1).normalize().toArray();
  layer.update(frame([entry(1, 10, { forward })]));
  const cyclist = layer.cyclistOf(1);
  cyclist.object.updateMatrixWorld(true);
  const direction = cyclist.bike.frontWheel.getWorldPosition(new THREE.Vector3()).sub(cyclist.bike.rearWheel.getWorldPosition(new THREE.Vector3())).normalize();
  assert.ok(direction.distanceTo(new THREE.Vector3(...forward)) < 0.01);
});

test("a ghost is see-through", () => {
  const { layer } = make("high");
  layer.update(frame([entry(1, 10, { ghost: true }), entry(2, 12)]));
  assert.deepEqual({ ...layer.stats() }, { full: 1, cheap: 0, ghosts: 1 });
  let seen = 0;
  layer.cyclistOf(1).object.traverse((child) => {
    if (!child.material) return;
    seen += 1;
    assert.equal(child.castShadow, false);
    for (const material of [].concat(child.material)) {
      assert.equal(material.transparent, true);
      assert.equal(material.opacity, 0.38);
    }
  });
  assert.ok(seen > 0);
  layer.cyclistOf(2).object.traverse((child) => {
    if (child.material) assert.equal([].concat(child.material)[0].transparent, false);
  });
});

test("a rider that leaves and returns does not leak", () => {
  const { layer, tracker } = make("high");
  const there = [entry(5, 10, { tint: [1, 0, 0] })];
  layer.update(frame(there));
  const baseline = tracker.live();
  for (let i = 0; i < 10; i += 1) {
    layer.update(frame([]));
    layer.update(frame(there));
  }
  assert.equal(tracker.live(), baseline);
  for (let i = 0; i < 10; i += 1) {
    layer.update(frame([], 3)); // long enough to be pooled
    layer.update(frame(there));
  }
  assert.equal(tracker.live(), baseline);
});

test("bike lights glow at night only", () => {
  const { layer } = make("high");
  layer.setEnvironment({ night: 1 });
  layer.update(frame([entry(1, 10)]));
  assert.ok(layer.cyclistOf(1).lights > 0);
  layer.setEnvironment({ night: 0 });
  layer.update(frame([entry(1, 10)]));
  assert.equal(layer.cyclistOf(1).lights, 0);
});

test("without shadows a contact blob sits under each rider", () => {
  const low = make("low").layer;
  low.update(frame([entry(1, 10), entry(2, 20), entry(3, 30)]));
  assert.equal(low.object.getObjectByName("rider-blobs").count, 3);
  const high = make("high").layer;
  high.update(frame([entry(1, 10), entry(2, 20), entry(3, 30)]));
  assert.equal(high.object.getObjectByName("rider-blobs"), undefined);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make("high");
  layer.update(frame(Array.from({ length: 12 }, (_, i) => entry(i + 1, 10 + i * 10, { ghost: i === 3, tint: [1, 0, i / 12] }))));
  layer.update(frame([], 3));
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

// ---- vehicles

const vehicleEntry = (id, kind, seatCount, seats, extra = {}) => ({
  id, kind, layout: vehicleLayout(kind, seatCount), position: [10, 0, 0], forward: [0, 0, -1], speed: 5, seats, ...extra,
});
const occupant = (id, extra = {}) => ({ id, me: false, cadence: 80, tint: [0.5, 0.2, 0.2], ...extra });
const vframe = (vehicles, dt = 0.1) => ({ ...frame([], dt), vehicles });
const beer = (seats, extra) => vehicleEntry(1, "beer_bike", 7, seats, extra);

test("a vehicle carries its riders", () => {
  const { layer } = make("high");
  layer.update(vframe([beer([occupant(11), null, occupant(12), null, null, occupant(13), null])]));
  const vehicle = layer.vehicleOf(1);
  assert.ok(vehicle, "the vehicle is drawn");
  let rigs = 0;
  for (let i = 0; i < 7; i += 1) {
    const here = vehicle.seatFrame(i).children.filter((child) => child.visible && child.type === "Group" && child.getObjectByProperty("isSkinnedMesh", true));
    rigs += here.length;
    assert.equal(here.length, [0, 2, 5].includes(i) ? 1 : 0, `seat ${i}`);
  }
  assert.equal(rigs, 3);
  assert.deepEqual([11, 12, 13].map((id) => Boolean(layer.seatedOf(id))), [true, true, true]);
  assert.equal(layer.seatedOf(14), null);
  vehicle.object.updateMatrixWorld(true);
  const ahead = new THREE.Vector3(1, 0, 0).transformDirection(vehicle.object.matrixWorld);
  assert.ok(Math.abs(ahead.x) < 1e-6 && Math.abs(ahead.z + 1) < 1e-6, `faces ${ahead.toArray()}`);
  assert.equal(layer.stats().full, 0, "seated riders are not counted as full");
});

test("seated riders get a label point above their heads", () => {
  const { layer } = make("high");
  layer.update(vframe([beer([occupant(11), null, occupant(12), null, null, null, null])]));
  const heads = layer.seatHeads();
  assert.deepEqual([...heads.keys()].sort(), [11, 12]);
  for (const point of heads.values()) assert.ok(point.every(Number.isFinite) && point[1] > 1.5, `head at ${point}`);
});

test("vehicle wheels turn with speed", () => {
  const { layer } = make("high");
  layer.update(vframe([beer([occupant(11), null, null, null, null, null, null], { speed: 5 })], 1));
  const wheel = layer.vehicleOf(1).object.getObjectByName("wheel-0");
  assert.ok(Math.abs(wheel.rotation.z + 5 / vehicleLayout("beer_bike", 7).wheelRadius) < 1e-6, `turned ${wheel.rotation.z}`);
});

test("vehicles leave and return without leaking", () => {
  const { layer, tracker } = make("high");
  const there = [beer([occupant(11), null, occupant(12), null, null, occupant(13), null])];
  layer.update(vframe(there));
  const baseline = tracker.live();
  for (let i = 0; i < 10; i += 1) {
    layer.update(vframe([]));
    layer.update(vframe(there));
  }
  assert.equal(tracker.live(), baseline);
  for (let i = 0; i < 10; i += 1) {
    layer.update(vframe([], 3)); // long enough to be pooled
    layer.update(vframe(there));
  }
  assert.equal(tracker.live(), baseline);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("a vehicle past the reach is not drawn unless I am aboard", () => {
  const { layer } = make("high");
  layer.update(vframe([beer([occupant(11), null, null, null, null, null, null], { position: [900, 0, 0] })]));
  assert.equal(layer.vehicleOf(1), null);
  layer.update(vframe([beer([occupant(11, { me: true }), null, null, null, null, null, null], { position: [900, 0, 0] })]));
  assert.ok(layer.vehicleOf(1));
});

// ---------- studio entries: lookId and hideBody

const riderMeshes = (cyclist) => {
  const found = [];
  cyclist.rider.object.traverse((child) => child.isMesh && found.push(child));
  return found;
};
const bikeMeshes = (cyclist) => {
  const found = [];
  cyclist.bike.object.traverse((child) => child.isMesh && found.push(child));
  return found;
};
const shown = (object) => {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
};

test("hideBody keeps the bike", () => {
  const { layer } = make();
  layer.update(frame([entry(1, 3, { me: true, hideBody: true })]));
  const cyclist = layer.cyclistOf(1);
  assert.ok(riderMeshes(cyclist).length > 0 && riderMeshes(cyclist).every((mesh) => !mesh.visible));
  assert.ok(bikeMeshes(cyclist).every((mesh) => shown(mesh)));
  layer.update(frame([entry(1, 3, { me: true })]));
  assert.ok(riderMeshes(layer.cyclistOf(1)).every((mesh) => shown(mesh)), "the body comes back");
});

test("two coaches are two cyclists", () => {
  const { layer } = make();
  layer.update(frame([entry(-1, 3, { lookId: 0 }), entry(-2, 5, { lookId: 0 })]));
  assert.equal(layer.stats().full, 2);
  assert.ok(layer.cyclistOf(-1) && layer.cyclistOf(-2));
  assert.notEqual(layer.cyclistOf(-1), layer.cyclistOf(-2));
});

test("lookId picks the look", () => {
  const { layer } = make();
  layer.update(frame([entry(0, 3), entry(-1, 5, { lookId: 0 }), entry(2, 7)]));
  const kit = (id) => {
    let map;
    layer.cyclistOf(id).object.traverse((child) => child.material?.map?.isDataTexture && (map = child.material.map));
    return Array.from(map.image.data.slice(0, 4096));
  };
  assert.deepEqual(kit(-1), kit(0));
  assert.notDeepEqual(kit(2), kit(0));
});

// ---------- the classic rider style

const isClassic = (cyclist) => typeof cyclist.setPrimary === "function";

test("a classic entry is drawn as the classic cyclist, others as the rig", () => {
  const { layer } = make();
  layer.update(frame([entry(1, 3, { me: true, classic: true }), entry(2, 6)]));
  assert.ok(isClassic(layer.cyclistOf(1)), "mine is classic");
  assert.ok(!isClassic(layer.cyclistOf(2)), "the other keeps the new look");
});

test("flipping the style swaps the cyclist and releases the old one without a leak", () => {
  const { layer, tracker } = make();
  const baseline = () => tracker.live();
  layer.update(frame([entry(1, 3, { me: true })]));
  const rig = layer.cyclistOf(1);
  layer.update(frame([entry(1, 3, { me: true, classic: true })]));
  const classic = layer.cyclistOf(1);
  assert.ok(isClassic(classic) && classic !== rig);
  assert.equal(rig.object.parent, null, "the old one left the scene");
  layer.update(frame([entry(1, 3, { me: true })]));
  const settled = baseline();
  for (let i = 0; i < 10; i += 1) {
    layer.update(frame([entry(1, 3, { me: true, classic: true })]));
    layer.update(frame([entry(1, 3, { me: true })]));
  }
  assert.equal(baseline(), settled, "flipping back and forth rebuilds nothing");
});

test("hideBody hides the classic rider's body, the bike stays", () => {
  const { layer } = make();
  layer.update(frame([entry(1, 3, { me: true, classic: true, hideBody: true })]));
  const cyclist = layer.cyclistOf(1);
  assert.ok(riderMeshes(cyclist).length > 0 && riderMeshes(cyclist).every((mesh) => !mesh.visible));
  assert.ok(bikeMeshes(cyclist).every((mesh) => shown(mesh)));
});

// ---------- chosen looks (#25)

test("a chosen look is drawn, and a new look rebuilds the rider's cyclist", () => {
  const { layer } = make();
  const look = { ...lookOf(1), bike: "city", glasses: false };
  layer.update(frame([entry(1, 3, { look, lookKey: "a" })]));
  const first = layer.cyclistOf(1);
  layer.update(frame([entry(1, 3, { look: { ...look, bike: "road" }, lookKey: "b" })]));
  const second = layer.cyclistOf(1);
  assert.notEqual(second, first);
  assert.equal(first.object.parent, null, "the old look left the scene");
  layer.update(frame([entry(1, 3, { look: { ...look, bike: "road" }, lookKey: "b" })]));
  assert.equal(layer.cyclistOf(1), second, "the same look keeps its cyclist");
});
