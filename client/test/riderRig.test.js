import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { KIT_ATLAS, kitTexture, paintKit } from "../public/js/view3d/assets/riders/kitPainter.js";
import { RIG_BONES, create, createRider, meta } from "../public/js/view3d/assets/riders/rider.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const SIZE = 256;
const STAND_HEIGHT = 1.78;

/** A look of the plan's reference rider (1.78 m, 70 kg), the id only picks colours. */
const look = (changes = {}) => ({ ...lookOf(1), height: STAND_HEIGHT, weight: 70, ...changes });
const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);

/** The pixel of a painted kit at atlas region `region`, fractions (u, v) of it, as [r, g, b, a]. */
function pixelAt(pixels, region, u, vv, size = SIZE) {
  const x = Math.min(size - 1, Math.floor((region[0] + (region[1] - region[0]) * u) * size));
  const y = Math.min(size - 1, Math.floor((1 - (region[2] + (region[3] - region[2]) * vv)) * size));
  const at = (y * size + x) * 4;
  return Array.from(pixels.subarray(at, at + 4));
}

/**
 * The contact points of the reference's `geometryFor("road", { scale: 1 })`, as plain data: a 1.78 m rider's bike,
 * with the saddle at the height the rider's own `saddleFor` gives (bisected for a 30 degree knee bend).
 */
const SADDLE_HEIGHT = 0.6641;
function roadFit() {
  const bb = v(0, 0.266);
  const sd = v(-0.28402, 0.95882);
  return {
    T: { grip: "hoods" },
    bb,
    sd,
    saddle: bb.clone().addScaledVector(sd, SADDLE_HEIGHT),
    grips: {
      tops: [v(0.46842, 0.87361, -0.12), v(0.46842, 0.87361, 0.12)],
      hoods: [v(0.54342, 0.89861, -0.21), v(0.54342, 0.89861, 0.21)],
      drops: [v(0.47842, 0.75861, -0.215), v(0.47842, 0.75861, 0.215)],
    },
    crankLen: 0.1725,
    q: 0.105,
  };
}

/** Where a bone's own y axis, `length` metres along it, ends: the ball of a foot, the palm of a hand. */
function along(rig, name, length) {
  rig.object.updateMatrixWorld(true);
  const bone = rig.mesh.skeleton.bones.find((one) => one.name === name);
  const axis = v(0, 1, 0).transformDirection(bone.matrixWorld);
  return rig.boneWorld(name, v(0, 0, 0)).addScaledVector(axis, length);
}

/** Every `step`th skinned vertex of the rider in world space. */
function skinnedPoints(rig, step = 7) {
  rig.object.updateMatrixWorld(true);
  rig.mesh.skeleton.update();
  const points = [];
  const position = rig.mesh.geometry.attributes.position;
  for (let i = 0; i < position.count; i += step) points.push(rig.mesh.getVertexPosition(i, v(0, 0, 0)).applyMatrix4(rig.mesh.matrixWorld));
  return points;
}

const build = (made = look(), owner = createOwner()) => createRider(made, { own: owner.own, uniforms: createSharedUniforms() });

test("paintKit fills the jersey with the primary colour", () => {
  const pixels = paintKit(look({ pattern: "solid", primary: "#ff0000" }), SIZE);
  assert.equal(pixels.length, SIZE * SIZE * 4);
  assert.deepEqual(pixelAt(pixels, KIT_ATLAS.torso, 0.5, 0.7), [255, 0, 0, 255]);
});

test("a skinsuit paints the shorts area with the primary", () => {
  const pixels = paintKit(look({ kit: "skinsuit", pattern: "solid", primary: "#ff0000", shorts: "#00ff00" }), SIZE);
  assert.deepEqual(pixelAt(pixels, KIT_ATLAS.torso, 0.5, 0.03), [255, 0, 0, 255]);
});

test("a road kit paints the bib below the hem in the shorts colour", () => {
  const pixels = paintKit(look({ kit: "road", pattern: "solid", primary: "#ff0000", shorts: "#00ff00" }), SIZE);
  assert.deepEqual(pixelAt(pixels, KIT_ATLAS.torso, 0.5, 0.01), [0, 255, 0, 255]);
});

test("patterns change the jersey, and painting is repeatable", () => {
  const hoops = paintKit(look({ pattern: "hoops" }), SIZE);
  const solid = paintKit(look({ pattern: "solid" }), SIZE);
  assert.notDeepEqual(hoops, solid);
  assert.deepEqual(paintKit(look({ pattern: "hoops" }), SIZE), hoops);
});

test("every pattern and kit paints a full opaque atlas", () => {
  for (const pattern of ["solid", "hoops", "band", "sash", "panels", "chevron", "dots", "fade"]) {
    for (const kit of ["road", "long", "skinsuit", "casual"]) {
      const pixels = paintKit(look({ pattern, kit }), 64);
      for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, `${kit} ${pattern}`);
    }
  }
});

test("kitTexture is an owned sRGB data texture", () => {
  const made = [];
  const texture = kitTexture(look(), (resource) => (made.push(resource), resource));
  assert.ok(texture.isDataTexture);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.deepEqual(made, [texture]);
});

test("the rig has the 19 bones of the reference", () => {
  assert.equal(RIG_BONES.length, 19);
  const rig = build(lookOf(1));
  assert.deepEqual(rig.mesh.skeleton.bones.map((bone) => bone.name), [...RIG_BONES]);
});

test("a standing rider stands on the ground at full height", () => {
  const rig = build();
  rig.poseStand(0);
  const heights = skinnedPoints(rig).map((point) => point.y);
  assert.ok(Math.min(...heights) > -0.02 && Math.min(...heights) < 0.03, `lowest ${Math.min(...heights)}`);
  assert.ok(Math.abs(Math.max(...heights) - STAND_HEIGHT) < 0.03 * STAND_HEIGHT, `highest ${Math.max(...heights)}`);
  assert.equal(rig.height, STAND_HEIGHT);
  assert.ok(rig.eyeHeight > 0.9 * STAND_HEIGHT && rig.eyeHeight < STAND_HEIGHT);
});

test("a heavier rider is wider at the waist", () => {
  const hipWidth = (weight) => {
    const rig = build(look({ weight }));
    rig.poseStand(0);
    const points = skinnedPoints(rig, 1);
    const skinIndex = rig.mesh.geometry.attributes.skinIndex;
    const skinWeight = rig.mesh.geometry.attributes.skinWeight;
    const hips = RIG_BONES.indexOf("hips");
    const hipY = 0.53 * STAND_HEIGHT;
    // the hips ring: vertices the hips bone moves most, near hip height (the hanging arms are out of it)
    const ring = points.filter((point, i) => Math.abs(point.y - hipY) < 0.05 && skinIndex.getX(i) === hips && skinWeight.getX(i) >= 0.5);
    assert.ok(ring.length > 20, `ring of ${ring.length}`);
    return Math.max(...ring.map((point) => Math.abs(point.z)));
  };
  assert.ok(hipWidth(110) > hipWidth(60) * 1.15);
});

test("the plan's saddle height is the rider's own", () => {
  assert.ok(Math.abs(build().saddleFor(roadFit()) - SADDLE_HEIGHT) < 0.002);
});

test("riding puts the feet on the pedals and the hands on the grips", () => {
  const rig = build();
  const fit = roadFit();
  const crank = 0.6;
  const { pitchL, pitchR } = rig.poseRide(fit, { crank });
  assert.ok(Number.isFinite(pitchL) && Number.isFinite(pitchR));
  const pedal = v(fit.bb.x + Math.cos(crank) * fit.crankLen, fit.bb.y + Math.sin(crank) * fit.crankLen, fit.q);
  const ball = along(rig, "foot_R", 0.1717);
  assert.ok(ball.distanceTo(pedal) < 0.04, `foot ${ball.distanceTo(pedal)} from the pedal`);
  const palm = along(rig, "hand_R", 0.083);
  assert.ok(palm.distanceTo(fit.grips.hoods[1]) < 0.05, `hand ${palm.distanceTo(fit.grips.hoods[1])} from the grip`);
  assert.ok(rig.boneWorld("hand_L", v(0, 0, 0)).z < 0 && rig.boneWorld("hand_R", v(0, 0, 0)).z > 0);
});

test("the head position follows the pose", () => {
  const rig = build();
  rig.poseStand(0);
  const standing = rig.headPos(v(0, 0, 0)).clone();
  rig.poseRide(roadFit(), { crank: 0 });
  const riding = rig.headPos(v(0, 0, 0));
  assert.ok(standing.y > riding.y && riding.x > standing.x);
});

test("dispose frees what the rider made", () => {
  const tracker = createTracker();
  const made = [];
  const owner = createOwner((resource) => tracker.track((made.push(resource), resource)));
  const rig = build(look({ glasses: true }), owner);
  rig.poseStand(0);
  assert.ok(made.some((one) => one.isBufferGeometry) && made.some((one) => one.isMaterial) && made.some((one) => one.isTexture));
  assert.ok(tracker.live() > 0);
  owner.disposeAll();
  assert.equal(tracker.live(), 0);
});

test("the workbench pair describes and builds the rider", () => {
  assert.equal(meta.id, "rider");
  assert.equal(meta.category, "Creatures");
  const tracker = createTracker();
  const built = create({ track: tracker.track, pose: "wave" });
  assert.ok(built.object.isObject3D);
  built.update(0.1, 0.1);
  built.dispose();
  assert.equal(tracker.live(), 0);
});

/** World positions of the vertices of the head-bone extra called `name`, in the standing pose. */
function headExtra(rig, name) {
  rig.poseStand(0);
  rig.object.updateMatrixWorld(true);
  const meshes = [];
  rig.object.traverse((one) => one.name === name && meshes.push(one));
  assert.ok(meshes.length > 0, `no ${name}`);
  return meshes.flatMap((mesh) => {
    const position = mesh.geometry.attributes.position;
    return Array.from({ length: position.count }, (_, i) => v(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld));
  });
}

test("the chin straps run from the helmet to under the chin", () => {
  const rig = build();
  const points = headExtra(rig, "strap");
  const head = rig.boneWorld("head", v(0, 0, 0));
  const lowest = Math.min(...points.map((point) => point.y));
  assert.ok(lowest > head.y - 0.02 * STAND_HEIGHT, `straps hang ${(head.y - lowest).toFixed(3)} m below the jaw`);
  const low = points.filter((point) => point.y < lowest + 0.005);
  assert.ok(low.every((point) => Math.abs(point.z - head.z) < 0.03 * STAND_HEIGHT), "the straps meet under the chin");
  assert.ok(low.every((point) => point.x > head.x), "the buckle sits under the chin, in front of the neck");
});

test("the sunglasses are no wider than the head", () => {
  const rig = build(look({ glasses: true }));
  const head = rig.boneWorld("head", v(0, 0, 0));
  const widest = Math.max(...headExtra(rig, "glasses").map((point) => Math.abs(point.z - head.z)));
  assert.ok(widest < 0.056 * STAND_HEIGHT, `glasses reach ${widest.toFixed(3)} m to the side`);
});

test("hair shows below the helmet at the back of the head", () => {
  const pixels = paintKit(look({ hair: "#00ff00", skin: "light" }), SIZE);
  assert.deepEqual(pixelAt(pixels, KIT_ATLAS.head, 0.75, 0.45), [0, 255, 0, 255]);
  assert.notDeepEqual(pixelAt(pixels, KIT_ATLAS.head, 0.25, 0.45), [0, 255, 0, 255], "the face stays bare");
});

test("a heavier rider grows a belly, not a hump", () => {
  const depth = (weight) => {
    const rig = build(look({ weight }));
    rig.poseStand(0);
    const chestY = 0.66 * STAND_HEIGHT;
    const xs = skinnedPoints(rig, 1).filter((point) => Math.abs(point.y - chestY) < 0.02 && Math.abs(point.z) < 0.05).map((point) => point.x);
    return { front: Math.max(...xs), back: Math.min(...xs) };
  };
  const light = depth(70);
  const heavy = depth(120);
  const forward = heavy.front - light.front;
  const backward = light.back - heavy.back;
  assert.ok(forward > 0.02, `belly grows ${forward.toFixed(3)} m`);
  assert.ok(backward < forward * 0.5, `back grows ${backward.toFixed(3)} m, belly ${forward.toFixed(3)} m`);
});

test("every UV stays a texel inside its atlas region, so no neighbour bleeds into a seam", () => {
  const uv = build().mesh.geometry.attributes.uv;
  const texel = 1 / SIZE;
  const regions = Object.values(KIT_ATLAS);
  for (let i = 0; i < uv.count; i += 1) {
    const [u, w] = [uv.getX(i), uv.getY(i)];
    const inside = regions.some(([u0, u1, v0, v1]) => u >= u0 + texel - 1e-6 && u <= u1 - texel + 1e-6 && w >= v0 + texel - 1e-6 && w <= v1 - texel + 1e-6);
    assert.ok(inside, `uv ${u.toFixed(4)}, ${w.toFixed(4)} sits on a region edge`);
  }
});
