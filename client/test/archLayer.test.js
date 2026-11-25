/** Arch layer: an arch spans the road at its spot facing along it, banners hang over the road, nothing leaks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../public/js/three.js";

import { RouteGeometry } from "../public/js/route/geometry.js";
import { ARCH_TEXT, archSpots } from "../public/js/view3d/banners.js";
import { resolveBiome } from "../public/js/view3d/biomes/index.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { createArchLayer } from "../public/js/view3d/scene/archLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const make = (arches) => {
  const tracker = createTracker();
  const layer = createArchLayer({ arches, biome: "temperate" }, { biome: resolveBiome("temperate"), settings: qualitySettings("high"), uniforms: createSharedUniforms(), track: tracker.track });
  return { layer, tracker };
};
const arch = { kind: "climb", text: "KOM", position: [10, 2, -5], yaw: 0.3, halfWidth: 6, height: 5.2, banner: false };

test("an arch spans the road at its spot, facing along it", () => {
  const { layer } = make([arch]);
  layer.object.updateMatrixWorld(true);
  const across = [Math.cos(0.3), -Math.sin(0.3)];
  const at = new THREE.Vector3();
  let lowest = Infinity;
  let min = Infinity;
  let max = -Infinity;
  layer.object.traverse((node) => {
    if (!node.isMesh) return;
    const position = node.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      at.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      lowest = Math.min(lowest, at.y);
      const along = (at.x - 10) * across[0] + (at.z + 5) * across[1];
      min = Math.min(min, along);
      max = Math.max(max, along);
    }
  });
  assert.ok(max - min >= 12, `spans ${max - min} m`);
  assert.ok(Math.abs(lowest - 2) <= 0.05, `lowest y ${lowest}`);
});

test("a banner hangs high enough to ride under", () => {
  const { layer } = make([{ kind: "halfway", text: "1/2", position: [0, 0, 0], yaw: 0, halfWidth: 6, height: 5.05, banner: true }]);
  const box = new THREE.Box3();
  layer.object.traverse((node) => {
    if (node.isMesh && node.geometry.attributes.uv) box.expandByObject(node);
  });
  assert.ok(box.min.y > 3.5, `cloth bottom at ${box.min.y}`);
});

test("every marker of a route gets its arch and text", () => {
  const raw = JSON.parse(readFileSync(new URL("../../routes/rolling-hills.json", import.meta.url), "utf8"));
  const route = new RouteGeometry(raw);
  const spots = archSpots(route);
  assert.equal(spots.length, route.markers.length);
  assert.equal(spots.find((s) => s.kind === "start_finish").text, ARCH_TEXT.start_finish);
});

test("dispose frees everything", () => {
  const { layer, tracker } = make([arch, { ...arch, kind: "start_finish", text: "OPENRADLR" }]);
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
