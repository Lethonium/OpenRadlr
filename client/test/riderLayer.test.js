/** Rider layer: nearest riders as full cyclists, the rest as cheap instances, kit repaint, pooling, ghosts, night lights. */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createRiderLayer } from "../public/js/view3d/scene/riderLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

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
