import assert from "node:assert/strict";
import test from "node:test";
import { transformPoint } from "../public/js/view3d/math.js";
import { MeshBuilder } from "../public/js/view3d/meshBuilder.js";
import { RIDER_GEOMETRY, WHEEL_HUBS, buildBike, buildFoot, buildPelvis, buildShoe, buildTorso, buildHead, buildUpperArm, buildForearm, ridingBodyParts, variantLook } from "../public/js/view3d/riderModel.js";

// Reference: the one-piece rider as it was before the split.
const KIT = [1, 1, 1, 1];
const SADDLE = [0.08, 0.08, 0.09];
const VISOR = [0.08, 0.08, 0.1];
function oldBikeAndBody({ skin, helmet, frame, shorts }) {
  const m = new MeshBuilder();
  const [rear] = WHEEL_HUBS;
  const front = WHEEL_HUBS[1];
  const bottomBracket = RIDER_GEOMETRY.bottomBracket;
  const seat = [0, 0.94, 0.2];
  const head = [0, 0.9, -0.36];
  m.segment(rear, bottomBracket, 0.035, 0.04, frame);
  m.segment(rear, seat, 0.03, 0.035, frame);
  m.segment(bottomBracket, seat, 0.045, 0.05, frame);
  m.segment(bottomBracket, head, 0.06, 0.06, KIT);
  m.segment(seat, head, 0.045, 0.045, frame);
  m.segment(head, front, 0.035, 0.04, frame);
  m.box(bottomBracket, [0.12, 0.1, 0.1], frame);
  m.box([0, 0.97, 0.22], [0.12, 0.04, 0.26], SADDLE);
  m.segment([0, 0.9, -0.36], [0, 0.98, -0.42], 0.04, 0.04, frame);
  m.box([0, 0.98, -0.44], [0.44, 0.035, 0.05], SADDLE);
  for (const side of [-0.2, 0.2]) m.segment([side, 0.98, -0.44], [side, 0.88, -0.5], 0.035, 0.035, SADDLE);
  const hip = RIDER_GEOMETRY.hip;
  const chest = [0, 1.28, -0.16];
  const shoulder = [0, 1.36, -0.3];
  m.segment(hip, chest, 0.34, 0.22, KIT);
  m.segment(chest, shoulder, 0.38, 0.22, KIT);
  m.box([0, 1.02, 0.16], [0.32, 0.12, 0.2], shorts);
  for (const side of [-0.18, 0.18]) {
    const elbow = [side * 1.08, 1.17, -0.38];
    const hand = [side * 1.1, 0.99, -0.46];
    m.segment([side, 1.34, -0.28], elbow, 0.1, 0.1, KIT);
    m.segment(elbow, hand, 0.08, 0.08, skin);
  }
  m.box([0, 1.46, -0.36], [0.12, 0.08, 0.1], skin);
  m.ellipsoid([0, 1.53, -0.4], [0.1, 0.11, 0.11], skin, 3, 6);
  m.ellipsoid([0, 1.6, -0.38], [0.13, 0.09, 0.17], helmet, 3, 7);
  m.box([0, 1.53, -0.5], [0.18, 0.04, 0.03], VISOR);
  return m.build();
}

const vertices = (mesh, model = null) => {
  const out = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
    out.push(model ? transformPoint(model, p) : p);
  }
  return out;
};
const sorted = (list) => list.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

test("the riding pose matches the old one-piece rider", () => {
  for (const index of [0, 5]) {
    const look = variantLook(index);
    const meshes = {
      pelvis: buildPelvis(look),
      torso: buildTorso(look),
      head: buildHead(look),
      upperArmL: buildUpperArm(look, -1),
      upperArmR: buildUpperArm(look, 1),
      forearmL: buildForearm(look, -1),
      forearmR: buildForearm(look, 1),
    };
    const posed = vertices(buildBike(look));
    for (const { mesh, model } of ridingBodyParts(look)) posed.push(...vertices(meshes[mesh], model));
    const reference = vertices(oldBikeAndBody(look));
    assert.equal(posed.length, reference.length);
    const a = sorted(posed);
    const b = sorted(reference);
    for (let i = 0; i < a.length; i += 1) {
      for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(a[i][k] - b[i][k]) < 0.001, `vertex ${i} axis ${k}: ${a[i][k]} vs ${b[i][k]}`);
    }
  }
});

test("off the bike the shoe stands on its sole, without the pedal", () => {
  // The riding foot keeps its pedal under the ball of the foot; the shoe alone reaches no lower than its sole.
  const lowest = (mesh) => Math.min(...vertices(mesh).map((p) => p[1]));
  assert.deepEqual([lowest(buildShoe()).toFixed(3), lowest(buildFoot()) < RIDER_GEOMETRY.ball[1]], ["-0.060", true]);
});
