/** Tandem and beer bike assets: wheels on the ground, seated riders reaching the pedals and grips. */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createOwner } from "../public/js/view3d/assets/owner.js";
import { lookOf } from "../public/js/view3d/assets/riders/look.js";
import { createRider } from "../public/js/view3d/assets/riders/rider.js";
import { createVehicle, seatFit } from "../public/js/view3d/assets/riders/vehicles.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { vehicleLayout } from "../public/js/view3d/vehicleModel.js";
import { WORKBENCH_ASSETS } from "../public/js/workbenchState.js";

const uniforms = createSharedUniforms();
const KINDS = [["tandem", 2], ["beer_bike", 7]];
const build = (kind, seats) => {
  const layout = vehicleLayout(kind, seats);
  return { layout, vehicle: createVehicle({ kind, layout, own: createOwner().own, uniforms }) };
};
const world = (object, point) => point.applyMatrix4(object.matrixWorld);

test("wheels touch the ground", () => {
  for (const [kind, seats] of KINDS) {
    const { layout, vehicle } = build(kind, seats);
    vehicle.object.updateMatrixWorld(true);
    let wheels = 0;
    vehicle.object.traverse((group) => {
      if (!group.name.startsWith("wheel")) return;
      wheels += 1;
      let lowest = Infinity;
      const point = new THREE.Vector3();
      group.traverse((child) => {
        if (!child.isMesh) return;
        const position = child.geometry.attributes.position;
        for (let i = 0; i < position.count; i += 1) lowest = Math.min(lowest, world(child, point.fromBufferAttribute(position, i)).y);
      });
      assert.ok(Math.abs(lowest) <= 0.01, `${kind}: wheel bottom at ${lowest}`);
    });
    assert.equal(wheels, layout.wheels.length, kind);
  }
});

test("seated riders reach pedals and grips", () => {
  for (const [kind, seats] of KINDS) {
    const { layout, vehicle } = build(kind, seats);
    vehicle.object.updateMatrixWorld(true);
    layout.seats.forEach((seat, i) => {
      const look = lookOf(i + 3);
      const rig = createRider(look, { own: createOwner().own, uniforms });
      const frame = vehicle.seatFrame(i);
      frame.add(rig.object);
      const base = seatFit(seat, look);
      const fit = seatFit(seat, look, rig.saddleFor(base));
      const crank = 0.6;
      rig.poseRide(fit, { crank });
      vehicle.setCranks(layout.seats.map(() => crank));
      vehicle.object.updateMatrixWorld(true);
      const bone = rig.mesh.skeleton.bones.find((one) => one.name === "foot_R");
      const palmBone = rig.mesh.skeleton.bones.find((one) => one.name === "hand_R");
      const along = (b, length) => rig.boneWorld(b.name, new THREE.Vector3()).applyMatrix4(rig.object.matrixWorld).addScaledVector(new THREE.Vector3(0, 1, 0).transformDirection(b.matrixWorld), length);
      const pedal = vehicle.pedals(i)[1].getWorldPosition(new THREE.Vector3());
      assert.ok(along(bone, 0.1717).distanceTo(pedal) < 0.04, `${kind} seat ${i}: foot ${along(bone, 0.1717).distanceTo(pedal)} from the pedal`);
      const palm = along(palmBone, 0.083);
      const grips = fit.grips.flat.map((grip) => world(frame, grip.clone()));
      const nearest = Math.min(...grips.map((grip) => grip.distanceTo(palm)));
      assert.ok(nearest < 0.06, `${kind} seat ${i}: palm ${nearest} from a grip`);
      frame.remove(rig.object);
    });
  }
});

test("seat frames face the way their riders sit", () => {
  const { layout, vehicle } = build("beer_bike", 7);
  vehicle.object.updateMatrixWorld(true);
  layout.seats.forEach((seat, i) => {
    const ahead = world(vehicle.seatFrame(i), new THREE.Vector3(1, 0, 0)).sub(world(vehicle.seatFrame(i), new THREE.Vector3()));
    // vehicle frame: forward -z maps to +x; the seat's own forward is (-sin yaw, -cos yaw) there
    assert.ok(Math.abs(ahead.x - Math.cos(seat.yaw)) < 1e-6 && Math.abs(ahead.z + Math.sin(seat.yaw)) < 1e-6, `seat ${i}`);
  });
});

test("the workbench lists the tandem and the beer bike, seated and pedalling", () => {
  for (const id of ["tandem", "beer-bike"]) {
    const asset = WORKBENCH_ASSETS[id];
    assert.equal(asset.meta.id, id);
    const tracker = createTracker();
    const made = asset.create({ track: tracker.track, uniforms });
    made.update(0.1, 0.1);
    made.object.updateMatrixWorld(true);
    let skinned = 0;
    made.object.traverse((child) => child.isSkinnedMesh && (skinned += 1));
    assert.equal(skinned, id === "tandem" ? 2 : 7, id);
    made.dispose();
    assert.equal(tracker.live(), 0, id);
  }
});
