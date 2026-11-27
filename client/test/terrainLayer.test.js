import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { createTerrainLayer } from "../public/js/view3d/scene/terrainLayer.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";
import { qualitySettings } from "../public/js/view3d/quality.js";
import { buildSceneNow } from "../public/js/view3d/worldScene.js";
import { groundFixture } from "./support/groundFixture.js";

const make = (ground = groundFixture(), tracker = createTracker()) => ({
  tracker,
  layer: createTerrainLayer(ground, { uniforms: createSharedUniforms(), settings: qualitySettings("high"), track: tracker.track }),
});
const tiles = (layer) => layer.object.children.filter((child) => child.name === "terrain-tile");

test("the near grid becomes tiles of 64 by 64 cells, vertex coloured and receiving shadows", () => {
  const { layer } = make(groundFixture());
  assert.ok(tiles(layer).length > 0);
  for (const tile of tiles(layer)) {
    assert.equal(tile.geometry.getAttribute("position").count, 65 * 65);
    assert.ok(tile.geometry.getAttribute("color"));
    assert.ok(tile.geometry.getAttribute("normal"));
    assert.equal(tile.receiveShadow, true);
    assert.equal(tile.material.vertexColors, true);
  }
});

test("tiles under the sea are skipped", () => {
  const { layer } = make(groundFixture());
  // The fixture's grid is 2 x 2 tiles; the two on the sea side lie entirely below the water.
  assert.equal(tiles(layer).length, 2);
  for (const tile of tiles(layer)) {
    const heights = tile.geometry.getAttribute("position");
    let top = -Infinity;
    for (let i = 0; i < heights.count; i += 1) top = Math.max(top, heights.getY(i));
    assert.ok(top > -3, "some land in every tile kept");
  }
});

test("the far ground leaves a hole under the near grid", () => {
  const ground = groundFixture();
  const { layer } = make(ground);
  const far = layer.object.getObjectByName("terrain-far");
  assert.ok(far, "a far mesh");
  const { near } = ground;
  const box = { x0: near.x0, z0: near.z0, x1: near.x0 + (near.columns - 1) * near.cell, z1: near.z0 + (near.rows - 1) * near.cell };
  const position = far.geometry.getAttribute("position");
  const index = far.geometry.getIndex();
  assert.ok(index.count > 0, "the far mesh has triangles");
  for (let t = 0; t < index.count; t += 3) {
    const corners = [0, 1, 2].map((k) => index.getX(t + k));
    const x = corners.reduce((sum, i) => sum + position.getX(i), 0) / 3;
    const z = corners.reduce((sum, i) => sum + position.getZ(i), 0) / 3;
    assert.ok(!(x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1), `a far triangle centred at (${x}, ${z}) lies under the near grid`);
  }
});

test("the far ground reaches past the near grid", () => {
  const { layer } = make(groundFixture());
  const far = layer.object.getObjectByName("terrain-far");
  far.geometry.computeBoundingBox();
  assert.ok(far.geometry.boundingBox.max.x > 3000);
});

test("terrain uses grain and cloud-shadow hooks", () => {
  const { layer } = make(groundFixture());
  const { hooks } = tiles(layer)[0].material.userData;
  assert.ok(hooks.length >= 2);
});

test("a route file without a network still gets ground", () => {
  const file = JSON.parse(readFileSync(new URL("../../routes/riverside-flats.json", import.meta.url)));
  const { layer } = make(buildSceneNow(file).ground);
  assert.ok(tiles(layer).length > 0);
  assert.ok(layer.object.getObjectByName("terrain-far"));
});

test("disposing the layer disposes its geometries and materials", () => {
  const { layer, tracker } = make(groundFixture());
  assert.ok(tracker.live() > 0);
  layer.dispose();
  assert.equal(tracker.live(), 0);
});

test("the layer has the layer shape", () => {
  const { layer } = make(groundFixture());
  assert.ok(layer.object instanceof THREE.Object3D);
  for (const name of ["update", "setEnvironment", "dispose"]) assert.equal(typeof layer[name], "function");
});

test("the ground samples the land-use paint", () => {
  const paint = { x0: -1024, z0: -1024, cell: 16, columns: 128, rows: 128, rgba: new Uint8Array(128 * 128 * 4) };
  const { layer, tracker } = make({ ...groundFixture(), paint });
  const far = layer.object.getObjectByName("terrain-far");
  for (const mesh of [tiles(layer)[0], far]) {
    const hook = mesh.material.userData.hooks.find((each) => each.key === "landPaint");
    assert.ok(hook, "a landPaint hook");
    const shader = { uniforms: {}, vertexShader: "#include <project_vertex>", fragmentShader: "#include <color_fragment>" };
    hook(shader);
    const texture = Object.values(shader.uniforms).map((u) => u.value).find((v) => v?.isDataTexture);
    assert.deepEqual([texture.image.width, texture.image.height], [128, 128]);
  }
  layer.dispose();
  assert.equal(tracker.live(), 0);
});
