import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "../public/js/three.js";
import { createSharedUniforms } from "../public/js/view3d/assets/materials.js";
import { CROPS, NATURE } from "../public/js/view3d/assets/nature/index.js";
import { REGION_KINDS, REGION_STYLE } from "../public/js/world/regionKinds.js";
import { createTracker } from "../public/js/view3d/scene/tracker.js";

const SEASONS = ["spring", "summer", "autumn", "winter"];
const IDS = Object.keys(NATURE);
const BROADLEAVES = ["broadleaf", "poplar", "birch"];
const SMALL = ["bush", "lavender", "rock", "hayBale"];

const triangles = (geometry) => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
const total = (list) => list.reduce((sum, part) => sum + triangles(part.geometry), 0);
const box = (list) => list.reduce((b, part) => (part.geometry.computeBoundingBox(), b.union(part.geometry.boundingBox)), new THREE.Box3());
const build = (id, season, extra = {}) => NATURE[id].parts({ season, detail: true, uniforms: createSharedUniforms(), ...extra });
const isCard = (part) => Boolean(part.material.alphaTest);

test("the registry covers every plant the regions can plant", () => {
  const wanted = new Set();
  for (const kind of REGION_KINDS) {
    const style = REGION_STYLE[kind];
    for (const id of [...Object.keys(style.trees.mix), ...Object.keys(style.verge.mix)]) wanted.add(id);
  }
  for (const id of wanted) assert.ok(NATURE[id], `plant ${id}`);
});

test("the crop table covers every crop the regions can grow", () => {
  for (const kind of REGION_KINDS) {
    for (const season of SEASONS) for (const crop of REGION_STYLE[kind].crops[season]) assert.ok(CROPS[crop], `crop ${crop}`);
  }
});

test("each asset describes itself", () => {
  for (const id of IDS) {
    assert.equal(NATURE[id].meta.id, id);
    assert.equal(NATURE[id].meta.category, "nature");
    assert.equal(typeof NATURE[id].meta.name, "string");
  }
});

for (const id of IDS) {
  for (const season of SEASONS) {
    test(`${id} in ${season}: sits on the ground, has near and far parts, far is lighter`, () => {
      const { near, far } = build(id, season);
      assert.ok(near.length > 0 && far.length > 0);
      for (const list of [near, far]) {
        const { min } = box(list);
        assert.ok(min.y >= -0.05 && min.y <= 0.05, `${id} ${season} min y ${min.y}`);
      }
      assert.ok(total(far) < total(near), `${id} far ${total(far)} near ${total(near)}`);
    });

    test(`${id} in ${season}: stays within its triangle budget`, () => {
      const { near, far } = build(id, season);
      const limit = SMALL.includes(id) ? 400 : 1200;
      assert.ok(total(near) <= limit, `${id} ${season} near ${total(near)}`);
      assert.ok(total(far) <= 120, `${id} ${season} far ${total(far)}`);
    });
  }
}

test("winter broadleaves are bare", () => {
  for (const id of BROADLEAVES) {
    assert.equal(build(id, "winter").near.some(isCard), false, id);
    assert.ok(build(id, "summer").near.some(isCard), id);
  }
});

test("evergreens keep their cards in winter", () => {
  for (const id of ["pine", "umbrellaPine", "olive", "cypress"]) assert.ok(build(id, "winter").near.some(isCard), id);
});

test("almond blossoms in spring and not in summer", () => {
  const colour = (season) => {
    const card = build("almond", season).near.find(isCard);
    const c = card.geometry.attributes.color;
    return [c.getX(0), c.getY(0), c.getZ(0)];
  };
  const [r, g] = colour("spring");
  assert.ok(r > g, "pink in spring");
  const [r2, g2] = colour("summer");
  assert.ok(g2 > r2, "green in summer");
});

test("autumn broadleaves turn", () => {
  const first = (season) => {
    const c = build("broadleaf", season).near.find(isCard).geometry.attributes.color;
    return [c.getX(0), c.getY(0), c.getZ(0)];
  };
  assert.notDeepEqual(first("autumn"), first("summer"));
});

test("the same input makes the same plant", () => {
  for (const id of IDS) {
    const a = build(id, "summer").near[0].geometry.attributes.position.array;
    const b = build(id, "summer").near[0].geometry.attributes.position.array;
    assert.deepEqual(Array.from(a), Array.from(b), id);
  }
});

test("detail off keeps a plant lighter or equal", () => {
  for (const id of IDS) {
    const full = NATURE[id].parts({ season: "summer", detail: true, uniforms: createSharedUniforms() });
    const lean = NATURE[id].parts({ season: "summer", detail: false, uniforms: createSharedUniforms() });
    assert.ok(total(lean.near) <= total(full.near), id);
  }
});

test("every resource a plant makes goes through the owner", () => {
  for (const id of IDS) {
    const made = new Set();
    const own = (resource) => made.add(resource) && resource;
    const { near, far } = build(id, "spring", { own });
    for (const part of [...near, ...far]) {
      assert.ok(made.has(part.geometry), `${id} geometry`);
      assert.ok(made.has(part.material), `${id} material`);
      if (part.material.map) assert.ok(made.has(part.material.map), `${id} texture`);
      if (part.depth) assert.ok(made.has(part.depth), `${id} depth material`);
    }
  }
});

test("create builds an object and dispose frees everything", () => {
  for (const id of IDS) {
    const tracker = createTracker();
    const asset = NATURE[id].create({ season: "summer", track: tracker.track, uniforms: createSharedUniforms() });
    assert.ok(asset.object instanceof THREE.Object3D);
    assert.ok(tracker.live() > 0, id);
    asset.dispose();
    assert.equal(tracker.live(), 0, `${id} leaked`);
  }
});

test("a crop field drapes over the ground and its shader reads the shared uniforms", async () => {
  const { fieldGeometry, cropMaterial } = await import("../public/js/view3d/assets/nature/crops.js");
  const uniforms = createSharedUniforms();
  for (const crop of Object.keys(CROPS)) {
    const geometry = fieldGeometry({ width: 40, depth: 24, x: 10, z: -5, yaw: 0.3, crop, heightAt: () => 7 });
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.y >= 6.5, crop);
    const material = cropMaterial(crop, uniforms);
    const sh = { uniforms: {}, vertexShader: "#include <begin_vertex>", fragmentShader: "#include <color_fragment>" };
    material.onBeforeCompile(sh);
    assert.equal(sh.uniforms.uTime, uniforms.time);
    material.dispose();
    geometry.dispose();
  }
});

test("pumpkins and bales only lie on the fields that carry them", async () => {
  const { fieldExtras } = await import("../public/js/view3d/assets/nature/crops.js");
  const at = (crop) => fieldExtras({ width: 40, depth: 30, x: 0, z: 0, yaw: 0, crop, heightAt: () => 0, random: () => 0.5 });
  assert.ok(at("pumpkin").pumpkins.length > 0);
  assert.equal(at("wheat").pumpkins.length + at("wheat").bales.length, 0);
  assert.ok(at("stubble").bales.length > 0);
});

test("the grass field wraps blades around the camera and frees what it made", async () => {
  const { createGrassRing, ringSet } = await import("../public/js/view3d/assets/nature/grass.js");
  const tracker = createTracker();
  const rings = ringSet([{ r: 10, dens: 2, w: 0.1, segs: 3 }, { r: 30, dens: 0.5, w: 0.2, segs: 2 }]);
  assert.equal(rings[0].fadeIn, null);
  assert.deepEqual(rings[1].fadeIn, [8, 10]);
  const data = (Type, format, type) => new THREE.DataTexture(new Type(4), 2, 2, format, type);
  const ring = createGrassRing({ ring: rings[1], world: 400, res: 2, heightTex: data(Float32Array, THREE.RedFormat, THREE.FloatType), colorTex: data(Uint8Array, THREE.RGBAFormat), uniforms: createSharedUniforms(), random: () => 0.25, track: tracker.track });
  assert.equal(ring.object.geometry.instanceCount, Math.round(0.5 * 60 * 60));
  ring.update(new THREE.Vector3(5, 0, 6));
  assert.equal(ring.uniforms.uCam.value.x, 5);
  ring.dispose();
  assert.equal(tracker.live(), 0);
});
