import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { stalkGeometry } from "../public/js/view3d/assets/nature/stalks.js";
import { CROPS } from "../public/js/view3d/assets/nature/crops.js";
import { createCropLayer } from "../public/js/view3d/scene/cropLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { QUALITY_LEVELS, qualitySettings } from "../public/js/view3d/quality.js";
import { buildGroundGrids, groundExtent } from "../public/js/view3d/world.js";
import { STALK_CROPS, STALK_STRIDE, planStalks } from "../public/js/world/plan/stalks.js";
import { VERGE, roadHalfWidth } from "../public/js/world/roads.js";
import { planOf, tinyWorld } from "./support/planFixture.js";

const world = tinyWorld();
const plan = planOf(world);
const ground = buildGroundGrids(world.terrain, groundExtent(world.terrain), { season: "summer", long: false, regions: world.regions, masks: plan.masks });
const field = (crop, extra = {}) => ({ x: 100, z: -40, width: 90, depth: 60, yaw: 0.6, crop, corners: new Float32Array(12), ...extra });
const local = (f, x, z) => {
  const [dx, dz] = [x - f.x, z - f.z];
  return [dx * Math.cos(f.yaw) + dz * Math.sin(f.yaw), -dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw)];
};
const edgeParams = (level) => {
  const { edgeBand, spacing } = qualitySettings(level).cropStalks;
  return { edgeBand, spacing };
};

test("every crop with stalks has plant geometry, and the others none", () => {
  for (const crop of Object.keys(CROPS)) {
    const geometry = stalkGeometry(crop, { uniforms: createSharedUniforms(), own: (r) => r });
    assert.equal(Boolean(geometry), crop in STALK_CROPS, crop);
    if (geometry) assert.ok(geometry.far.attributes.position.count < geometry.near.attributes.position.count, `${crop}: far is cheaper`);
  }
});

test("stalks stay inside their field, in every crop and level", () => {
  for (const crop of Object.keys(STALK_CROPS)) {
    for (const level of QUALITY_LEVELS) {
      const f = field(crop);
      const { interiorSpacing } = qualitySettings(level).cropStalks;
      const planned = planStalks(f, { ...edgeParams(level), interior: { spacing: interiorSpacing || 2 } });
      for (const data of [planned.edge, planned.interior]) {
        for (let i = 0; i < data.length; i += STALK_STRIDE) {
          const [lx, lz] = local(f, data[i], data[i + 1]);
          assert.ok(Math.abs(lx) <= f.width / 2 && Math.abs(lz) <= f.depth / 2, `${crop} ${level} at ${lx},${lz}`);
        }
      }
    }
  }
});

test("stalks of the planned fields never stand on a road", () => {
  assert.ok(plan.fields.length > 0);
  for (const f of plan.fields) {
    const { edge, interior } = planStalks(f, { edgeBand: 5, spacing: 1.5, interior: { spacing: 3 } });
    for (const data of [edge, interior]) {
      for (let i = 0; i < data.length; i += STALK_STRIDE) {
        const near = world.roads.nearest(data[i], data[i + 1], 2);
        if (near) assert.ok(near.distance > roadHalfWidth(near.sample.route.lanes) + VERGE, `${f.crop} stalk on a road`);
      }
    }
  }
});

test("every field with a stalk crop has plants along its edge, and the interior stays clear of it", () => {
  for (const crop of Object.keys(STALK_CROPS)) {
    const f = field(crop);
    const { edge, interior } = planStalks(f, { ...edgeParams("low"), interior: { spacing: 2 } });
    assert.ok(edge.length >= STALK_STRIDE * 20, `${crop} edge`);
    const depth = (data) => Array.from({ length: data.length / STALK_STRIDE }, (_, i) => {
      const [lx, lz] = local(f, data[i * STALK_STRIDE], data[i * STALK_STRIDE + 1]);
      return Math.min(f.width / 2 - Math.abs(lx), f.depth / 2 - Math.abs(lz));
    });
    assert.ok(Math.max(...depth(edge)) < edgeParams("low").edgeBand, `${crop}: edge plants within the band`);
    assert.ok(Math.min(...depth(interior)) >= edgeParams("low").edgeBand, `${crop}: interior plants beyond it`);
  }
  for (const f of plan.fields) assert.ok(!(f.crop in STALK_CROPS) || planStalks(f, edgeParams("low")).edge.length > 0, `field of ${f.crop}`);
});

test("the edge is ragged: heights vary and not every spot is planted", () => {
  const f = field("wheat");
  const { edge } = planStalks(f, edgeParams("high"));
  const sizes = Array.from({ length: edge.length / STALK_STRIDE }, (_, i) => edge[i * STALK_STRIDE + 3]);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 0.3);
  const border = sizes.length;
  const full = (f.width / (STALK_CROPS.wheat.along)) * (f.depth / STALK_CROPS.wheat.row);
  assert.ok(border < full, "plants only in the band");
});

test("planning is deterministic", () => {
  const f = field("corn");
  assert.deepEqual(planStalks(f, edgeParams("medium")).edge, planStalks(f, edgeParams("medium")).edge);
});

test("the stalk budget grows with the level: Low < Medium < High < Ultra", () => {
  const total = (level) => {
    const { interiorSpacing } = qualitySettings(level).cropStalks;
    return plan.fields.reduce((sum, f) => {
      const planned = planStalks(f, { ...edgeParams(level), interior: interiorSpacing ? { spacing: interiorSpacing } : null });
      return sum + (planned.edge.length + planned.interior.length) / STALK_STRIDE;
    }, 0);
  };
  const counts = QUALITY_LEVELS.map(total);
  assert.ok(counts[0] > 0);
  counts.forEach((count, i) => i && assert.ok(count > counts[i - 1], `${QUALITY_LEVELS[i]} ${count} > ${counts[i - 1]}`));
});

test("the crop layer plants the fields near the camera and hides them far away, then frees everything", () => {
  const tracker = createTracker();
  const settings = qualitySettings("high");
  const layer = createCropLayer(plan, { ground, settings, uniforms: createSharedUniforms(), track: tracker.track });
  const target = plan.fields.find((f) => f.crop in STALK_CROPS);
  assert.ok(target, "a field with plants");
  const camera = new THREE.PerspectiveCamera();
  const at = (x, z) => {
    camera.position.set(x, 20, z);
    layer.update({ dt: 0.016, t: 1, camera, focus: [x, 0, z] });
  };
  at(target.x, target.z);
  const group = layer.stalks.object.children.find((g) => g.name === `stalks-${target.crop}`);
  assert.ok(group?.visible && group.children.length === 2, "near and far plants of the field");
  assert.ok(layer.stalks.object.children.some((g) => g.name.startsWith("stalks-inside")), "the interior at high quality");
  at(target.x + 5000, target.z);
  assert.equal(group.visible, false);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("Low plants the edges only, and a layer without settings plants nothing", () => {
  const layer = createCropLayer(plan, { ground, settings: qualitySettings("low"), uniforms: createSharedUniforms(), track: createTracker().track });
  const target = plan.fields.find((f) => f.crop in STALK_CROPS);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(target.x, 10, target.z);
  layer.update({ dt: 0.016, t: 1, camera, focus: [0, 0, 0] });
  assert.ok(!layer.stalks.object.children.some((g) => g.name.startsWith("stalks-inside")));
  layer.dispose();
  const bare = createCropLayer(plan, { ground, uniforms: createSharedUniforms(), track: createTracker().track });
  assert.equal(bare.stalks, undefined);
  bare.dispose();
});
